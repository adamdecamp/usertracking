using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;

/// <summary>
/// Evidence already recorded in this system's local database, indexed by the
/// SHA-256 of the PDF itself. Outlook intake skips an attachment whose PDF is
/// already recorded, so re-sent copies never reach Sync review.
/// </summary>
internal sealed class OutlookRecordedIndex
{
    /// <summary>PDF SHA-256 (or a plain PDF's recorded hash) to "Last, First (Kind)".</summary>
    internal readonly Dictionary<string, string> Hashes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    /// <summary>Zipped evidence whose PDF hash is not known yet, by stored name without ".zip".</summary>
    internal readonly Dictionary<string, List<OutlookRecordedZip>> PendingByName = new Dictionary<string, List<OutlookRecordedZip>>(StringComparer.OrdinalIgnoreCase);
    /// <summary>Recorded container SHA-256 to the PDF SHA-256 inside it.</summary>
    internal readonly Dictionary<string, string> Cache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    internal readonly HashSet<string> Referenced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    internal string LocalRoot, SharedRoot;
    internal Dictionary<string, string> LocalCopies;
    internal int Pending, HashedThisCheck;
    internal bool Changed;
}

internal sealed class OutlookRecordedZip
{
    internal string ContainerSha256, Filename, Kind, Organization, Label, Path;
    internal bool Done;
}

/// <summary>
/// Stored evidence is usually a .pdf.zip whose recorded hash is the container's,
/// so the PDF inside has to be read once. Reading every zip on the first check
/// took longer than Outlook intake's time limit on large systems, so the work is
/// spread out: each check hashes zips for at most OutlookRecordedHashBudget and
/// caches the result by the recorded container hash, which needs no file access
/// to look up. A zip whose name matches the attachment is always checked at once,
/// because a re-sent file usually keeps its name.
/// </summary>
internal sealed partial class PortableStorage
{
    private const int OutlookRecordedHashCacheLimit = 200000;
    internal TimeSpan OutlookRecordedHashBudget = TimeSpan.FromSeconds(30);

    private static string OutlookRecordedCachePath(string directory) { return System.IO.Path.Combine(directory, "recorded-pdf-hashes.json"); }

