using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

internal sealed partial class PortableStorage
{
    private static void ValidateExtractionProvenance(Dictionary<string, object> provenance)
    {
        var keys = new HashSet<string>(new[] { "identity", "organization", "officialEmail", "designation", "accountType" }, StringComparer.Ordinal);var sources = new HashSet<string>(new[] { "Filename", "Organization Folder", "SAAR AcroForm", "DD2875 XFA", "Selectable PDF Text", "Operator" }, StringComparer.Ordinal);if (provenance.Count > keys.Count) throw new InvalidDataException("A user extraction-provenance record exceeds its field limit.");
        foreach (KeyValuePair<string, object> pair in provenance) { if (!keys.Contains(pair.Key)) throw new InvalidDataException("A user extraction-provenance record contains an unsupported field.");Dictionary<string, object> item = ObjectDictionary(pair.Value);string source = RequiredBoundedString(item, "source", 50, false, "extraction provenance"), timestamp = RequiredBoundedString(item, "verifiedAtUtc", 50, false, "extraction provenance");RequiredBoundedString(item, "detail", 500, true, "extraction provenance");OptionalBoundedString(item, "filename", 500, "extraction provenance");DateTime parsed;if (!sources.Contains(source) || !DateTime.TryParse(timestamp, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out parsed)) throw new InvalidDataException("A user extraction-provenance record is invalid."); }
    }
}
