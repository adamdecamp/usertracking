using System;
using System.IO;
using System.Text.RegularExpressions;

/// <summary>
/// Attaches a Compliance Snapshot that was already stored in this system's
/// Reports folder to an Outlook draft. The browser names the stored report and
/// its SHA-256 instead of uploading the PDF again, so the attachment is the
/// exact audited copy and nothing outside the Reports folder can be attached.
/// </summary>
internal sealed partial class PortableStorage
{
    private static readonly Regex ComplianceReportFilenamePattern = new Regex(@"^Compliance-Snapshot_[A-Za-z0-9_-]{1,160}\.pdf$", RegexOptions.CultureInvariant);

    internal static void ValidateOutlookReportReference(string filename, string expectedSha256)
    {
        if (String.IsNullOrEmpty(filename) || filename.Length > 180 || !ComplianceReportFilenamePattern.IsMatch(filename) || !String.Equals(Path.GetFileName(filename), filename, StringComparison.Ordinal)) throw new InvalidDataException("The Compliance Snapshot attachment name is invalid.");
        if (!IsSha256(expectedSha256)) throw new InvalidDataException("The Compliance Snapshot attachment checksum is invalid.");
    }

    /// <summary>Copies the stored report to a private temporary folder after checking its checksum and PDF structure.</summary>
    public string StageOutlookReportAttachment(string systemId, string filename, string expectedSha256)
    {
        ValidateOutlookReportReference(filename, expectedSha256);
        string source = Path.Combine(Root(systemId), SystemDirectoryName, "Reports", filename);
        if (!File.Exists(source)) throw new FileNotFoundException("The Compliance Snapshot is no longer in this system's Reports folder, so it was not attached.");
        byte[] bytes = ReadAllBytesWithRetry(source, 25L * 1024 * 1024);
        if (!String.Equals(Sha256Bytes(bytes), expectedSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The stored Compliance Snapshot changed after it was generated, so it was not attached.");
        string directory = Path.Combine(Path.GetTempPath(), "RAPTOR", "Outlook Attachments", Guid.NewGuid().ToString("N")), destination = Path.Combine(directory, filename);
        try
        {
            Directory.CreateDirectory(directory);
            File.WriteAllBytes(destination, bytes);
            string validationError;
            if (!TryValidateEvidenceFile(destination, out validationError)) throw new InvalidDataException("The Compliance Snapshot did not pass PDF validation. " + validationError);
            return destination;
        }
        catch
        {
            try { if (File.Exists(destination)) File.Delete(destination); } catch { }
            try { if (Directory.Exists(directory)) Directory.Delete(directory, false); } catch { }
            throw;
        }
    }
}
