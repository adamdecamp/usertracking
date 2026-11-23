using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;

/// <summary>
/// Per-computer "Send From" mailbox for Outlook drafts. Operators usually send
/// notices from an Exchange group (shared) mailbox; the address is kept on this
/// computer only, so no shared database change is required.
/// </summary>
internal sealed partial class PortableStorage
{
    private string OutlookSendFromPath()
    {
        string parent = Path.GetDirectoryName(mappingCachePath);
        if (String.IsNullOrWhiteSpace(parent)) parent = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InformationSystemUserTracker");
        Directory.CreateDirectory(parent);
        return Path.Combine(parent, "outlook-send-from.json");
    }

    internal static string ValidOutlookSendFrom(string value)
    {
        string address = (value ?? "").Trim();
        if (address.Length == 0) return null;
        try
        {
            var parsed = new System.Net.Mail.MailAddress(address);
            if (address.Length <= 254 && String.Equals(parsed.Address, address, StringComparison.OrdinalIgnoreCase) && String.IsNullOrEmpty(parsed.DisplayName)) return parsed.Address.ToLowerInvariant();
        }
        catch (FormatException) { }
        throw new InvalidDataException("Enter the group mailbox as a plain email address, such as compliance@example.mil.");
    }

    /// <summary>The configured mailbox, or null to send from the operator's default Outlook account.</summary>
    internal string ReadOutlookSendFrom()
    {
        string path = OutlookSendFromPath();
        if (!File.Exists(path)) return null;
        var value = json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
        return value != null && value.ContainsKey("address") ? ValidOutlookSendFrom(Convert.ToString(value["address"])) : null;
    }

    public string OutlookSendFromSetting(string systemId, string method, byte[] requestBody)
    {
        if (String.Equals(method, "POST", StringComparison.Ordinal))
        {
            Dictionary<string, object> request;
            try { request = json.DeserializeObject(Encoding.UTF8.GetString(requestBody ?? new byte[0])) as Dictionary<string, object>; }
            catch (Exception error) { throw new InvalidDataException("The Send From request is not valid JSON.", error); }
            if (request == null || !request.ContainsKey("address")) throw new InvalidDataException("The Send From request must include an address.");
            string address = ValidOutlookSendFrom(Convert.ToString(request["address"])), previous = ReadOutlookSendFrom();
            AtomicWrite(OutlookSendFromPath(), Encoding.UTF8.GetBytes(json.Serialize(new Dictionary<string, object> { { "address", address ?? "" } })));
            if (!String.Equals(previous, address, StringComparison.Ordinal)) AppendAudit(systemId, "OUTLOOK SEND FROM CHANGED ON THIS COMPUTER: from " + (previous ?? "default Outlook account") + " to " + (address ?? "default Outlook account"));
        }
        return json.Serialize(new Dictionary<string, object> { { "address", ReadOutlookSendFrom() ?? "" } });
    }
}

internal sealed partial class TrackerContext
{
    /// <summary>
    /// Points a new Outlook draft at the configured group mailbox. A mailbox that is an
    /// Outlook account in this profile is used directly; otherwise Exchange sends on
    /// behalf of it, which needs Send As or Send on Behalf permission from IT.
    /// </summary>
    private static string ApplyOutlookSendFrom(object outlook, object message, string address)
    {
        if (address == null) return "operator's default Outlook account";
        object session = null, accounts = null;
        try
        {
            session = OutlookGet(outlook, "Session");accounts = OutlookGet(session, "Accounts");
            int count = Convert.ToInt32(OutlookGet(accounts, "Count"));
            for (int index = 1; index <= count; index++)
            {
                object account = OutlookCall(accounts, "Item", index);
                try
                {
                    string smtp;
                    try { smtp = Convert.ToString(OutlookGet(account, "SmtpAddress")); } catch (Exception) { smtp = ""; }
                    if (!String.Equals((smtp ?? "").Trim(), address, StringComparison.OrdinalIgnoreCase)) continue;
                    message.GetType().InvokeMember("SendUsingAccount", BindingFlags.SetProperty | OutlookMember, null, message, new[] { account });
                    return address + " (Outlook account)";
                }
                finally { ReleaseComObject(account); }
            }
        }
        finally { ReleaseComObject(accounts);ReleaseComObject(session); }
        message.GetType().InvokeMember("SentOnBehalfOfName", BindingFlags.SetProperty | OutlookMember, null, message, new object[] { address });
        return address + " (sent on behalf)";
    }

    private static void RefuseOutlookFallbackForSendFrom(string address)
    {
        if (address != null) throw new InvalidOperationException("Classic Microsoft Outlook is required to send from the group mailbox " + address + ". No draft was opened, so nothing can go out from a personal address by mistake.");
    }
}
