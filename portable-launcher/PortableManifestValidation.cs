using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
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

    private static void ValidateExtractionProvenance(Dictionary<string, object> provenance)
    {
        var keys = new HashSet<string>(new[] { "identity", "organization", "officialEmail", "designation", "accountType" }, StringComparer.Ordinal);var sources = new HashSet<string>(new[] { "Filename", "Organization Folder", "SAAR AcroForm", "DD2875 XFA", "Selectable PDF Text", "Operator" }, StringComparer.Ordinal);if (provenance.Count > keys.Count) throw new InvalidDataException("A user extraction-provenance record exceeds its field limit.");
        foreach (KeyValuePair<string, object> pair in provenance) { if (!keys.Contains(pair.Key)) throw new InvalidDataException("A user extraction-provenance record contains an unsupported field.");Dictionary<string, object> item = ObjectDictionary(pair.Value);string source = RequiredBoundedString(item, "source", 50, false, "extraction provenance"), timestamp = RequiredBoundedString(item, "verifiedAtUtc", 50, false, "extraction provenance");RequiredBoundedString(item, "detail", 500, true, "extraction provenance");OptionalBoundedString(item, "filename", 500, "extraction provenance");DateTime parsed;if (!sources.Contains(source) || !DateTime.TryParse(timestamp, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out parsed)) throw new InvalidDataException("A user extraction-provenance record is invalid."); }
    }
}
