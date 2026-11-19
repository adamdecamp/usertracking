using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

internal sealed partial class PortableStorage
{
    private string RelabelEvidenceDestinationDirectory(string systemId, string root, string logicalRelative, string organization, string artifactFolder, bool local, out string publicDirectory)
    {
        string normalized = (logicalRelative ?? "").Replace('\\', '/');string[] parts = normalized.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);int rework = -1, saarArchive = -1, archive = -1;
        for (int index = 0; index < parts.Length - 1; index++)
        {
            if (IsReworkStorageDirectory(parts[index])) rework = index;
            else if (IsPermanentSaarArchiveDirectory(parts[index])) saarArchive = index;
            else if (String.Equals(parts[index], "Archive", StringComparison.OrdinalIgnoreCase) || parts[index].EndsWith(" Archive", StringComparison.OrdinalIgnoreCase)) archive = index;
        }
        var destinationParts = new List<string> { "Organizations", organization };int category = -1;
        if (rework >= 0) { destinationParts.Add(SafePart(organization, 80) + " Rework");category = rework; }
        else if (saarArchive >= 0) { destinationParts.Add(SafePart(organization, 80) + " SAAR Archive");category = saarArchive; }
        else if (archive >= 0) { destinationParts.Add(SafePart(organization, 80) + " Archive");category = archive; }
        else
        {
            if (ContainsManagedStorageDirectory(normalized)) throw new InvalidDataException("Only active, Archive, or Rework user evidence can be relabeled from the User Record.");
            destinationParts.Add(OrganizationArtifactStorageFolder(artifactFolder, organization));
        }
        if (category >= 0) for (int index = category + 1; index < parts.Length - 1; index++)
        {
            if (IsManagedStorageDirectory(parts[index]) || IsIncomingStorageDirectory(parts[index]) || IsCompleteStorageDirectory(parts[index])) throw new InvalidDataException("The retained evidence path contains an unsupported nested storage folder.");
            destinationParts.Add(SafePart(parts[index], 100));
        }
        publicDirectory = String.Join("/", destinationParts.ToArray());
        if (local) return LocalIntakeDirectory(systemId, organization);
        string directory = SafeRelativePath(root, publicDirectory);Directory.CreateDirectory(directory);return directory;
    }

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
