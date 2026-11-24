using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

/// <summary>
/// Outlook attachments that intake could not copy as-is: an unknown or hidden
/// sender, a filename outside the evidence format, an organization this system
/// does not have, a name already waiting for Sync with different content, or a
/// document that is not a usable PDF. Instead of being skipped on every check,
/// each is held on this computer in a Needs Attention list until the operator
/// corrects or dismisses it. A corrected PDF goes to organization intake, where
/// Daily Sync still reviews it like any other new evidence. Nothing here
/// changes a user record.
/// </summary>
internal sealed partial class PortableStorage
{
    internal const int OutlookIntakeMaximumHeld = 500;
    internal const string OutlookHoldSender = "sender", OutlookHoldFilename = "filename", OutlookHoldOrganization = "organization", OutlookHoldConflict = "conflict", OutlookHoldInvalid = "invalid";
    private static readonly Regex OutlookHeldId = new Regex("^[0-9a-f]{32}$", RegexOptions.CultureInvariant);
    // Document types people commonly send instead of a PDF. Images are left out
    // because signature logos arrive as attachments on almost every message.
    internal static readonly string[] OutlookIntakeOtherDocumentExtensions = { ".doc", ".docx", ".rtf", ".odt", ".xps", ".tif", ".tiff" };

    private string OutlookHeldDirectory(string systemId)
    {
        string directory = Path.Combine(OutlookIntakeDirectory(systemId), "Unmatched");
        Directory.CreateDirectory(directory);
        return directory;
    }

    /// <summary>The organization as it appears inside (ORG) in evidence filenames: the app's canonical file part, so "Acme Corp" is written Acme_Corp.</summary>
    internal static string OutlookOrganizationToken(string organization)
    {
        string value = Regex.Replace(CleanLine(organization, 80), "[<>:\"/\\\\|?*()]", " ");
        return Regex.Replace(value, "[^A-Za-z0-9'+.-]+", "_").Trim('_');
    }

