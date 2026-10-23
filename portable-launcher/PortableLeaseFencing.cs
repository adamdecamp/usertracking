using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

internal sealed partial class PortableStorage
{
    private const int LeaseFenceVersion = 1;
    private const long LeaseFenceLimit = 16L * 1024;

    private string LeaseFencePath(string systemId)
    {
        return SystemFile(Root(systemId), "exclusive-editor-fence.json");
    }

    private void InitializeLeaseFence(string systemId, HeldLease held)
    {
        string path = LeaseFencePath(systemId);long generation = 0;
        if (File.Exists(path))
        {
            Dictionary<string, object> current = ObjectDictionary(json.DeserializeObject(ReadText(path, LeaseFenceLimit)));
            if (Convert.ToInt32(current["version"], CultureInfo.InvariantCulture) != LeaseFenceVersion || !Int64.TryParse(Convert.ToString(current["generation"], CultureInfo.InvariantCulture), NumberStyles.None, CultureInfo.InvariantCulture, out generation) || generation < 1 || generation == Int64.MaxValue) throw new InvalidDataException("The exclusive editor fencing record is invalid. Use Recovery Center before starting another Full Access session.");
        }
        held.Generation = generation + 1;
        var next = new Dictionary<string, object> { { "version", LeaseFenceVersion }, { "generation", held.Generation }, { "sessionId", held.SessionId }, { "actor", actor }, { "computer", Environment.MachineName }, { "createdAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) } };
        AtomicWrite(path, System.Text.Encoding.UTF8.GetBytes(json.Serialize(next)));
    }

    private bool LeaseFenceMatches(string systemId, HeldLease held)
    {
        try
        {
            string path = LeaseFencePath(systemId);if (!File.Exists(path)) return false;
            Dictionary<string, object> current = ObjectDictionary(json.DeserializeObject(ReadText(path, LeaseFenceLimit)));
            long generation;
            return Convert.ToInt32(current["version"], CultureInfo.InvariantCulture) == LeaseFenceVersion
                && Int64.TryParse(Convert.ToString(current["generation"], CultureInfo.InvariantCulture), NumberStyles.None, CultureInfo.InvariantCulture, out generation)
                && generation == held.Generation
                && String.Equals(Convert.ToString(current["sessionId"], CultureInfo.InvariantCulture), held.SessionId, StringComparison.Ordinal);
        }
        catch { return false; }
    }
}
