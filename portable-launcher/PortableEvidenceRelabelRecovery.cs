using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

internal sealed partial class PortableStorage
{
    private string ResolveRelabelEvidencePath(string systemId, string relative, string expectedSha256, out string evidenceRoot)
    {
        string source;
        try { source = ResolveEvidencePath(systemId, relative, out evidenceRoot); }
        catch (FileNotFoundException) { evidenceRoot = Root(systemId);source = SafeRelativePath(evidenceRoot, relative); }
        if (File.Exists(source)) return source;
        string expected = CleanLine(expectedSha256, 64).ToLowerInvariant();
        if (!String.IsNullOrWhiteSpace(expected) && !IsSha256(expected)) throw new InvalidDataException("The recorded evidence SHA-256 value is invalid.");
        string requestedName = Path.GetFileName((relative ?? "").Replace('/', Path.DirectorySeparatorChar)), sharedRoot = Root(systemId), organization = OrganizationStorageLocation(sharedRoot, SafeRelativePath(sharedRoot, relative)).Item2;
        List<Tuple<string, string>> candidates = RelabelEvidenceCandidates(LocalEvidenceRoot(systemId), organization, requestedName, expected);
        if (candidates.Count == 0)
        {
            foreach (Dictionary<string, object> receipt in LoadPublishedEvidence(sharedRoot, organization).Values)
            {
                string receiptPath = Convert.ToString(receipt["path"], CultureInfo.InvariantCulture), receiptName = Path.GetFileName(receiptPath), receiptHash = receipt.ContainsKey("sha256") ? Convert.ToString(receipt["sha256"], CultureInfo.InvariantCulture) : "";
                if (!RelabelEvidenceIdentityMatches(requestedName, receiptName, expected, receiptHash)) continue;
                string physical;try { physical = SafeRelativePath(sharedRoot, receiptPath); } catch { continue; }
                if (File.Exists(physical) && !ContainsManagedStorageDirectory(Relative(sharedRoot, physical))) candidates.Add(Tuple.Create(sharedRoot, physical));
            }
        }
        if (candidates.Count == 0) candidates = RelabelEvidenceCandidates(sharedRoot, organization, requestedName, expected);
        candidates = candidates.GroupBy(item => Path.GetFullPath(item.Item2), StringComparer.OrdinalIgnoreCase).Select(group => group.First()).ToList();
        if (candidates.Count > 1) throw new InvalidDataException("More than one current evidence file matches the stale user-record reference. Resolve the duplicate in Clean Up before editing this user.");
        if (candidates.Count == 0) throw new FileNotFoundException("The selected evidence file no longer exists and no unique current file matched its recorded filename or SHA-256 hash.");
        evidenceRoot = candidates[0].Item1;return candidates[0].Item2;
    }

    private static List<Tuple<string, string>> RelabelEvidenceCandidates(string root, string organization, string requestedName, string expectedSha256)
    {
        var locations = new List<Dictionary<string, object>>();var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);int skippedZips = 0, skippedArchives = 0;
        CollectEvidenceLocations(root, organization, locations, seen, ref skippedZips, ref skippedArchives);
        var candidates = new List<Tuple<string, string>>();
        foreach (Dictionary<string, object> location in locations)
        {
            string relative = Convert.ToString(location["path"], CultureInfo.InvariantCulture), name = Convert.ToString(location["name"], CultureInfo.InvariantCulture), physical;
            if (ContainsManagedStorageDirectory(relative)) continue;
            try { physical = SafeRelativePath(root, relative); } catch { continue; }
            if (!File.Exists(physical) || !RelabelEvidenceIdentityMatches(requestedName, name, expectedSha256, String.IsNullOrWhiteSpace(expectedSha256) ? "" : TryFileHash(physical))) continue;
            candidates.Add(Tuple.Create(root, physical));
        }
        return candidates;
    }

    private static bool RelabelEvidenceIdentityMatches(string requestedName, string candidateName, string expectedSha256, string candidateSha256)
    {
        string requested = (requestedName ?? "").EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ? requestedName.Substring(0, requestedName.Length - 4) : requestedName ?? "", candidate = (candidateName ?? "").EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ? candidateName.Substring(0, candidateName.Length - 4) : candidateName ?? "";
        bool nameMatches = String.Equals(requested, candidate, StringComparison.OrdinalIgnoreCase), hashMatches = !String.IsNullOrWhiteSpace(expectedSha256) && String.Equals(expectedSha256, candidateSha256, StringComparison.OrdinalIgnoreCase);
        return String.IsNullOrWhiteSpace(expectedSha256) ? nameMatches : hashMatches;
    }
}
