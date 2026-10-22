using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

internal sealed partial class PortableStorage
{
    private string LocalWorkspaceRoot(string systemId)
    {
        string sharedRoot = Root(systemId), parent = Path.GetDirectoryName(mappingCachePath);
        if (String.IsNullOrWhiteSpace(parent)) parent = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InformationSystemUserTracker");
        string rootKey = Sha256(Path.GetFullPath(sharedRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).ToUpperInvariant()).Substring(0, 24), workspace = Path.Combine(parent, "Local Workspaces", rootKey);
        if (workspace.Length > 120) workspace = Path.Combine(parent, "W", rootKey.Substring(0, 16));
        Directory.CreateDirectory(workspace);bool harden;lock (localWorkspaceAclGate) harden = hardenedLocalWorkspaces.Add(workspace);
        if (harden) try { HardenLocalWorkspaceAcl(workspace); } catch { lock (localWorkspaceAclGate) hardenedLocalWorkspaces.Remove(workspace);throw; }
        return workspace;
    }

    private static string LocalWorkspaceSystemPath(string workspaceRoot, string filename)
    {
        string system = Path.Combine(workspaceRoot, SystemDirectoryName);Directory.CreateDirectory(system);return Path.Combine(system, filename);
    }

    private static string LocalWorkspaceManifestPath(string workspaceRoot) { return LocalWorkspaceSystemPath(workspaceRoot, LocalWorkspaceManifestFilename); }
    private static string LocalWorkspaceBasePath(string workspaceRoot) { return LocalWorkspaceSystemPath(workspaceRoot, LocalWorkspaceBaseFilename); }
    private static string LocalWorkspaceStatePath(string workspaceRoot) { return LocalWorkspaceSystemPath(workspaceRoot, LocalWorkspaceStateFilename); }
    private static string LocalWorkspacePublicationPath(string workspaceRoot) { return LocalWorkspaceSystemPath(workspaceRoot, LocalWorkspacePublicationFilename); }
    private static string LocalWorkspacePublicationProgressPath(string workspaceRoot) { return LocalWorkspaceSystemPath(workspaceRoot, LocalWorkspacePublicationProgressFilename); }

    private void WriteLocalWorkspaceBaseDatabase(string workspaceRoot, Dictionary<string, object> database, string sharedSha256)
    {
        ValidateDatabaseObject(database);if (!IsSha256(sharedSha256)) throw new InvalidDataException("The local workspace base has an invalid shared-master hash.");
        string path = LocalWorkspaceBasePath(workspaceRoot), clear = json.Serialize(new Dictionary<string, object> { { "sharedSha256", sharedSha256.ToLowerInvariant() }, { "database", database } });
        if (System.Text.Encoding.UTF8.GetByteCount(clear) > ManifestLimit * 2) throw new InvalidDataException("The local workspace reconciliation base exceeds the safety limit.");
        WriteProtectedLocalJson(path, "workspace-base-database", clear);byte[] protectedBytes = File.ReadAllBytes(path);AtomicWrite(path + ".sha256", System.Text.Encoding.ASCII.GetBytes(Sha256Bytes(protectedBytes) + Environment.NewLine));
    }

    private bool TryReadLocalWorkspaceBaseDatabase(string workspaceRoot, out Dictionary<string, object> database, out string sharedSha256)
    {
        database = null;sharedSha256 = null;string path = LocalWorkspaceBasePath(workspaceRoot), checksumPath = path + ".sha256";
        try
        {
            if (!File.Exists(path) || !File.Exists(checksumPath)) return false;byte[] bytes = File.ReadAllBytes(path);string expected = ReadText(checksumPath, 1024).Trim();
            if (!IsSha256(expected) || !String.Equals(expected, Sha256Bytes(bytes), StringComparison.OrdinalIgnoreCase)) return false;
            Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "workspace-base-database", ManifestLimit * 2)));
            sharedSha256 = Convert.ToString(envelope["sharedSha256"], CultureInfo.InvariantCulture);if (!IsSha256(sharedSha256)) return false;database = ObjectDictionary(envelope["database"]);ValidateDatabaseObject(database);return true;
        }
        catch { database = null;sharedSha256 = null;return false; }
    }

    private Dictionary<string, object> MergeLocalWorkspaceDatabase(Dictionary<string, object> baseDatabase, Dictionary<string, object> localDatabase, Dictionary<string, object> sharedDatabase)
    {
        ValidateDatabaseObject(baseDatabase);ValidateDatabaseObject(localDatabase);ValidateDatabaseObject(sharedDatabase);
        var conflicts = new List<string>();object[] mergedSystems = MergeRecordArray("system", ObjectArray(baseDatabase["systems"]), ObjectArray(localDatabase["systems"]), ObjectArray(sharedDatabase["systems"]), conflicts), mergedUsers = MergeRecordArray("user", ObjectArray(baseDatabase["users"]), ObjectArray(localDatabase["users"]), ObjectArray(sharedDatabase["users"]), conflicts);
        if (conflicts.Count > 0) throw new InvalidDataException("The shared master and this computer changed the same " + conflicts.Count.ToString(CultureInfo.InvariantCulture) + " record(s): " + String.Join(", ", conflicts.Take(20).ToArray()) + ". The exclusive session lock prevented a stale overwrite; reconcile these records before publishing.");
        Dictionary<string, object> merged = ObjectDictionary(json.DeserializeObject(json.Serialize(sharedDatabase)));merged["systems"] = mergedSystems;merged["users"] = mergedUsers;merged["updated"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);merged["lastWriterVersion"] = CurrentApplicationVersion;ValidateDatabaseObject(merged);return merged;
    }

    private object[] MergeRecordArray(string label, object[] baseItems, object[] localItems, object[] sharedItems, List<string> conflicts)
    {
        Dictionary<string, Dictionary<string, object>> baseline = RecordsById(baseItems, label), local = RecordsById(localItems, label), shared = RecordsById(sharedItems, label);var ids = new SortedSet<string>(baseline.Keys, StringComparer.Ordinal);ids.UnionWith(local.Keys);ids.UnionWith(shared.Keys);var merged = new List<object>();
        foreach (string id in ids)
        {
            Dictionary<string, object> baseItem, localItem, sharedItem;baseline.TryGetValue(id, out baseItem);local.TryGetValue(id, out localItem);shared.TryGetValue(id, out sharedItem);
            Dictionary<string, object> selected;if (RecordsEqual(localItem, baseItem)) selected = sharedItem;else if (RecordsEqual(sharedItem, baseItem)) selected = localItem;else if (RecordsEqual(localItem, sharedItem)) selected = localItem;else { conflicts.Add(label + " " + id);continue; }
            if (selected != null) merged.Add(ObjectDictionary(json.DeserializeObject(json.Serialize(selected))));
        }
        return merged.ToArray();
    }

    private static Dictionary<string, Dictionary<string, object>> RecordsById(object[] items, string label)
    {
        var result = new Dictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);foreach (object value in items) { Dictionary<string, object> record = ObjectDictionary(value);string id = Convert.ToString(record["id"], CultureInfo.InvariantCulture);if (String.IsNullOrWhiteSpace(id) || result.ContainsKey(id)) throw new InvalidDataException("The " + label + " record set contains a missing or duplicate identity.");result[id] = record; }return result;
    }

    private bool RecordsEqual(Dictionary<string, object> left, Dictionary<string, object> right)
    {
        if (left == null || right == null) return left == null && right == null;return String.Equals(Sha256(json.Serialize(left)), Sha256(json.Serialize(right)), StringComparison.OrdinalIgnoreCase);
    }
}
