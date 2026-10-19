using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

internal sealed partial class PortableStorage
{
    private const string StorageTransactionPendingFilename = "pending.flag";
    private const string LocalWorkspaceChangeMarkerFilename = "workspace-review-required.flag";
    private readonly object workspaceStatusGate = new object();
    private readonly Dictionary<string, FileSystemWatcher> workspaceStatusWatchers = new Dictionary<string, FileSystemWatcher>(StringComparer.Ordinal);
    private readonly Dictionary<string, string> workspaceStatusWatcherRoots = new Dictionary<string, string>(StringComparer.Ordinal);
    private readonly Dictionary<string, long> workspaceStatusGenerations = new Dictionary<string, long>(StringComparer.Ordinal);
    private readonly HashSet<string> exposedLocalWorkspaces = new HashSet<string>(StringComparer.Ordinal);

    private sealed class LocalWorkspaceReviewToken
    {
        public string SystemId;
        public string WorkspaceRoot;
        public long Generation;
        public string MarkerToken;
        public bool Required;
    }

    private sealed class LocalWorkspaceState
    {
        public string BaseSharedSha256;
        public string DatabaseStateHash;
        public int PendingEvidenceCount = -1;
        public bool Dirty;
        public string PulledAtUtc;
        public string SavedAtUtc;
    }

    public string WorkspaceStatus(string systemId, byte[] bytes)
    {
        if (bytes == null || bytes.LongLength <= 0 || bytes.LongLength > 4096) throw new InvalidDataException("The workspace status request is empty or exceeds its size limit.");
        Dictionary<string, object> request;
        try { request = ObjectDictionary(json.DeserializeObject(Encoding.UTF8.GetString(bytes))); }
        catch (Exception) { throw new InvalidDataException("The workspace status request is invalid JSON."); }
        string requestedStateHash = request.ContainsKey("stateHash") ? Convert.ToString(request["stateHash"], CultureInfo.InvariantCulture) : "";
        if (!IsSha256(requestedStateHash)) throw new InvalidDataException("The workspace status request is missing a valid state hash.");
        lock (RootLock(systemId))
        {
            string workspaceRoot = LocalWorkspaceRoot(systemId), manifestPath = LocalWorkspaceManifestPath(workspaceRoot);LocalWorkspaceState state = ReadLocalWorkspaceState(workspaceRoot);
            bool initialized = state != null && File.Exists(manifestPath), metadataCurrent = initialized && IsSha256(state.DatabaseStateHash) && state.PendingEvidenceCount >= 0;
            bool publicationRecovery = File.Exists(LocalWorkspacePublicationPath(workspaceRoot)), transactionRecovery = File.Exists(StorageTransactionPendingPath(workspaceRoot)), localFolderChange = LocalWorkspaceReviewPending(systemId, workspaceRoot), legacyRecovery = !File.Exists(SystemFile(workspaceRoot, LocalWorkspaceEvidenceRecoveryMarkerFilename));
            bool interruptedRecovery = publicationRecovery || transactionRecovery, databaseChangePending = !metadataCurrent || state.Dirty || !String.Equals(state.DatabaseStateHash, requestedStateHash, StringComparison.OrdinalIgnoreCase);
            int pendingEvidenceCount = metadataCurrent ? state.PendingEvidenceCount : 0;bool evidenceWorkPending = !metadataCurrent || pendingEvidenceCount > 0 || interruptedRecovery || localFolderChange || legacyRecovery;
            return json.Serialize(new Dictionary<string, object> { { "noChanges", metadataCurrent && !databaseChangePending && !evidenceWorkPending }, { "stateHash", requestedStateHash.ToLowerInvariant() }, { "databaseChangePending", databaseChangePending }, { "pendingEvidenceCount", pendingEvidenceCount }, { "interruptedRecovery", interruptedRecovery }, { "evidenceWorkPending", evidenceWorkPending }, { "saved", state == null ? "" : state.SavedAtUtc ?? "" }, { "backup", state == null ? "" : state.PulledAtUtc ?? "" }, { "initialized", initialized }, { "metadataCurrent", metadataCurrent } });
        }
    }

    public string EvidenceExists(string systemId, string relative)
    {
        try
        {
            string root, path = ResolveEvidencePath(systemId, relative, out root);var file = new FileInfo(path);file.Refresh();
            if (!file.Exists) return "{\"exists\":false}";
            EnsureReparseSafePath(root, path);
            return json.Serialize(new Dictionary<string, object> { { "exists", true }, { "size", file.Length }, { "lastModifiedUnixMs", new DateTimeOffset(file.LastWriteTimeUtc).ToUnixTimeMilliseconds() } });
        }
        catch (FileNotFoundException) { return "{\"exists\":false}"; }
        catch (DirectoryNotFoundException) { return "{\"exists\":false}"; }
    }

