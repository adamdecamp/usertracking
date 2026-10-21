using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

internal sealed partial class PortableStorage
{
    private static bool HasUnindexedAssociatedLocalEvidence(string workspaceRoot, Dictionary<string, object> database)
    {
        var filenames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (object userValue in ObjectArray(database["users"]))
        {
            Dictionary<string, object> user = ObjectDictionary(userValue);
            foreach (object artifactValue in ObjectArray(user["artifacts"]))
            {
                Dictionary<string, object> artifact = ObjectDictionary(artifactValue);string filename = Convert.ToString(artifact["filename"], CultureInfo.InvariantCulture);
                if (!String.IsNullOrWhiteSpace(filename)) { filenames.Add(filename);if (filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) filenames.Add(filename + ".zip"); }
            }
        }
        if (filenames.Count == 0) return false;
        string organizations = Path.Combine(workspaceRoot, "Organizations");if (!Directory.Exists(organizations)) return false;
        foreach (DirectoryScanEntry organizationEntry in EnumerateDirectoryEntries(workspaceRoot, organizations).Where(entry => entry.IsDirectory && !entry.IsReparsePoint))
        {
            string organizationDirectory = organizationEntry.Path;foreach (DirectoryScanEntry entry in EnumerateDirectoryEntries(workspaceRoot, organizationDirectory)) if (!entry.IsDirectory && filenames.Contains(Path.GetFileName(entry.Path))) return true;
            string organization = Path.GetFileName(organizationDirectory), incoming = Path.Combine(organizationDirectory, organization + " Incoming");
            if (Directory.Exists(incoming)) { EnsureReparseSafePath(workspaceRoot, incoming);foreach (DirectoryScanEntry entry in EnumerateDirectoryEntries(workspaceRoot, incoming)) if (!entry.IsDirectory && filenames.Contains(Path.GetFileName(entry.Path))) return true; }
        }
        return false;
    }

    // A publication map is durable recovery state. Files can still be moved by a
    // completed retry, cleanup, or operator action before the next commit reads
    // that map. Reconcile those stale references by content hash before treating
    // the evidence as absent.
    private void ReconcileMissingPendingLocalEvidence(string systemId, Dictionary<string, object> database, Dictionary<string, Dictionary<string, object>> records, string workspaceRoot, PublicationHashCache hashCache, List<string> warnings, HashSet<string> isolatedEvidenceFilenames)
    {
        string sharedRoot = Root(systemId);bool changed = false;
        foreach (KeyValuePair<string, Dictionary<string, object>> pair in records.Where(value => Convert.ToBoolean(value.Value["pending"], CultureInfo.InvariantCulture)).ToArray())
        {
            Dictionary<string, object> item = pair.Value;string localRelative = Convert.ToString(item["localPath"], CultureInfo.InvariantCulture).Replace('\\', '/'), expectedLocal = SafeRelativePath(workspaceRoot, localRelative);
            if (File.Exists(expectedLocal)) continue;

            string recoveredLocal = FindVerifiedMovedLocalEvidence(workspaceRoot, item, hashCache);
            if (!String.IsNullOrWhiteSpace(recoveredLocal))
            {
                string destination = Convert.ToString(item["destination"], CultureInfo.InvariantCulture).Replace('\\', '/');
                if (recoveredLocal.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) && destination.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) destination += ".zip";
                RegisterLocalEvidenceInMap(records, workspaceRoot, recoveredLocal, destination, pair.Key, hashCache.Container(recoveredLocal));changed = true;continue;
            }

            string recoveredShared = FindVerifiedSharedEvidence(sharedRoot, item, hashCache);
            if (!String.IsNullOrWhiteSpace(recoveredShared))
            {
                string relative = Relative(sharedRoot, recoveredShared).Replace(Path.DirectorySeparatorChar, '/'), sharedHash = hashCache.Container(recoveredShared), pdfHash = hashCache.Pdf(recoveredShared);
                var receipt = new Dictionary<string, object> { { "destination", relative }, { "localPath", localRelative }, { "sha256", Convert.ToString(item["sha256"], CultureInfo.InvariantCulture) }, { "publishedSha256", sharedHash }, { "pdfSha256", pdfHash }, { "publicationSourceDestination", pair.Key }, { "pending", false } };
                var aliases = new HashSet<string>(StringComparer.OrdinalIgnoreCase);if (item.ContainsKey("aliases")) foreach (object value in ObjectArray(item["aliases"])) aliases.Add(Convert.ToString(value, CultureInfo.InvariantCulture).Replace('\\', '/'));if (!String.Equals(pair.Key, relative, StringComparison.OrdinalIgnoreCase)) aliases.Add(pair.Key);if (aliases.Count > 0) receipt["aliases"] = aliases.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).Cast<object>().ToArray();
                records.Remove(pair.Key);records[relative] = receipt;changed = true;continue;
            }

