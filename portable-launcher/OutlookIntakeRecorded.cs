using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

/// <summary>
/// Evidence already recorded in this system's local database, indexed by the
/// SHA-256 of the PDF itself. Outlook intake skips an attachment whose PDF is
/// already recorded, so re-sent copies never reach Sync review. Stored evidence
/// is often a .pdf.zip, whose recorded hash is the container's; those PDFs are
/// read from the zip once and cached by path, size, and modified time.
/// </summary>
internal sealed partial class PortableStorage
{
    private const int OutlookRecordedHashCacheLimit = 200000;

    internal Dictionary<string, string> OutlookRecordedEvidence(string systemId)
    {
        var recorded = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string text = ReadWorkingManifest(systemId);
        if (String.IsNullOrWhiteSpace(text)) return recorded;
        Dictionary<string, object> database = ValidateDatabase(text);
        string localRoot = Path.GetFullPath(LocalEvidenceRoot(systemId)), sharedRoot = Path.GetFullPath(Root(systemId));
        string cachePath = Path.Combine(OutlookIntakeDirectory(systemId), "recorded-pdf-hashes.json");
        Dictionary<string, object> cache = null;
        try { cache = File.Exists(cachePath) ? json.DeserializeObject(File.ReadAllText(cachePath, Encoding.UTF8)) as Dictionary<string, object> : null; } catch (Exception) { }
        var previous = cache ?? new Dictionary<string, object>();var current = new Dictionary<string, object>(StringComparer.Ordinal);
        // Evidence stored on this computer before publication lives at a local path registered against its canonical path.
        var localCopies = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Dictionary<string, object> item in ReadLocalEvidenceMap(systemId).Values)
        {
            if (!item.ContainsKey("destination") || !item.ContainsKey("localPath")) continue;
            localCopies[Convert.ToString(item["destination"], CultureInfo.InvariantCulture).Replace('\\', '/')] = Convert.ToString(item["localPath"], CultureInfo.InvariantCulture);
        }
        foreach (object userValue in ObjectArray(database["users"]))
        {
            Dictionary<string, object> user = ObjectDictionary(userValue);
            string organization = user.ContainsKey("organization") ? Convert.ToString(user["organization"], CultureInfo.InvariantCulture) : "";
            string owner = CleanLine(Convert.ToString(user.ContainsKey("last") ? user["last"] : "", CultureInfo.InvariantCulture) + ", " + Convert.ToString(user.ContainsKey("first") ? user["first"] : "", CultureInfo.InvariantCulture), 200);
            foreach (object artifactValue in ObjectArray(user["artifacts"]))
            {
                Dictionary<string, object> artifact = ObjectDictionary(artifactValue);
                string kind = artifact.ContainsKey("kind") ? Convert.ToString(artifact["kind"], CultureInfo.InvariantCulture) : "", filename = artifact.ContainsKey("filename") ? Convert.ToString(artifact["filename"], CultureInfo.InvariantCulture) : "";
                string label = owner + " (" + CleanLine(kind, 80) + ")";
                string hash = artifact.ContainsKey("sha256") ? Convert.ToString(artifact["sha256"], CultureInfo.InvariantCulture) : "";
                if (hash != null && hash.Length == 64 && !recorded.ContainsKey(hash)) recorded[hash] = label;
                // A plain PDF's recorded hash is already the PDF hash; only zipped evidence needs its PDF read.
                if (String.IsNullOrWhiteSpace(filename) || !filename.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) continue;
                string path = OutlookRecordedEvidencePath(artifact, filename, kind, organization, localRoot, sharedRoot, localCopies);
                if (path == null) continue;
                try
                {
                    var info = new FileInfo(path);
                    string key = path + "|" + info.Length.ToString(CultureInfo.InvariantCulture) + "|" + info.LastWriteTimeUtc.Ticks.ToString(CultureInfo.InvariantCulture);
                    string pdfHash = previous.ContainsKey(key) ? Convert.ToString(previous[key], CultureInfo.InvariantCulture) : null;
                    if (pdfHash == null || pdfHash.Length != 64) pdfHash = EvidencePdfSha256(path);
                    if (pdfHash == null || pdfHash.Length != 64) continue;
                    if (current.Count < OutlookRecordedHashCacheLimit) current[key] = pdfHash;
                    if (!recorded.ContainsKey(pdfHash)) recorded[pdfHash] = label;
                }
                catch (Exception) { } // An unreadable stored file cannot prove a duplicate; the attachment continues to normal intake.
            }
        }
        try { AtomicWrite(cachePath, Encoding.UTF8.GetBytes(json.Serialize(current))); } catch (Exception) { }
        return recorded;
    }

    // A registered local copy is preferred, then the canonical local path, then the shared copy.
    private static string OutlookRecordedEvidencePath(Dictionary<string, object> artifact, string filename, string kind, string organization, string localRoot, string sharedRoot, Dictionary<string, string> localCopies)
    {
        string relative = artifact.ContainsKey("path") ? Convert.ToString(artifact["path"], CultureInfo.InvariantCulture) : "";
        try
        {
            if (String.IsNullOrWhiteSpace(relative)) relative = "Organizations/" + ValidOrganizationName(organization) + "/" + OrganizationArtifactStorageFolder(ArtifactStorageFolder(kind), organization) + "/" + filename;
        }
        catch (Exception) { return null; }
        relative = relative.Replace('\\', '/').TrimStart('/');
        string localCopy;
        var candidates = new List<Tuple<string, string>>();
        if (localCopies.TryGetValue(relative, out localCopy)) candidates.Add(Tuple.Create(localRoot, localCopy));
        candidates.Add(Tuple.Create(localRoot, relative));candidates.Add(Tuple.Create(sharedRoot, relative));
        foreach (Tuple<string, string> item in candidates)
        {
            string root = item.Item1.TrimEnd(Path.DirectorySeparatorChar), candidate = Path.GetFullPath(Path.Combine(root, item.Item2.Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar)));
            if (!candidate.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}
