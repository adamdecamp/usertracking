using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

internal sealed partial class PortableStorage
{
    public void UpdateActor(string currentActor)
    {
        string next = CleanLine(currentActor, 500);
        if (String.IsNullOrWhiteSpace(next)) throw new InvalidDataException("The operator identity is required.");
        actor = next;
    }

    public string ReadOperators(string systemId)
    {
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "Audit Logs");AuditState state = VerifyAuditChain(directory);EnsureAuditAnchor(directory, state);SaveAuditCheckpoint(directory, state);
            object[] operators = state.Operators.Values.OrderBy(item => Convert.ToString(item["fullName"], CultureInfo.InvariantCulture)).ThenBy(item => Convert.ToString(item["windowsUser"], CultureInfo.InvariantCulture)).Cast<object>().ToArray();
            return json.Serialize(new Dictionary<string, object> { { "operators", operators }, { "generatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "auditEntries", state.Entries } });
        }
    }

    private static void TrackOperator(AuditState state, string entryActor, string timestamp)
    {
        string clean = CleanLine(entryActor, 500), fullName = "", windowsUser = clean;int open = clean.LastIndexOf(" (", StringComparison.Ordinal);
        if (open > 0 && clean.EndsWith(")", StringComparison.Ordinal))
        {
            string candidate = clean.Substring(open + 2, clean.Length - open - 3);
            if (candidate.IndexOf('\\') > 0) { fullName = clean.Substring(0, open);windowsUser = candidate; }
        }
        string key = windowsUser.ToUpperInvariant();Dictionary<string, object> record;
        if (!state.Operators.TryGetValue(key, out record))
        {
            record = new Dictionary<string, object> { { "fullName", fullName }, { "windowsUser", windowsUser }, { "firstSeenUtc", timestamp }, { "lastSeenUtc", timestamp }, { "auditEntries", 1L } };state.Operators[key] = record;return;
        }
        if (!String.IsNullOrWhiteSpace(fullName)) record["fullName"] = fullName;
        record["lastSeenUtc"] = timestamp;record["auditEntries"] = Convert.ToInt64(record["auditEntries"], CultureInfo.InvariantCulture) + 1L;
    }

    public string LeaseHolder(string systemId)
    {
        try
        {
            string path = LeaseFencePath(systemId);if (!File.Exists(path)) return "null";
            Dictionary<string, object> current = ObjectDictionary(json.DeserializeObject(ReadText(path, LeaseFenceLimit)));
            string holder = CleanLine(Convert.ToString(current["actor"], CultureInfo.InvariantCulture), 500), computer = CleanLine(Convert.ToString(current["computer"], CultureInfo.InvariantCulture), 255), startedAtUtc = CleanLine(Convert.ToString(current["createdAtUtc"], CultureInfo.InvariantCulture), 50);DateTimeOffset started;
            if (Convert.ToInt32(current["version"], CultureInfo.InvariantCulture) != LeaseFenceVersion || String.IsNullOrWhiteSpace(holder) || String.IsNullOrWhiteSpace(computer) || !DateTimeOffset.TryParse(startedAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out started)) return "null";
            return json.Serialize(new Dictionary<string, object> { { "actor", holder }, { "computer", computer }, { "startedAtUtc", started.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture) } });
        }
        catch { return "null"; }
    }
}
