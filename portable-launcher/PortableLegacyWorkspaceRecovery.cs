using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;

internal sealed partial class PortableStorage
{
    private const string LegacyWorkspaceResetConfirmation = "BACK UP AND RESET";

    private sealed class LegacyWorkspaceRecoveryState
    {
        internal string WorkspaceRoot;
        internal LocalWorkspaceState WorkspaceState;
        internal Dictionary<string, object> LocalDatabase;
        internal string SharedSha256;
        internal bool BaseAvailable;
        internal bool Required;
    }

    public string LegacyWorkspaceRecoveryStatus(string systemId, string logicalSystemId)
    {
        ValidateSystemId(logicalSystemId);
        lock (RootLock(systemId)) return json.Serialize(LegacyWorkspaceRecoveryResponse(ReadLegacyWorkspaceRecoveryState(systemId), logicalSystemId));
    }

    public string ExportLegacyWorkspaceRecovery(string systemId, byte[] requestBody)
    {
        Dictionary<string, object> request = RecoveryRequest(requestBody, false);string logicalSystemId = Convert.ToString(request["logicalSystemId"], CultureInfo.InvariantCulture);ValidateSystemId(logicalSystemId);
        lock (RootLock(systemId))
        {
            LegacyWorkspaceRecoveryState state = ReadLegacyWorkspaceRecoveryState(systemId);RequireLegacyRecovery(state);
            Dictionary<string, object> package = CreateLegacyWorkspaceReviewPackage(systemId, logicalSystemId, state);
            AppendAudit(systemId, "LEGACY WORKSPACE RECOVERY EXPORT: protected stale local database exported for operator review; package " + Convert.ToString(package["filename"], CultureInfo.InvariantCulture) + "; shared database and evidence unchanged");
            return json.Serialize(package);
        }
    }

    public string ResetLegacyWorkspaceRecovery(string systemId, byte[] requestBody)
    {
        Dictionary<string, object> request = RecoveryRequest(requestBody, true);string logicalSystemId = Convert.ToString(request["logicalSystemId"], CultureInfo.InvariantCulture);ValidateSystemId(logicalSystemId);
        lock (RootLock(systemId))
        {
            LegacyWorkspaceRecoveryState state = ReadLegacyWorkspaceRecoveryState(systemId);RequireLegacyRecovery(state);
            Dictionary<string, object> package = CreateLegacyWorkspaceReviewPackage(systemId, logicalSystemId, state);string archivedWorkspace = UniqueRecoveryPath(RecoveryArchiveRoot(state.WorkspaceRoot), "legacy-workspace-" + RecoveryTimestamp());
            AppendAudit(systemId, "LEGACY WORKSPACE RECOVERY STARTED: protected review package created; stale local workspace will be archived and rebuilt from the verified shared master; shared evidence unchanged");
            Directory.CreateDirectory(Path.GetDirectoryName(archivedWorkspace));
            try
            {
                RelocateProtectedWorkspaceFiles(state.WorkspaceRoot, archivedWorkspace);
                string verificationJson;
                try { verificationJson = VerifyLatest(systemId, logicalSystemId); }
                catch
                {
                    string replacement = LocalWorkspaceRoot(systemId);if (Directory.Exists(replacement)) RelocateProtectedWorkspaceFiles(replacement, UniqueRecoveryPath(RecoveryArchiveRoot(replacement), "failed-reinitialization-" + RecoveryTimestamp()));
                    if (Directory.Exists(archivedWorkspace)) RelocateProtectedWorkspaceFiles(archivedWorkspace, state.WorkspaceRoot);
                    lock (localWorkspaceAclGate) hardenedLocalWorkspaces.Remove(state.WorkspaceRoot);
                    throw;
                }
                AppendAudit(systemId, "LEGACY WORKSPACE RECOVERY COMPLETED: stale local workspace archived as " + Path.GetFileName(archivedWorkspace) + "; fresh protected workspace initialized from verified shared master; shared database and evidence unchanged");
                Dictionary<string, object> response = ObjectDictionary(json.DeserializeObject(verificationJson));response["recoveryCompleted"] = true;response["reviewPackage"] = package;response["archivedWorkspacePath"] = archivedWorkspace;return json.Serialize(response);
            }
            catch { throw; }
        }
    }