            int removedReferences = RemoveMissingDatabaseEvidence(database, item, isolatedEvidenceFilenames);records.Remove(pair.Key);changed = true;
            string filename = Path.GetFileName(pair.Key), expectedShared = Convert.ToString(item["destination"], CultureInfo.InvariantCulture).Replace('\\', '/');
            warnings.Add(removedReferences > 0
                ? filename + ": the pending local evidence was absent at " + localRelative + " and no verified shared copy existed at " + expectedShared + ". " + removedReferences.ToString(CultureInfo.InvariantCulture) + " user-record reference(s) were isolated as Missing; unrelated publication work continued."
                : filename + ": a stale unreferenced publication entry was removed because no file existed at " + localRelative + " or the expected shared location " + expectedShared + ".");
        }
        if (changed) WriteLocalEvidenceMap(systemId, records);
    }

    private string FindVerifiedMovedLocalEvidence(string workspaceRoot, Dictionary<string, object> item, PublicationHashCache hashCache)
    {
        string expected = Convert.ToString(item["sha256"], CultureInfo.InvariantCulture);var relativeCandidates = EvidenceEntryRelativePaths(item);var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string relative in relativeCandidates)
        {
            names.Add(Path.GetFileName(relative));if (relative.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) names.Add(Path.GetFileName(relative) + ".zip");
            try { string exact = SafeRelativePath(workspaceRoot, relative);if (File.Exists(exact) && EvidenceHashMatches(exact, expected, hashCache)) return exact;if (relative.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && File.Exists(exact + ".zip") && EvidenceHashMatches(exact + ".zip", expected, hashCache)) return exact + ".zip"; }
            catch (ArgumentException) { }
        }
        string organization = EvidenceEntryOrganization(item), organizationRoot = String.IsNullOrWhiteSpace(organization) ? null : Path.Combine(workspaceRoot, "Organizations", organization);
        if (String.IsNullOrWhiteSpace(organizationRoot) || !Directory.Exists(organizationRoot)) return null;
        var queue = new Queue<string>();var matches = new List<string>();queue.Enqueue(organizationRoot);int visitedDirectories = 0, visitedEntries = 0;
        while (queue.Count > 0 && visitedDirectories < 10000 && visitedEntries < 100000)
        {
            string directory = queue.Dequeue();visitedDirectories++;
            DirectoryScanEntry[] entries;try { entries = EnumerateDirectoryEntries(workspaceRoot, directory); } catch { continue; }
            foreach (DirectoryScanEntry entry in entries)
            {
                if (++visitedEntries > 100000) break;
                if (entry.IsDirectory) { if (!entry.IsReparsePoint) queue.Enqueue(entry.Path);continue; }
                if (!names.Contains(Path.GetFileName(entry.Path))) continue;
                try { EnsureReparseSafePath(workspaceRoot, entry.Path);if (EvidenceHashMatches(entry.Path, expected, hashCache)) matches.Add(entry.Path); } catch { }
            }
        }
        return matches.OrderBy(LocalEvidenceRecoveryPriority).ThenBy(value => value, StringComparer.OrdinalIgnoreCase).FirstOrDefault();
    }

    private string FindVerifiedSharedEvidence(string sharedRoot, Dictionary<string, object> item, PublicationHashCache hashCache)
    {
        string expected = Convert.ToString(item["sha256"], CultureInfo.InvariantCulture);var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string relativeValue in EvidenceEntryRelativePaths(item))
        {
            string relative = relativeValue.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ? relativeValue + ".zip" : relativeValue;
            if (!relative.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) || !seen.Add(relative)) continue;
            try { string candidate = SafeRelativePath(sharedRoot, relative);if (File.Exists(candidate) && EvidenceHashMatches(candidate, expected, hashCache)) return candidate; }
            catch (ArgumentException) { }
        }
        return null;
    }

    private static List<string> EvidenceEntryRelativePaths(Dictionary<string, object> item)
    {
        var result = new List<string>();
        foreach (string key in new[] { "destination", "localPath", "publicationSourceDestination" }) if (item.ContainsKey(key)) AddEvidenceRelativePath(result, Convert.ToString(item[key], CultureInfo.InvariantCulture));
        if (item.ContainsKey("aliases")) foreach (object value in ObjectArray(item["aliases"])) AddEvidenceRelativePath(result, Convert.ToString(value, CultureInfo.InvariantCulture));
        return result;
    }

    private static void AddEvidenceRelativePath(List<string> paths, string value)
    {
        string normalized = (value ?? "").Replace('\\', '/');if (normalized.StartsWith("Organizations/", StringComparison.OrdinalIgnoreCase) && !paths.Contains(normalized, StringComparer.OrdinalIgnoreCase)) paths.Add(normalized);
    }

    private static string EvidenceEntryOrganization(Dictionary<string, object> item)
    {
        foreach (string relative in EvidenceEntryRelativePaths(item)) { string[] parts = relative.Split('/');if (parts.Length >= 3 && String.Equals(parts[0], "Organizations", StringComparison.OrdinalIgnoreCase)) return parts[1]; }
        return "";
    }

    private static int LocalEvidenceRecoveryPriority(string path)
    {
        string normalized = path.Replace('\\', '/');if (normalized.Split('/').Any(IsCompleteStorageDirectory) && normalized.IndexOf("/" + PendingUploadDirectoryName + "/", StringComparison.OrdinalIgnoreCase) < 0) return 0;if (normalized.IndexOf("/" + PendingUploadDirectoryName + "/", StringComparison.OrdinalIgnoreCase) >= 0) return 1;if (normalized.IndexOf(" Incoming/", StringComparison.OrdinalIgnoreCase) >= 0) return 2;if (normalized.IndexOf(" Rework/", StringComparison.OrdinalIgnoreCase) >= 0) return 3;return 4;
    }

    private static bool EvidenceHashMatches(string path, string expected, PublicationHashCache hashCache)
    {
        try
        {
            string validationError;if (!TryValidateEvidenceFile(path, out validationError)) return false;
            if (String.Equals(hashCache.Container(path), expected, StringComparison.OrdinalIgnoreCase)) return true;
            return path.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) && String.Equals(hashCache.Pdf(path), expected, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static int RemoveMissingDatabaseEvidence(Dictionary<string, object> database, Dictionary<string, object> item, HashSet<string> isolatedEvidenceFilenames)
    {
        var references = new HashSet<string>(StringComparer.OrdinalIgnoreCase);foreach (string value in EvidenceEntryRelativePaths(item)) AddEvidenceReferenceVariants(references, value);
        string expected = Convert.ToString(item["sha256"], CultureInfo.InvariantCulture), entryOrganization = EvidenceEntryOrganization(item);int removed = 0;
        foreach (object userValue in ObjectArray(database["users"]))
        {
            Dictionary<string, object> user = ObjectDictionary(userValue);string organization = Convert.ToString(user["organization"], CultureInfo.InvariantCulture), safeOrganization = ValidOrganizationName(organization);var retained = new List<object>();
            foreach (object artifactValue in ObjectArray(user["artifacts"]))
            {
                Dictionary<string, object> artifact = ObjectDictionary(artifactValue);string filename = Convert.ToString(artifact["filename"], CultureInfo.InvariantCulture), path = artifact.ContainsKey("path") ? Convert.ToString(artifact["path"], CultureInfo.InvariantCulture).Replace('\\', '/') : "";
                if (String.IsNullOrWhiteSpace(path)) path = Path.Combine("Organizations", safeOrganization, OrganizationArtifactStorageFolder(ArtifactStorageFolder(Convert.ToString(artifact["kind"], CultureInfo.InvariantCulture)), organization), filename).Replace(Path.DirectorySeparatorChar, '/');
                var variants = new HashSet<string>(StringComparer.OrdinalIgnoreCase);AddEvidenceReferenceVariants(variants, path);bool pathMatch = variants.Any(references.Contains), filenameHashMatch = String.Equals(safeOrganization, entryOrganization, StringComparison.OrdinalIgnoreCase) && EvidenceEntryRelativePaths(item).Any(value => String.Equals(Path.GetFileName(value), filename, StringComparison.OrdinalIgnoreCase)) && artifact.ContainsKey("sha256") && String.Equals(Convert.ToString(artifact["sha256"], CultureInfo.InvariantCulture), expected, StringComparison.OrdinalIgnoreCase);
                if (pathMatch || filenameHashMatch) { isolatedEvidenceFilenames.Add(organization + "\0" + filename);removed++;continue; }
                retained.Add(artifactValue);
            }
            user["artifacts"] = retained.ToArray();
        }
        return removed;
    }

    private static void AddEvidenceReferenceVariants(HashSet<string> references, string value)
    {
        string normalized = (value ?? "").Replace('\\', '/');if (!normalized.StartsWith("Organizations/", StringComparison.OrdinalIgnoreCase)) return;references.Add(normalized);if (normalized.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase)) references.Add(normalized.Substring(0, normalized.Length - 4));else if (normalized.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) references.Add(normalized + ".zip");
    }
}
