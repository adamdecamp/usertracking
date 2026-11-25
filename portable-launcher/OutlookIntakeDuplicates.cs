using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

/// <summary>
/// PDFs that Check Outlook has already taken in but that are not recorded yet:
/// files waiting for Sync in this computer's organization intake folders, files
/// held in Needs Attention, and copies taken earlier in the same check. A
/// re-sent PDF matches by content, so a new name or a second email does not
/// create a second copy.
/// </summary>
internal sealed class OutlookWaitingIndex
{
    /// <summary>PDF SHA-256 to a plain description of where the same PDF already is.</summary>
    internal readonly Dictionary<string, string> Hashes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
}

internal sealed partial class PortableStorage
{
    private const int OutlookWaitingFileLimit = 5000;

    internal OutlookWaitingIndex OutlookWaitingEvidence(string systemId)
    {
        var index = new OutlookWaitingIndex();
        string organizationsRoot = Path.Combine(LocalEvidenceRoot(systemId), "Organizations");
        int files = 0;
        // New and REWORK-marked intake waits in the organization folder itself; a legacy Rework folder is still checked.
        foreach (string organizationRoot in Directory.Exists(organizationsRoot) ? Directory.EnumerateDirectories(organizationsRoot) : Enumerable.Empty<string>())
        {
            string organization = Path.GetFileName(organizationRoot);
            foreach (string folder in new[] { organizationRoot, Path.Combine(organizationRoot, SafePart(organization, 80) + " Rework") })
            {
                if (!Directory.Exists(folder)) continue;
                foreach (string path in Directory.EnumerateFiles(folder, "*.pdf"))
                {
                    if (++files > OutlookWaitingFileLimit) return index;
                    try
                    {
                        var info = new FileInfo(path);
                        if (info.Length <= 0 || info.Length > EvidenceLimit) continue;
                        string hash = Sha256Bytes(File.ReadAllBytes(path));
                        if (!index.Hashes.ContainsKey(hash)) index.Hashes[hash] = "already waiting for Sync as " + info.Name + " in " + organization;
                    }
                    catch (Exception) { } // An unreadable waiting file cannot prove a duplicate.
                }
            }
        }
        foreach (Dictionary<string, object> held in ReadOutlookHeld(systemId))
        {
            string hash = Convert.ToString(held["sha256"]);
            if (IsSha256(hash) && !index.Hashes.ContainsKey(hash)) index.Hashes[hash] = "already in Needs Attention as " + CleanLine(Convert.ToString(held["filename"]), 180);
        }
        return index;
    }

    /// <summary>Remembers a PDF this check copied or held, so a later attachment with the same content is skipped.</summary>
    internal static void OutlookWaitingAdd(OutlookWaitingIndex index, string pdfSha256, string description)
    {
        if (index != null && !index.Hashes.ContainsKey(pdfSha256)) index.Hashes[pdfSha256] = description;
    }
}