    private LegacyWorkspaceRecoveryState ReadLegacyWorkspaceRecoveryState(string systemId)
    {
        string workspaceRoot = LocalWorkspaceRoot(systemId), manifestPath = SystemFile(Root(systemId), ManifestFilename);LocalWorkspaceState state = ReadLocalWorkspaceState(workspaceRoot);Dictionary<string, object> localDatabase = null;
        if (state != null && File.Exists(LocalWorkspaceManifestPath(workspaceRoot))) localDatabase = ReadLocalWorkspaceDatabase(workspaceRoot);
        string sharedSha256 = File.Exists(manifestPath + ".sha256") ? VerifyManifestChecksum(manifestPath, false) : TryFileHash(manifestPath), baseSha256;Dictionary<string, object> ignored;
        bool baseAvailable = state != null && TryReadLocalWorkspaceBaseDatabase(workspaceRoot, out ignored, out baseSha256) && String.Equals(baseSha256, state.BaseSharedSha256, StringComparison.OrdinalIgnoreCase);
        bool required = state != null && state.Dirty && IsSha256(sharedSha256) && !String.Equals(state.BaseSharedSha256, sharedSha256, StringComparison.OrdinalIgnoreCase) && !baseAvailable;
        return new LegacyWorkspaceRecoveryState { WorkspaceRoot = workspaceRoot, WorkspaceState = state, LocalDatabase = localDatabase, SharedSha256 = sharedSha256, BaseAvailable = baseAvailable, Required = required };
    }

    private Dictionary<string, object> LegacyWorkspaceRecoveryResponse(LegacyWorkspaceRecoveryState state, string logicalSystemId)
    {
        object[] users = state.LocalDatabase == null ? new object[0] : ObjectArray(state.LocalDatabase["users"]), systems = state.LocalDatabase == null ? new object[0] : ObjectArray(state.LocalDatabase["systems"]);string systemName = systems.Length == 0 ? logicalSystemId : Convert.ToString(ObjectDictionary(systems[0])["name"], CultureInfo.InvariantCulture);
        return new Dictionary<string, object> { { "required", state.Required }, { "dirty", state.WorkspaceState != null && state.WorkspaceState.Dirty }, { "legacy", state.Required }, { "baseSnapshotAvailable", state.BaseAvailable }, { "systemName", CleanLine(systemName, 200) }, { "userCount", users.Length }, { "savedAtUtc", state.WorkspaceState == null ? "" : state.WorkspaceState.SavedAtUtc }, { "baseSharedSha256", state.WorkspaceState == null ? "" : state.WorkspaceState.BaseSharedSha256 }, { "sharedManifestSha256", state.SharedSha256 ?? "" }, { "sharedDataWillChange", false }, { "automaticDeletion", false } };
    }