    internal static bool OutlookOrganizationMatches(string code, string organization)
    {
        return String.Equals(OutlookOrganizationToken(code), OutlookOrganizationToken(organization), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Replaces the (CODE) in a Last_First_(CODE)_... filename with the chosen organization.</summary>
    internal static string OutlookIntakeCorrectedFilename(string filename, string organization)
    {
        int open = filename.IndexOf('('), close = open > 0 ? filename.IndexOf(')', open + 1) : -1;
        if (open <= 0 || close <= open) throw new InvalidDataException("This filename has no organization code to correct. Enter the corrected details instead.");
        return filename.Substring(0, open + 1) + OutlookOrganizationToken(organization) + filename.Substring(close);
    }

    /// <summary>An operator-corrected filename must be a plain PDF name whose (ORG) is the chosen organization.</summary>
    internal static string ValidOutlookIntakeFilename(string filename, string organization)
    {
        string value = (filename ?? "").Trim();
        if (value.Length == 0 || value.Length > 180 || SafePart(value, 180) != value || value.IndexOf("..", StringComparison.Ordinal) >= 0) throw new InvalidDataException("The corrected filename is not a valid file name.");
        string code = OutlookIntakeOrganizationCode(value);
        if (code == null) throw new InvalidDataException("The corrected filename must follow Last_First_(ORG)_Document_DDMMMYYYY.pdf.");
        if (!OutlookOrganizationMatches(code, organization)) throw new InvalidDataException("The corrected filename must use the chosen organization, " + organization + ".");
        return value;
    }

    // Returns the hold id, or null when too many attachments are already waiting.
    private string HoldOutlookIntakeAttachment(string systemId, string reason, string detail, string filename, string code, string organization, string sender, string received, byte[] bytes)
    {
        string directory = OutlookHeldDirectory(systemId), hash = bytes == null ? "" : Sha256Bytes(bytes);
        List<Dictionary<string, object>> held = ReadOutlookHeld(systemId);
        Dictionary<string, object> existing = held.FirstOrDefault(entry => Convert.ToString(entry["filename"]) == filename && (bytes != null ? Convert.ToString(entry["sha256"]) == hash : Convert.ToString(entry["sender"]) == sender && Convert.ToString(entry["receivedUtc"]) == received));
        if (existing != null) return Convert.ToString(existing["id"]);
        if (held.Count >= OutlookIntakeMaximumHeld) return null;
        string id = Guid.NewGuid().ToString("N");
        if (bytes != null) AtomicWrite(Path.Combine(directory, id + ".pdf"), bytes);
        var entryValue = new Dictionary<string, object> { { "id", id }, { "reason", reason }, { "detail", CleanLine(detail, 400) }, { "filename", filename }, { "code", CleanLine(code ?? "", 100) }, { "organization", organization ?? "" }, { "sender", sender }, { "receivedUtc", received }, { "heldUtc", DateTime.UtcNow.ToString("o") }, { "sha256", hash } };
        AtomicWrite(Path.Combine(directory, id + ".json"), Encoding.UTF8.GetBytes(json.Serialize(entryValue)));
        return id;
    }

    private Dictionary<string, object> OutlookHeldSkip(string systemId, string reason, string detail, string filename, string code, string organization, string sender, string received, byte[] bytes, out bool held)
    {
        string id = HoldOutlookIntakeAttachment(systemId, reason, detail, filename, code, organization, sender, received, bytes);
        held = id != null;
        var entry = OutlookIntakeEntry(filename, organization, sender, received, detail + (held ? "" : " " + OutlookIntakeMaximumHeld + " attachments already need attention; correct or dismiss them, then check Outlook again."));
        if (held) entry["held"] = id;
        return entry;
    }

    private List<Dictionary<string, object>> ReadOutlookHeld(string systemId)
    {
        var held = new List<Dictionary<string, object>>();
        foreach (string path in Directory.EnumerateFiles(OutlookHeldDirectory(systemId), "*.json"))
        {
            try
            {
                var entry = json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
                if (entry == null || !entry.ContainsKey("id") || Convert.ToString(entry["id"]) != Path.GetFileNameWithoutExtension(path)) continue;
                if (!entry.ContainsKey("reason")) entry["reason"] = OutlookHoldOrganization;
                foreach (string key in new[] { "detail", "code", "organization", "sha256" }) if (!entry.ContainsKey(key)) entry[key] = "";
                bool hasFile = File.Exists(Path.ChangeExtension(path, ".pdf"));
                if (!hasFile && Convert.ToString(entry["reason"]) != OutlookHoldInvalid) continue;
                held.Add(entry);
            }
            catch (Exception) { }
        }
        return held.OrderByDescending(entry => Convert.ToString(entry["receivedUtc"]), StringComparer.Ordinal).ToList();
    }

    private string OutlookHeldResponse(string systemId, Dictionary<string, object> extra)
    {
        string[] organizations = ((object[])json.DeserializeObject(ListOrganizations(systemId))).Select(value => Convert.ToString(value)).ToArray();
        string[] fields = { "id", "reason", "detail", "filename", "code", "organization", "sender", "receivedUtc" };
        var held = ReadOutlookHeld(systemId).Select(entry => fields.ToDictionary(field => field, field => (object)Convert.ToString(entry[field]))).ToList();
        var response = new Dictionary<string, object> { { "held", held }, { "organizations", organizations } };
        if (extra != null) foreach (var pair in extra) response[pair.Key] = pair.Value;
        return json.Serialize(response);
    }

    private void DeleteOutlookHold(string directory, string id)
    {
        foreach (string extension in new[] { ".pdf", ".json" }) { string path = Path.Combine(directory, id + extension);if (File.Exists(path)) File.Delete(path); }
    }

    /// <summary>
    /// GET lists the Needs Attention attachments. POST {id, organization, filename?, forUser?}
    /// copies one to organization intake; POST {id, dismiss:true} removes one;
    /// POST {dismissAll:true, reason?} removes every one (of that reason).
    /// </summary>
    public string OutlookIntakeHeld(string systemId, string method, byte[] body)
    {
        if (method == "GET") return OutlookHeldResponse(systemId, null);
        Dictionary<string, object> request;
        try { request = json.DeserializeObject(Encoding.UTF8.GetString(body ?? new byte[0])) as Dictionary<string, object>; }
        catch (Exception error) { throw new InvalidDataException("The Needs Attention request is not valid JSON.", error); }
        if (request == null) throw new InvalidDataException("The Needs Attention request is empty.");
        Func<string, string> text = key => request.ContainsKey(key) && request[key] != null ? Convert.ToString(request[key]) : "";
        Func<string, bool> flag = key => request.ContainsKey(key) && request[key] is bool && (bool)request[key];
        lock (RootLock(systemId))
        {
            string directory = OutlookHeldDirectory(systemId);
            if (flag("dismissAll"))
            {
                string reason = text("reason");
                List<Dictionary<string, object>> targets = ReadOutlookHeld(systemId).Where(entry => reason.Length == 0 || Convert.ToString(entry["reason"]) == reason).ToList();
                foreach (var entry in targets) DeleteOutlookHold(directory, Convert.ToString(entry["id"]));
                AppendAudit(systemId, "OUTLOOK INTAKE NEEDS ATTENTION CLEARED: " + targets.Count + " held attachments dismissed" + (reason.Length > 0 ? " (" + CleanLine(reason, 20) + ")" : "") + "; none copied to organization intake; no user record changed");
                return OutlookHeldResponse(systemId, new Dictionary<string, object> { { "dismissedCount", targets.Count } });
            }
            string id = text("id");
            if (!OutlookHeldId.IsMatch(id)) throw new InvalidDataException("The Needs Attention request does not identify an attachment.");
            string metaPath = Path.Combine(directory, id + ".json"), pdfPath = Path.Combine(directory, id + ".pdf");
            if (!File.Exists(metaPath)) throw new FileNotFoundException("That attachment no longer needs attention. Check Outlook again to refresh the list.");
            var held = (Dictionary<string, object>)json.DeserializeObject(File.ReadAllText(metaPath, Encoding.UTF8));
            string filename = Convert.ToString(held["filename"]), sender = Convert.ToString(held["sender"]), heldReason = held.ContainsKey("reason") ? Convert.ToString(held["reason"]) : OutlookHoldOrganization;
            if (flag("dismiss"))
            {
                DeleteOutlookHold(directory, id);
                AppendAudit(systemId, "OUTLOOK INTAKE HELD ATTACHMENT DISMISSED: " + CleanLine(filename, 180) + " from " + CleanLine(sender, 254) + " (" + heldReason + "); not copied to organization intake; no user record changed");
                return OutlookHeldResponse(systemId, new Dictionary<string, object> { { "dismissed", filename } });
            }
            if (heldReason == OutlookHoldInvalid || !File.Exists(pdfPath)) throw new InvalidOperationException("This attachment cannot be used as evidence. Dismiss it and ask the sender for a PDF.");
            string[] organizations = ((object[])json.DeserializeObject(ListOrganizations(systemId))).Select(value => Convert.ToString(value)).ToArray();
            string chosen = organizations.FirstOrDefault(value => String.Equals(value, text("organization").Trim(), StringComparison.OrdinalIgnoreCase));
            if (chosen == null) throw new InvalidDataException("Choose an organization that exists in this information system.");
            byte[] bytes = File.ReadAllBytes(pdfPath);
            if (!String.Equals(Sha256Bytes(bytes), Convert.ToString(held["sha256"]), StringComparison.Ordinal)) throw new InvalidDataException("The held attachment changed on disk after it was copied from Outlook. Dismiss it and check Outlook again.");
            string corrected = text("filename").Trim().Length > 0 ? ValidOutlookIntakeFilename(text("filename"), chosen) : ValidOutlookIntakeFilename(OutlookIntakeCorrectedFilename(filename, chosen), chosen);
            string destination = Path.Combine(LocalIntakeDirectory(systemId, chosen), corrected), forUser = CleanLine(text("forUser"), 200);
            bool alreadyWaiting = false;
            if (File.Exists(destination))
            {
                if (!String.Equals(Sha256Bytes(File.ReadAllBytes(destination)), Sha256Bytes(bytes), StringComparison.Ordinal)) throw new InvalidOperationException("A different file named " + corrected + " is already waiting for Sync in " + chosen + ". Run Sync first, then try again.");
                alreadyWaiting = true;
            }
            else AtomicWrite(destination, bytes);
            DeleteOutlookHold(directory, id);
            AppendAudit(systemId, "OUTLOOK INTAKE CORRECTED BY OPERATOR: " + CleanLine(filename, 180) + " from " + CleanLine(sender, 254) + " (" + heldReason + ")" + (forUser.Length > 0 ? "; accepted for " + forUser : "") + "; organization " + chosen + "; " + (alreadyWaiting ? "the same file was already waiting for Sync as " + corrected : "copied to organization intake as " + corrected + " for Sync review") + "; no user record changed");
            return OutlookHeldResponse(systemId, new Dictionary<string, object> { { "assigned", new Dictionary<string, object> { { "filename", corrected }, { "organization", chosen }, { "sender", sender }, { "receivedUtc", Convert.ToString(held["receivedUtc"]) } } } });
        }
    }
}
