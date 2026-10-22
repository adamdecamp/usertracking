using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

internal sealed partial class PortableStorage
{
    private const int SyncJobVersion = 1;
    private const long SyncJobLimit = 64L * 1024;
    private static readonly HashSet<string> SyncJobStages = new HashSet<string>(StringComparer.Ordinal) { "Starting", "ArchivePreflight", "Discovery", "Normalization", "ReviewReady", "Applying", "Completed", "Failed", "Cancelled" };

    private static string SyncJobPath(string workspaceRoot)
    {
        string system = Path.Combine(workspaceRoot, SystemDirectoryName);Directory.CreateDirectory(system);return Path.Combine(system, "sync-job.json.dpapi");
    }

    public string ReadSyncJob(string systemId)
    {
        lock (RootLock(systemId))
        {
            string path = SyncJobPath(LocalWorkspaceRoot(systemId));if (!File.Exists(path)) return "{\"checkpoint\":null}";
            try { string clear = ReadProtectedLocalJson(path, "sync-job", SyncJobLimit);Dictionary<string, object> value = ObjectDictionary(json.DeserializeObject(clear));ValidateSyncJob(value, systemId);return "{\"checkpoint\":" + json.Serialize(value) + "}"; }
            catch { TryDelete(path);return "{\"checkpoint\":null}"; }
        }
    }

    public string SaveSyncJob(string systemId, byte[] bytes)
    {
        if (bytes == null || bytes.LongLength <= 0 || bytes.LongLength > SyncJobLimit) throw new InvalidDataException("The Sync checkpoint is empty or exceeds 64 KiB.");
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes); }
        catch (DecoderFallbackException) { throw new InvalidDataException("The Sync checkpoint is not valid UTF-8 JSON."); }
        Dictionary<string, object> value;
        try { value = ObjectDictionary(json.DeserializeObject(text)); }
        catch { throw new InvalidDataException("The Sync checkpoint is invalid JSON."); }
        ValidateSyncJob(value, systemId);
        lock (RootLock(systemId)) WriteProtectedLocalJson(SyncJobPath(LocalWorkspaceRoot(systemId)), "sync-job", json.Serialize(value));
        return "{\"saved\":true}";
    }

    public string ClearSyncJob(string systemId)
    {
        lock (RootLock(systemId)) TryDelete(SyncJobPath(LocalWorkspaceRoot(systemId)));
        return "{\"cleared\":true}";
    }

    private static void ValidateSyncJob(Dictionary<string, object> value, string systemId)
    {
        if (value.Count != 12) throw new InvalidDataException("The Sync checkpoint contains unsupported fields.");
        string storedSystem = RequiredBoundedString(value, "systemId", 100, false, "Sync checkpoint"), runId = RequiredBoundedString(value, "runId", 36, false, "Sync checkpoint"), mode = RequiredBoundedString(value, "mode", 100, false, "Sync checkpoint"), scope = RequiredBoundedString(value, "scope", 200, false, "Sync checkpoint"), stage = RequiredBoundedString(value, "stage", 50, false, "Sync checkpoint"), started = RequiredBoundedString(value, "startedAtUtc", 50, false, "Sync checkpoint"), updated = RequiredBoundedString(value, "updatedAtUtc", 50, false, "Sync checkpoint"), message = RequiredBoundedString(value, "message", 1000, true, "Sync checkpoint");
        int version = Convert.ToInt32(value["version"], CultureInfo.InvariantCulture), processed = Convert.ToInt32(value["processed"], CultureInfo.InvariantCulture), total = Convert.ToInt32(value["total"], CultureInfo.InvariantCulture);
        RequiredBoolean(value, "recoverable", "Sync checkpoint");DateTime parsed;Guid parsedRunId;if (version != SyncJobVersion || !String.Equals(storedSystem, systemId, StringComparison.Ordinal) || !Guid.TryParse(runId, out parsedRunId) || !SyncJobStages.Contains(stage) || !DateTime.TryParse(started, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out parsed) || !DateTime.TryParse(updated, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out parsed) || processed < 0 || total < 0 || processed > 1000000 || total > 1000000 || mode.Length == 0 || scope.Length == 0) throw new InvalidDataException("The Sync checkpoint failed validation.");
    }
}