    private Dictionary<string, object> CreateLegacyWorkspaceReviewPackage(string systemId, string logicalSystemId, LegacyWorkspaceRecoveryState state)
    {
        string directory = RecoveryArchiveRoot(state.WorkspaceRoot), timestamp = RecoveryTimestamp(), filename = "legacy-workspace-review-" + timestamp + ".zip", destination = UniqueRecoveryPath(directory, filename);Directory.CreateDirectory(directory);HardenLocalWorkspaceAcl(directory);
        string temporary = destination + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 65536, FileOptions.WriteThrough))
            using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Create, false))
            {
                WriteRecoveryZipEntry(archive, "recovery-metadata.json", json.Serialize(new Dictionary<string, object> { { "format", "raptor-legacy-workspace-review-v1" }, { "createdAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "operator", actor }, { "applicationVersion", CurrentApplicationVersion }, { "logicalSystemId", logicalSystemId }, { "sharedManifestSha256", state.SharedSha256 ?? "" }, { "baseSharedSha256", state.WorkspaceState.BaseSharedSha256 }, { "savedAtUtc", state.WorkspaceState.SavedAtUtc }, { "sharedDataChanged", false }, { "evidenceIncluded", false } }));
                WriteRecoveryZipEntry(archive, "local-database.json", json.Serialize(state.LocalDatabase));
                WriteRecoveryZipEntry(archive, "README.txt", "R.A.P.T.O.R. legacy workspace review package\r\n\r\nThis package preserves the stale local database for operator review. Evidence files remain preserved in the archived local workspace. No shared database or evidence file was changed by this export.\r\n");
            }
            string hash = TryFileHash(temporary);if (!IsSha256(hash)) throw new IOException("The protected recovery package could not be verified.");File.Move(temporary, destination);AtomicWrite(destination + ".sha256", Encoding.ASCII.GetBytes(hash + "  " + Path.GetFileName(destination) + Environment.NewLine));
            return new Dictionary<string, object> { { "created", true }, { "filename", Path.GetFileName(destination) }, { "path", destination }, { "sha256", hash }, { "createdAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "sharedDataChanged", false }, { "evidenceIncluded", false } };
        }
        catch { try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }throw; }
    }

    private static void WriteRecoveryZipEntry(ZipArchive archive, string name, string content)
    {
        ZipArchiveEntry entry = archive.CreateEntry(name, CompressionLevel.Optimal);using (Stream stream = entry.Open()) using (StreamWriter writer = new StreamWriter(stream, new UTF8Encoding(false))) writer.Write(content);
    }

    private Dictionary<string, object> RecoveryRequest(byte[] requestBody, bool requireConfirmation)
    {
        if (requestBody == null || requestBody.Length == 0 || requestBody.Length > 4096) throw new InvalidDataException("The recovery request is missing or exceeds the safety limit.");Dictionary<string, object> request = ObjectDictionary(json.DeserializeObject(Encoding.UTF8.GetString(requestBody)));string logical = request.ContainsKey("logicalSystemId") ? Convert.ToString(request["logicalSystemId"], CultureInfo.InvariantCulture) : "";
        if (String.IsNullOrWhiteSpace(logical)) throw new InvalidDataException("The recovery request does not identify the information system.");if (requireConfirmation && (!request.ContainsKey("confirmation") || !String.Equals(Convert.ToString(request["confirmation"], CultureInfo.InvariantCulture), LegacyWorkspaceResetConfirmation, StringComparison.Ordinal))) throw new InvalidDataException("Type BACK UP AND RESET to confirm protected legacy workspace recovery.");return request;
    }

    private static void RequireLegacyRecovery(LegacyWorkspaceRecoveryState state)
    {
        if (state == null || !state.Required || state.LocalDatabase == null || state.WorkspaceState == null) throw new InvalidOperationException("The selected system does not currently require legacy workspace recovery.");
    }

    private static string RecoveryArchiveRoot(string workspaceRoot)
    {
        string workspaceParent = Path.GetDirectoryName(workspaceRoot), localDataRoot = Path.GetDirectoryName(workspaceParent);if (String.IsNullOrWhiteSpace(localDataRoot)) throw new InvalidDataException("The protected local recovery path is unavailable.");return Path.Combine(localDataRoot, "Recovery Archives", Path.GetFileName(workspaceRoot));
    }

    private static string UniqueRecoveryPath(string directory, string name)
    {
        Directory.CreateDirectory(directory);string candidate = Path.Combine(directory, name);for (int index = 2;File.Exists(candidate) || Directory.Exists(candidate);index++) candidate = Path.Combine(directory, Path.GetFileNameWithoutExtension(name) + "-" + index.ToString(CultureInfo.InvariantCulture) + Path.GetExtension(name));return candidate;
    }

    private void RelocateProtectedWorkspaceFiles(string source, string destination)
    {
        string sourceFull = Path.GetFullPath(source).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;if (!Directory.Exists(source)) throw new DirectoryNotFoundException("The protected workspace to archive no longer exists.");
        Directory.CreateDirectory(destination);HardenLocalWorkspaceAcl(destination);var moved = new List<KeyValuePair<string,string>>();
        try
        {
            foreach (string directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
            {
                if ((new DirectoryInfo(directory).Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("The protected workspace contains an unsupported reparse point.");string full = Path.GetFullPath(directory);if (!full.StartsWith(sourceFull, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The protected workspace contains an unsafe directory path.");Directory.CreateDirectory(Path.Combine(destination, full.Substring(sourceFull.Length)));
            }
            foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            {
                string full = Path.GetFullPath(file);if (!full.StartsWith(sourceFull, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The protected workspace contains an unsafe file path.");string relative = full.Substring(sourceFull.Length), target = Path.Combine(destination, relative), hash = TryFileHash(full);if (!IsSha256(hash)) throw new IOException("A protected workspace file could not be verified before archival.");
                Directory.CreateDirectory(Path.GetDirectoryName(target));File.Move(full, target);moved.Add(new KeyValuePair<string,string>(full, target));if (!String.Equals(hash, TryFileHash(target), StringComparison.OrdinalIgnoreCase)) throw new IOException("A protected workspace file failed verification after archival.");
            }
            lock (localWorkspaceAclGate) hardenedLocalWorkspaces.Remove(source);
        }
        catch
        {
            for (int index = moved.Count - 1; index >= 0; index--) try { Directory.CreateDirectory(Path.GetDirectoryName(moved[index].Key));if (!File.Exists(moved[index].Key) && File.Exists(moved[index].Value)) File.Move(moved[index].Value, moved[index].Key); } catch { }
            throw;
        }
    }

    private static string RecoveryTimestamp() { return DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffZ", CultureInfo.InvariantCulture); }
}
