using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

internal static class OutlookDraftFallback
{
    private const int MaximumAttachmentCount = 4;
    private const long MaximumCombinedAttachmentBytes = 30L * 1024L * 1024L;

    private static string Header(string value, string label, int maximum)
    {
        string clean = value ?? "";
        if (clean.Length > maximum || clean.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) throw new InvalidDataException("The " + label + " header is invalid.");
        return clean;
    }

    internal const int MaximumCcRecipients = 20;

    /// <summary>
    /// Validates an optional CC list for an individual draft: CC is allowed only with a To
    /// recipient, every address must be valid, duplicates and To addresses are dropped, and
    /// at most 20 remain. Returns the addresses joined with "; ", or an empty string.
    /// </summary>
    internal static string NormalizeCc(string cc, string to)
    {
        string value = cc ?? "";
        if (value.Trim().Length == 0) return "";
        if (String.IsNullOrWhiteSpace(to)) throw new InvalidDataException("CC recipients can be added only to a draft with a To recipient.");
        if (value.Length > 5200 || value.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) throw new InvalidDataException("The Outlook CC list is invalid.");
        var toAddresses = new HashSet<string>(to.Split(';').Select(item => item.Trim()).Where(item => item.Length > 0), StringComparer.OrdinalIgnoreCase);
        string[] addresses = value.Split(';').Select(item => item.Trim()).Where(item => item.Length > 0 && !toAddresses.Contains(item)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (addresses.Length > MaximumCcRecipients) throw new InvalidDataException("An Outlook draft can CC at most " + MaximumCcRecipients + " contacts.");
        foreach (string address in addresses)
        {
            try { var parsed = new System.Net.Mail.MailAddress(address);if (address.Length > 254 || !String.Equals(parsed.Address, address, StringComparison.OrdinalIgnoreCase)) throw new FormatException(); }
            catch { throw new InvalidDataException("The Outlook CC list contains an invalid email address."); }
        }
        return String.Join("; ", addresses);
    }

    internal static byte[] BuildEml(string to, IEnumerable<string> bcc, string subject, string htmlBody, IEnumerable<string> attachmentPaths, string cc = "")
    {
        string safeTo = String.Join(", ", (to ?? "").Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries).Select(value => Header(value.Trim(), "To", 254)).Where(value => value.Length > 0)), safeCc = String.Join(", ", (cc ?? "").Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries).Select(value => Header(value.Trim(), "CC", 254)).Where(value => value.Length > 0)), safeSubject = Header(subject, "subject", 200), safeBcc = String.Join(", ", (bcc ?? Enumerable.Empty<string>()).Select(value => Header(value, "BCC", 254)));
        string[] attachments = (attachmentPaths ?? Enumerable.Empty<string>()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (attachments.Length > MaximumAttachmentCount) throw new InvalidDataException("The fallback draft has too many attachments.");
        long attachmentBytes = 0;foreach (string path in attachments) { if (String.IsNullOrWhiteSpace(path) || !File.Exists(path)) throw new FileNotFoundException("A fallback draft attachment is unavailable.", path);attachmentBytes += new FileInfo(path).Length; }
        if (attachmentBytes > MaximumCombinedAttachmentBytes) throw new InvalidDataException("The fallback draft attachments exceed 30 MB.");
        string boundary = "----RAPTOR-" + Guid.NewGuid().ToString("N"), html = htmlBody ?? "";
        using (var output = new MemoryStream())
        using (var writer = new StreamWriter(output, new UTF8Encoding(false), 4096, true))
        {
            writer.NewLine = "\r\n";writer.WriteLine("MIME-Version: 1.0");if (!String.IsNullOrWhiteSpace(safeTo)) writer.WriteLine("To: " + safeTo);if (!String.IsNullOrWhiteSpace(safeCc)) writer.WriteLine("Cc: " + safeCc);if (!String.IsNullOrWhiteSpace(safeBcc)) writer.WriteLine("Bcc: " + safeBcc);writer.WriteLine("Subject: " + safeSubject);writer.WriteLine("Content-Type: multipart/mixed; boundary=\"" + boundary + "\"");writer.WriteLine();writer.WriteLine("--" + boundary);writer.WriteLine("Content-Type: text/html; charset=utf-8");writer.WriteLine("Content-Transfer-Encoding: base64");writer.WriteLine();WriteBase64(writer, Encoding.UTF8.GetBytes(html));
            foreach (string path in attachments) { writer.WriteLine("--" + boundary);writer.WriteLine("Content-Type: application/octet-stream; name=\"" + Header(Path.GetFileName(path).Replace("\"", ""), "attachment filename", 180) + "\"");writer.WriteLine("Content-Transfer-Encoding: base64");writer.WriteLine("Content-Disposition: attachment; filename=\"" + Path.GetFileName(path).Replace("\"", "") + "\"");writer.WriteLine();WriteBase64(writer, File.ReadAllBytes(path)); }
            writer.WriteLine("--" + boundary + "--");writer.Flush();return output.ToArray();
        }
    }

    private static void WriteBase64(TextWriter writer, byte[] bytes)
    {
        string encoded = Convert.ToBase64String(bytes);for (int offset = 0; offset < encoded.Length; offset += 76) writer.WriteLine(encoded.Substring(offset, Math.Min(76, encoded.Length - offset)));
    }

    internal static string Open(string to, IEnumerable<string> bcc, string subject, string htmlBody, string plainBody, IEnumerable<string> attachmentPaths, string cc = "")
    {
        string directory = Path.Combine(Path.GetTempPath(), "RAPTOR", "Drafts");Directory.CreateDirectory(directory);string path = Path.Combine(directory, "RAPTOR-Draft-" + DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffZ") + ".eml");File.WriteAllBytes(path, BuildEml(to, bcc, subject, htmlBody, attachmentPaths, cc));
        try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });return "EML fallback"; }
        catch
        {
            if ((attachmentPaths ?? Enumerable.Empty<string>()).Any()) throw;
            string recipient = !String.IsNullOrWhiteSpace(to) ? String.Join(",", to.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries).Select(value => value.Trim())) : "", bccQuery = String.Join(";", bcc ?? Enumerable.Empty<string>()), uri = "mailto:" + Uri.EscapeDataString(recipient) + "?subject=" + Uri.EscapeDataString(subject ?? "") + "&body=" + Uri.EscapeDataString(plainBody ?? "") + (String.IsNullOrWhiteSpace(bccQuery) ? "" : "&bcc=" + Uri.EscapeDataString(bccQuery)) + (String.IsNullOrWhiteSpace(cc) ? "" : "&cc=" + Uri.EscapeDataString(String.Join(",", cc.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries).Select(value => value.Trim()))));Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });return "mailto fallback";
        }
    }
}