    internal OutlookRecordedIndex OutlookRecordedEvidence(string systemId)
    {
        var index = new OutlookRecordedIndex();
        string text = ReadWorkingManifest(systemId);
        if (String.IsNullOrWhiteSpace(text)) return index;
        Dictionary<string, object> database = ValidateDatabase(text);
        index.LocalRoot = System.IO.Path.GetFullPath(LocalEvidenceRoot(systemId));index.SharedRoot = System.IO.Path.GetFullPath(Root(systemId));
        try
        {
            string cachePath = OutlookRecordedCachePath(OutlookIntakeDirectory(systemId));
            var cache = File.Exists(cachePath) ? json.DeserializeObject(File.ReadAllText(cachePath, Encoding.UTF8)) as Dictionary<string, object> : null;
            // Older caches were keyed by path, size, and time; only container-hash keys are kept.
            if (cache != null) foreach (KeyValuePair<string, object> pair in cache) { string value = Convert.ToString(pair.Value, CultureInfo.InvariantCulture); if (IsSha256(pair.Key.ToLowerInvariant()) && value != null && IsSha256(value.ToLowerInvariant())) index.Cache[pair.Key] = value; }
        }
        catch (Exception) { }
        // Evidence stored on this computer before publication lives at a local path registered against its canonical path.
        index.LocalCopies = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Dictionary<string, object> item in ReadLocalEvidenceMap(systemId).Values)
        {
            if (!item.ContainsKey("destination") || !item.ContainsKey("localPath")) continue;
            index.LocalCopies[Convert.ToString(item["destination"], CultureInfo.InvariantCulture).Replace('\\', '/')] = Convert.ToString(item["localPath"], CultureInfo.InvariantCulture);
        }
        var pending = new List<OutlookRecordedZip>();
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
                bool hasHash = hash != null && hash.Length == 64;
                if (hasHash && !index.Hashes.ContainsKey(hash)) index.Hashes[hash] = label;
                // A plain PDF's recorded hash is already the PDF hash; only zipped evidence needs its PDF read.
                if (String.IsNullOrWhiteSpace(filename) || !filename.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) continue;
                string cached;
                if (hasHash) { index.Referenced.Add(hash); if (index.Cache.TryGetValue(hash, out cached)) { if (!index.Hashes.ContainsKey(cached)) index.Hashes[cached] = label; continue; } }
                var zip = new OutlookRecordedZip { ContainerSha256 = hasHash ? hash : null, Filename = filename, Kind = kind, Organization = organization, Label = label, Path = artifact.ContainsKey("path") ? Convert.ToString(artifact["path"], CultureInfo.InvariantCulture) : "" };
                pending.Add(zip);
                string name = filename.Substring(0, filename.Length - 4);List<OutlookRecordedZip> named;
                if (!index.PendingByName.TryGetValue(name, out named)) index.PendingByName[name] = named = new List<OutlookRecordedZip>();
                named.Add(zip);
            }
        }
        index.Pending = pending.Count;
        var clock = Stopwatch.StartNew();
        foreach (OutlookRecordedZip zip in pending)
        {
            if (clock.Elapsed >= OutlookRecordedHashBudget) break;
            OutlookRecordedHash(index, zip);
        }
        return index;
    }

    /// <summary>The recorded owner of this exact PDF, or null. Checks a same-named zip at once if it is not hashed yet.</summary>
    internal string OutlookRecordedMatch(OutlookRecordedIndex index, string pdfSha256, string attachmentFilename)
    {
        string label;
        if (index.Hashes.TryGetValue(pdfSha256, out label)) return label;
        List<OutlookRecordedZip> named;
        if (!index.PendingByName.TryGetValue((attachmentFilename ?? "").Trim(), out named)) return null;
        foreach (OutlookRecordedZip zip in named) if (String.Equals(OutlookRecordedHash(index, zip), pdfSha256, StringComparison.OrdinalIgnoreCase)) return zip.Label;
        return null;
    }

    internal void SaveOutlookRecordedCache(string systemId, OutlookRecordedIndex index)
    {
        if (index == null || !index.Changed) return;
        var keep = index.Cache.Where(pair => index.Referenced.Contains(pair.Key)).Take(OutlookRecordedHashCacheLimit).ToDictionary(pair => pair.Key, pair => (object)pair.Value);
        try { AtomicWrite(OutlookRecordedCachePath(OutlookIntakeDirectory(systemId)), Encoding.UTF8.GetBytes(json.Serialize(keep))); } catch (Exception) { }
    }

    // Reads one zip once; returns the PDF hash or null. Cached only when the file still matches its recorded hash.
    private string OutlookRecordedHash(OutlookRecordedIndex index, OutlookRecordedZip zip)
    {
        if (zip.Done) return null;
        zip.Done = true;
        string path = OutlookRecordedEvidencePath(zip, index.LocalRoot, index.SharedRoot, index.LocalCopies);
        if (path == null) return null;
        try
        {
            byte[] bytes = File.ReadAllBytes(path);string pdfHash;
            using (var input = new MemoryStream(bytes, false))
            using (var archive = new ZipArchive(input, ZipArchiveMode.Read, false))
            {
                ZipArchiveEntry entry = archive.Entries.Single(item => !item.FullName.EndsWith("/", StringComparison.Ordinal) && item.FullName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase));
                using (Stream pdf = entry.Open()) pdfHash = Sha256Stream(pdf);
            }
            index.HashedThisCheck++;
            if (!index.Hashes.ContainsKey(pdfHash)) index.Hashes[pdfHash] = zip.Label;
            if (zip.ContainerSha256 != null && String.Equals(Sha256Bytes(bytes), zip.ContainerSha256, StringComparison.OrdinalIgnoreCase)) { index.Cache[zip.ContainerSha256] = pdfHash;index.Changed = true; }
            return pdfHash;
        }
        catch (Exception) { return null; } // An unreadable stored file cannot prove a duplicate; the attachment continues to normal intake.
    }

    // A registered local copy is preferred, then the canonical local path, then the shared copy.
    private static string OutlookRecordedEvidencePath(OutlookRecordedZip zip, string localRoot, string sharedRoot, Dictionary<string, string> localCopies)
    {
        string relative = zip.Path ?? "";
        try
        {
            if (String.IsNullOrWhiteSpace(relative)) relative = "Organizations/" + ValidOrganizationName(zip.Organization) + "/" + OrganizationArtifactStorageFolder(ArtifactStorageFolder(zip.Kind), zip.Organization) + "/" + zip.Filename;
        }
        catch (Exception) { return null; }
        relative = relative.Replace('\\', '/').TrimStart('/');
        string localCopy;
        var candidates = new List<Tuple<string, string>>();
        if (localCopies.TryGetValue(relative, out localCopy)) candidates.Add(Tuple.Create(localRoot, localCopy));
        candidates.Add(Tuple.Create(localRoot, relative));candidates.Add(Tuple.Create(sharedRoot, relative));
        foreach (Tuple<string, string> item in candidates)
        {
            string root = item.Item1.TrimEnd(System.IO.Path.DirectorySeparatorChar), candidate = System.IO.Path.GetFullPath(System.IO.Path.Combine(root, item.Item2.Replace('/', System.IO.Path.DirectorySeparatorChar).TrimStart(System.IO.Path.DirectorySeparatorChar)));
            if (!candidate.StartsWith(root + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}