    private LocalWorkspaceState ReadLocalWorkspaceState(string workspaceRoot)
    {
        try
        {
            string path = LocalWorkspaceStatePath(workspaceRoot);if (!File.Exists(path)) return null;
            Dictionary<string, object> value = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "workspace-state", 1024 * 1024)));
            if (!value.ContainsKey("version") || Convert.ToInt32(value["version"], CultureInfo.InvariantCulture) != LocalWorkspaceVersion) return null;
            string baseHash = Convert.ToString(value["baseSharedSha256"], CultureInfo.InvariantCulture);if (!IsSha256(baseHash)) return null;
            string databaseStateHash = value.ContainsKey("databaseStateHash") ? Convert.ToString(value["databaseStateHash"], CultureInfo.InvariantCulture) : "";if (!IsSha256(databaseStateHash)) databaseStateHash = "";
            int pendingEvidenceCount = -1;try { if (value.ContainsKey("pendingEvidenceCount")) pendingEvidenceCount = Convert.ToInt32(value["pendingEvidenceCount"], CultureInfo.InvariantCulture); } catch { pendingEvidenceCount = -1; }if (pendingEvidenceCount < 0 || pendingEvidenceCount > 100000) pendingEvidenceCount = -1;
            return new LocalWorkspaceState { BaseSharedSha256 = baseHash.ToLowerInvariant(), DatabaseStateHash = databaseStateHash.ToLowerInvariant(), PendingEvidenceCount = pendingEvidenceCount, Dirty = value.ContainsKey("dirty") && Convert.ToBoolean(value["dirty"], CultureInfo.InvariantCulture), PulledAtUtc = value.ContainsKey("pulledAtUtc") ? Convert.ToString(value["pulledAtUtc"], CultureInfo.InvariantCulture) : "", SavedAtUtc = value.ContainsKey("savedAtUtc") ? Convert.ToString(value["savedAtUtc"], CultureInfo.InvariantCulture) : "" };
        }
        catch { return null; }
    }

    private void WriteLocalWorkspaceState(string workspaceRoot, LocalWorkspaceState state)
    {
        var value = new Dictionary<string, object> { { "version", LocalWorkspaceVersion }, { "baseSharedSha256", state.BaseSharedSha256 }, { "databaseStateHash", IsSha256(state.DatabaseStateHash) ? state.DatabaseStateHash.ToLowerInvariant() : "" }, { "pendingEvidenceCount", state.PendingEvidenceCount }, { "dirty", state.Dirty }, { "pulledAtUtc", state.PulledAtUtc ?? "" }, { "savedAtUtc", state.SavedAtUtc ?? "" } };
        WriteProtectedLocalJson(LocalWorkspaceStatePath(workspaceRoot), "workspace-state", json.Serialize(value));
    }

    private static string StorageTransactionPendingPath(string root)
    {
        return Path.Combine(root, SystemDirectoryName, "Storage Transactions", StorageTransactionPendingFilename);
    }

    private static string LocalWorkspaceChangeMarkerPath(string root)
    {
        return Path.Combine(root, SystemDirectoryName, LocalWorkspaceChangeMarkerFilename);
    }

    private void ExposeLocalWorkspace(string systemId, string workspaceRoot)
    {
        lock (workspaceStatusGate)
        {
            string watchedRoot;FileSystemWatcher previous;
            if (workspaceStatusWatcherRoots.TryGetValue(systemId, out watchedRoot) && String.Equals(watchedRoot, workspaceRoot, StringComparison.OrdinalIgnoreCase) && workspaceStatusWatchers.ContainsKey(systemId))
            {
                exposedLocalWorkspaces.Add(systemId);AdvanceWorkspaceStatusGeneration(systemId);return;
            }
            if (workspaceStatusWatchers.TryGetValue(systemId, out previous)) try { previous.Dispose(); } catch { }
            workspaceStatusWatchers.Remove(systemId);workspaceStatusWatcherRoots.Remove(systemId);exposedLocalWorkspaces.Remove(systemId);
            string organizations = Path.Combine(workspaceRoot, "Organizations");Directory.CreateDirectory(organizations);
            var watcher = new FileSystemWatcher(organizations) { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size, InternalBufferSize = 32 * 1024 };
            workspaceStatusWatchers[systemId] = watcher;workspaceStatusWatcherRoots[systemId] = workspaceRoot;
            exposedLocalWorkspaces.Add(systemId);AdvanceWorkspaceStatusGeneration(systemId);
            FileSystemEventHandler changed = delegate { MarkLocalWorkspaceChanged(systemId, workspaceRoot); };
            RenamedEventHandler renamed = delegate { MarkLocalWorkspaceChanged(systemId, workspaceRoot); };
            ErrorEventHandler failed = delegate { MarkLocalWorkspaceChanged(systemId, workspaceRoot); };
            watcher.Created += changed;watcher.Changed += changed;watcher.Deleted += changed;watcher.Renamed += renamed;watcher.Error += failed;watcher.EnableRaisingEvents = true;
        }
    }

    private void MarkLocalWorkspaceChanged(string systemId, string workspaceRoot)
    {
        lock (workspaceStatusGate)
        {
            string watchedRoot;
            if (!workspaceStatusWatcherRoots.TryGetValue(systemId, out watchedRoot) || !String.Equals(watchedRoot, workspaceRoot, StringComparison.OrdinalIgnoreCase)) return;
            exposedLocalWorkspaces.Add(systemId);AdvanceWorkspaceStatusGeneration(systemId);
            try
            {
                string marker = LocalWorkspaceChangeMarkerPath(workspaceRoot), token = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + "|" + Guid.NewGuid().ToString("N");Directory.CreateDirectory(Path.GetDirectoryName(marker));AtomicWrite(marker, Encoding.ASCII.GetBytes(token + Environment.NewLine));
            }
            catch { }
        }
    }

    private void AdvanceWorkspaceStatusGeneration(string systemId)
    {
        long generation;workspaceStatusGenerations.TryGetValue(systemId, out generation);workspaceStatusGenerations[systemId] = generation == Int64.MaxValue ? 1L : generation + 1L;
    }

    private bool LocalWorkspaceReviewPending(string systemId, string workspaceRoot)
    {
        lock (workspaceStatusGate)
        {
            string watchedRoot;
            bool exposed = exposedLocalWorkspaces.Contains(systemId) && workspaceStatusWatcherRoots.TryGetValue(systemId, out watchedRoot) && String.Equals(watchedRoot, workspaceRoot, StringComparison.OrdinalIgnoreCase);
            return exposed || File.Exists(LocalWorkspaceChangeMarkerPath(workspaceRoot));
        }
    }

    private LocalWorkspaceReviewToken BeginLocalWorkspaceReview(string systemId, string workspaceRoot)
    {
        lock (workspaceStatusGate)
        {
            string watchedRoot;long generation;workspaceStatusGenerations.TryGetValue(systemId, out generation);
            bool exposed = exposedLocalWorkspaces.Contains(systemId) && workspaceStatusWatcherRoots.TryGetValue(systemId, out watchedRoot) && String.Equals(watchedRoot, workspaceRoot, StringComparison.OrdinalIgnoreCase);
            string markerToken = ReadLocalWorkspaceChangeMarkerToken(workspaceRoot);
            return new LocalWorkspaceReviewToken { SystemId = systemId, WorkspaceRoot = workspaceRoot, Generation = generation, MarkerToken = markerToken, Required = exposed || markerToken != null };
        }
    }

    private void CompleteLocalWorkspaceReview(LocalWorkspaceReviewToken review)
    {
        if (review == null || !review.Required) return;
        lock (workspaceStatusGate)
        {
            string watchedRoot;long generation;workspaceStatusGenerations.TryGetValue(review.SystemId, out generation);
            if ((workspaceStatusWatcherRoots.TryGetValue(review.SystemId, out watchedRoot) && !String.Equals(watchedRoot, review.WorkspaceRoot, StringComparison.OrdinalIgnoreCase)) || generation != review.Generation) return;
            if (!String.Equals(ReadLocalWorkspaceChangeMarkerToken(review.WorkspaceRoot), review.MarkerToken, StringComparison.Ordinal)) return;
            exposedLocalWorkspaces.Remove(review.SystemId);TryDelete(LocalWorkspaceChangeMarkerPath(review.WorkspaceRoot));
        }
    }

    private static string ReadLocalWorkspaceChangeMarkerToken(string workspaceRoot)
    {
        string marker = LocalWorkspaceChangeMarkerPath(workspaceRoot);
        try { return File.Exists(marker) ? File.ReadAllText(marker, Encoding.ASCII).Trim() : null; }
        catch
        {
            try { var info = new FileInfo(marker);return info.Exists ? "unreadable|" + info.Length.ToString(CultureInfo.InvariantCulture) + "|" + info.LastWriteTimeUtc.Ticks.ToString(CultureInfo.InvariantCulture) : null; }
            catch { return "unreadable|" + Guid.NewGuid().ToString("N"); }
        }
    }

    private void ResetLocalWorkspaceWatcher(string systemId)
    {
        FileSystemWatcher previous = null;
        lock (workspaceStatusGate)
        {
            workspaceStatusWatchers.TryGetValue(systemId, out previous);workspaceStatusWatchers.Remove(systemId);workspaceStatusWatcherRoots.Remove(systemId);workspaceStatusGenerations.Remove(systemId);exposedLocalWorkspaces.Remove(systemId);
        }
        if (previous != null) try { previous.Dispose(); } catch { }
    }

    private void DisposeWorkspaceStatusWatchers()
    {
        FileSystemWatcher[] watchers;lock (workspaceStatusGate) { watchers = new List<FileSystemWatcher>(workspaceStatusWatchers.Values).ToArray();workspaceStatusWatchers.Clear();workspaceStatusWatcherRoots.Clear();workspaceStatusGenerations.Clear();exposedLocalWorkspaces.Clear(); }
        foreach (FileSystemWatcher watcher in watchers) try { watcher.Dispose(); } catch { }
    }
}
