using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

internal sealed partial class PortableStorage
{
    private Dictionary<string, Dictionary<string, object>> RebuildPublishedEvidenceRecords(string root, string organization, Dictionary<string, object> database)
    {
        var records = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);string now = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        if (database == null || !database.ContainsKey("users")) return records;
        foreach (object rawUser in ObjectArray(database["users"]))
        {
            Dictionary<string, object> user = ObjectDictionary(rawUser);
            if (!user.ContainsKey("artifacts")) continue;
            foreach (object rawArtifact in ObjectArray(user["artifacts"]))
            {
                Dictionary<string, object> artifact = ObjectDictionary(rawArtifact);string relative = artifact.ContainsKey("path") ? Convert.ToString(artifact["path"], CultureInfo.InvariantCulture).Replace('\\', '/') : "";
                if (String.IsNullOrWhiteSpace(relative)) continue;
                try { if (!String.Equals(PublicationOrganization(relative), organization, StringComparison.OrdinalIgnoreCase)) continue; }
                catch (InvalidDataException) { continue; }
                string physical;
                try { physical = SafeRelativePath(root, relative); }
                catch { continue; }
                var info = new FileInfo(physical);info.Refresh();if (!info.Exists) continue;
                string hash;
                try { hash = TryFileHash(physical); }
                catch { continue; }
                if (!IsSha256(hash)) continue;
                records[relative] = new Dictionary<string, object> { { "operationKey", Sha256("recovered-publish-file-v1\n" + relative.ToUpperInvariant() + "\n" + hash.ToLowerInvariant()) }, { "path", relative }, { "size", info.Length }, { "lastModifiedUnixMs", new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds() }, { "sha256", hash.ToLowerInvariant() }, { "publishedAtUtc", now }, { "publishedBy", actor }, { "recovered", true } };
            }
        }
        return records;
    }
}
