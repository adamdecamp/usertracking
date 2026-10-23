using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

internal sealed partial class PortableStorage
{
    private const int CatalogHeadsVersion = 1;
    private const long CatalogHeadsLimit = 256L * 1024;
    private sealed class CatalogRecoveryHead { public string File;public string Sha256;public string SavedAtUtc; }

    private static string CatalogRecoveryDirectory(string root) { string path = Path.Combine(root, SystemDirectoryName, "Database Catalogs");Directory.CreateDirectory(path);return path; }
    private static string CatalogHeadsPath(string root) { return Path.Combine(CatalogRecoveryDirectory(root), "catalog-heads.json"); }

    private CatalogRecoveryHead CaptureCatalogRecoveryHead(string root, string manifestPath)
    {
        try
        {
            if (!File.Exists(manifestPath)) return null;byte[] bytes = ReadAllBytesWithRetry(manifestPath, ManifestLimit);string hash = Sha256Bytes(bytes), expected = ReadManifestChecksumHash(manifestPath, false);
            if (!String.Equals(hash, expected, StringComparison.OrdinalIgnoreCase)) return null;
            return PersistCatalogRecoveryCopy(root, bytes, hash);
        }
        catch { return null; }
    }

    private CatalogRecoveryHead PersistCatalogRecoveryCopy(string root, byte[] bytes, string hash)
    {
        if (!IsSha256(hash) || !String.Equals(hash, Sha256Bytes(bytes), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A catalog recovery copy failed SHA-256 validation.");
        string file = "catalog-" + hash.ToLowerInvariant() + ".json", path = Path.Combine(CatalogRecoveryDirectory(root), file);
        if (!File.Exists(path) || !String.Equals(TryFileHash(path), hash, StringComparison.OrdinalIgnoreCase)) AtomicWrite(path, bytes);
        return new CatalogRecoveryHead { File = file, Sha256 = hash.ToLowerInvariant(), SavedAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) };
    }

    private void CommitCatalogRecoveryHeads(string root, byte[] currentBytes, string currentHash, CatalogRecoveryHead previous)
    {
        CatalogRecoveryHead current = PersistCatalogRecoveryCopy(root, currentBytes, currentHash);CatalogRecoveryHead priorCurrent = null;string headsPath = CatalogHeadsPath(root);
        try
        {
            if (File.Exists(headsPath))
            {
                Dictionary<string, object> existing = ObjectDictionary(json.DeserializeObject(ReadText(headsPath, CatalogHeadsLimit))), head = existing.ContainsKey("current") && existing["current"] != null ? ObjectDictionary(existing["current"]) : null;
                if (head != null) priorCurrent = ParseCatalogHead(head);
            }
        }
        catch { }
        if (previous == null) previous = priorCurrent;
        var value = new Dictionary<string, object> { { "version", CatalogHeadsVersion }, { "updatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "current", CatalogHeadObject(current) }, { "previous", previous == null || String.Equals(previous.Sha256, current.Sha256, StringComparison.OrdinalIgnoreCase) ? null : CatalogHeadObject(previous) } };
        byte[] headsBytes = Encoding.UTF8.GetBytes(json.Serialize(value));AtomicWrite(headsPath, headsBytes);AtomicWrite(headsPath + ".sha256", Encoding.ASCII.GetBytes(Sha256Bytes(headsBytes) + "  " + Path.GetFileName(headsPath) + Environment.NewLine));
        foreach (string stale in Directory.EnumerateFiles(CatalogRecoveryDirectory(root), "catalog-*.json", SearchOption.TopDirectoryOnly).Where(path => !String.Equals(Path.GetFileName(path), "catalog-heads.json", StringComparison.OrdinalIgnoreCase) && !String.Equals(Path.GetFileName(path), current.File, StringComparison.OrdinalIgnoreCase) && (previous == null || !String.Equals(Path.GetFileName(path), previous.File, StringComparison.OrdinalIgnoreCase))).ToArray()) TryDelete(stale);
    }

    private void EnsureCatalogRecoveryHeads(string root, string manifestPath)
    {
        byte[] bytes = ReadAllBytesWithRetry(manifestPath, ManifestLimit);string hash = Sha256Bytes(bytes), headsPath = CatalogHeadsPath(root);
        try
        {
            if (File.Exists(headsPath))
            {
                Dictionary<string, object> heads = ObjectDictionary(json.DeserializeObject(ReadText(headsPath, CatalogHeadsLimit)));CatalogRecoveryHead current = ParseCatalogHead(ObjectDictionary(heads["current"]));string currentPath = Path.Combine(CatalogRecoveryDirectory(root), current.File);
                if (String.Equals(current.Sha256, hash, StringComparison.OrdinalIgnoreCase) && File.Exists(currentPath) && String.Equals(TryFileHash(currentPath), hash, StringComparison.OrdinalIgnoreCase)) return;
            }
        }
        catch { }
        CommitCatalogRecoveryHeads(root, bytes, hash, null);
    }

    private static Dictionary<string, object> CatalogHeadObject(CatalogRecoveryHead head) { return new Dictionary<string, object> { { "file", head.File }, { "sha256", head.Sha256 }, { "savedAtUtc", head.SavedAtUtc } }; }
    private static CatalogRecoveryHead ParseCatalogHead(Dictionary<string, object> value)
    {
        string file = Convert.ToString(value["file"], CultureInfo.InvariantCulture), hash = Convert.ToString(value["sha256"], CultureInfo.InvariantCulture), saved = Convert.ToString(value["savedAtUtc"], CultureInfo.InvariantCulture);DateTime parsed;
        if (String.IsNullOrWhiteSpace(file) || Path.GetFileName(file) != file || !file.StartsWith("catalog-", StringComparison.Ordinal) || !file.EndsWith(".json", StringComparison.Ordinal) || !IsSha256(hash) || !DateTime.TryParse(saved, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out parsed)) throw new InvalidDataException("A catalog recovery head is invalid.");
        return new CatalogRecoveryHead { File = file, Sha256 = hash.ToLowerInvariant(), SavedAtUtc = saved };
    }

    private HashSet<string> CatalogRecoveryShardFiles(string root)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);string headsPath = CatalogHeadsPath(root);if (!File.Exists(headsPath)) return result;
        try
        {
            Dictionary<string, object> heads = ObjectDictionary(json.DeserializeObject(ReadText(headsPath, CatalogHeadsLimit)));
            foreach (string key in new[] { "current", "previous" })
            {
                if (!heads.ContainsKey(key) || heads[key] == null) continue;CatalogRecoveryHead head = ParseCatalogHead(ObjectDictionary(heads[key]));string path = Path.Combine(CatalogRecoveryDirectory(root), head.File);
                if (!File.Exists(path) || !String.Equals(TryFileHash(path), head.Sha256, StringComparison.OrdinalIgnoreCase)) continue;Dictionary<string, object> catalog = ObjectDictionary(json.DeserializeObject(ReadText(path, ManifestLimit)));
                if (!catalog.ContainsKey("userShards")) continue;foreach (object shardValue in ObjectArray(catalog["userShards"])) { Dictionary<string, object> shard = ObjectDictionary(shardValue);string file = Convert.ToString(shard["file"], CultureInfo.InvariantCulture);if (Path.GetFileName(file) == file) result.Add(file); }
            }
        }
        catch { }
        return result;
    }

    public string ReadCatalogRecoveryStatus(string systemId)
    {
        lock (RootLock(systemId))
        {
            string root = Root(systemId), path = CatalogHeadsPath(root);if (!File.Exists(path)) return "{\"available\":false,\"current\":null,\"previous\":null}";
            byte[] bytes = ReadAllBytesWithRetry(path, CatalogHeadsLimit);string checksumPath = path + ".sha256", actual = Sha256Bytes(bytes), expected = File.Exists(checksumPath) ? ReadText(checksumPath, 1024).Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() : "";
            if (!String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The catalog recovery heads failed their SHA-256 integrity check.");
            Dictionary<string, object> value = ObjectDictionary(json.DeserializeObject(Encoding.UTF8.GetString(bytes)));if (Convert.ToInt32(value["version"], CultureInfo.InvariantCulture) != CatalogHeadsVersion) throw new InvalidDataException("The catalog recovery heads version is unsupported.");
            value["available"] = true;value["automaticRollback"] = false;return json.Serialize(value);
        }
    }

    public string RestorePreviousCatalog(string systemId)
    {
        lock (RootLock(systemId))
        {
            string root = Root(systemId), headsPath = CatalogHeadsPath(root);if (!File.Exists(headsPath)) throw new InvalidDataException("No catalog recovery history is available.");
            Dictionary<string, object> heads = ObjectDictionary(json.DeserializeObject(ReadText(headsPath, CatalogHeadsLimit)));if (!heads.ContainsKey("previous") || heads["previous"] == null) throw new InvalidDataException("No previous catalog is available to restore.");
            CatalogRecoveryHead previous = ParseCatalogHead(ObjectDictionary(heads["previous"])), current = ParseCatalogHead(ObjectDictionary(heads["current"]));string source = Path.Combine(CatalogRecoveryDirectory(root), previous.File);byte[] bytes = ReadAllBytesWithRetry(source, ManifestLimit);
            if (!String.Equals(Sha256Bytes(bytes), previous.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The previous catalog failed its SHA-256 integrity check.");
            Dictionary<string, object> logical = ReadDatabaseManifest(root, Encoding.UTF8.GetString(bytes));string manifest = SystemFile(root, ManifestFilename);AtomicWrite(manifest, bytes);WriteManifestChecksum(manifest, previous.Sha256);CommitCatalogRecoveryHeads(root, bytes, previous.Sha256, current);SaveLocalManifestCache(root, json.Serialize(logical), previous.Sha256);
            return json.Serialize(new Dictionary<string, object> { { "restored", true }, { "manifestSha256", previous.Sha256 }, { "restoredAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) } });
        }
    }
}
