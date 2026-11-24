using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

internal sealed partial class PortableStorage
{
    // Manifest v7 adds an optional per-system IANA time zone that decides Due and Overdue dates.
    // .NET Framework only knows Windows zone IDs, so check the name's shape here; the client verifies it with Intl.
    private static void ValidateSystemTimeZone(Dictionary<string, object> system)
    {
        if (!system.ContainsKey("timeZone")) return;
        string value = system["timeZone"] as string;
        if (value == null || value.Length > 64 || !Regex.IsMatch(value, @"^(?:UTC|[A-Za-z][A-Za-z0-9_+\-]*(?:/[A-Za-z0-9_+\-]+){1,2})$", RegexOptions.CultureInvariant)) throw new InvalidDataException("A system record has an invalid timeZone field.");
    }

    // Manifest v8 adds optional per-system organization contacts: position, name, and 1-4 email or phone entries.
    internal static void ValidateSystemOrganizationContacts(Dictionary<string, object> system)
    {
        if (!system.ContainsKey("organizationContacts")) return;
        object[] contacts = system["organizationContacts"] as object[];
        if (contacts == null || contacts.Length > 500) throw new InvalidDataException("A system record has an invalid organizationContacts list.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (object raw in contacts)
        {
            Dictionary<string, object> contact = raw as Dictionary<string, object>;
            if (contact == null) throw new InvalidDataException("An organization contact is invalid.");
            string id = RequiredBoundedString(contact, "id", 100, false, "organization contact");
            if (!ids.Add(id)) throw new InvalidDataException("The organization contacts contain a duplicate ID.");
            foreach (string key in new[] { "organization", "position", "name" })
            {
                string value = RequiredBoundedString(contact, key, key == "organization" ? 200 : key == "position" ? 80 : 120, false, "organization contact");
                if (String.IsNullOrWhiteSpace(value)) throw new InvalidDataException("An organization contact is missing its " + key + ".");
            }
            object[] methods = contact.ContainsKey("methods") ? contact["methods"] as object[] : null;
            if (methods == null || methods.Length < 1 || methods.Length > 4) throw new InvalidDataException("An organization contact must have between 1 and 4 email addresses or phone numbers.");
            foreach (object methodRaw in methods)
            {
                Dictionary<string, object> method = methodRaw as Dictionary<string, object>;
                string type = method != null && method.ContainsKey("type") ? method["type"] as string : null, value = method != null && method.ContainsKey("value") ? method["value"] as string : null;
                bool valid = type == "Email" ? value != null && value.Length <= 254 && Regex.IsMatch(value, @"^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
                    : type == "Phone" && value != null && value.Length <= 40 && Regex.IsMatch(value, @"^\+?[0-9().\-\s]{7,30}(?:\s*(?:x|ext\.?)\s*[0-9]{1,6})?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) && value.Count(Char.IsDigit) >= 7;
                if (!valid) throw new InvalidDataException("An organization contact has an invalid email address or phone number.");
            }
        }
    }

    private static void ValidateExtractionProvenance(Dictionary<string, object> provenance)
    {
        var keys = new HashSet<string>(new[] { "identity", "organization", "officialEmail", "designation", "accountType" }, StringComparer.Ordinal);var sources = new HashSet<string>(new[] { "Filename", "Organization Folder", "SAAR AcroForm", "DD2875 XFA", "Selectable PDF Text", "Operator" }, StringComparer.Ordinal);if (provenance.Count > keys.Count) throw new InvalidDataException("A user extraction-provenance record exceeds its field limit.");
        foreach (KeyValuePair<string, object> pair in provenance) { if (!keys.Contains(pair.Key)) throw new InvalidDataException("A user extraction-provenance record contains an unsupported field.");Dictionary<string, object> item = ObjectDictionary(pair.Value);string source = RequiredBoundedString(item, "source", 50, false, "extraction provenance"), timestamp = RequiredBoundedString(item, "verifiedAtUtc", 50, false, "extraction provenance");RequiredBoundedString(item, "detail", 500, true, "extraction provenance");OptionalBoundedString(item, "filename", 500, "extraction provenance");DateTime parsed;if (!sources.Contains(source) || !DateTime.TryParse(timestamp, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out parsed)) throw new InvalidDataException("A user extraction-provenance record is invalid."); }
    }
}
