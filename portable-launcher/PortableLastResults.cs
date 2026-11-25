using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

/// <summary>
/// Keeps the last Sync review and the last Reconciliation for each system in
/// the protected local workspace (DPAPI, current Windows user) so an operator
/// can reopen them after logging off or closing the window. Results never go
/// to the shared folder. The browser validates the result body itself; this
/// store enforces the envelope, the owning system, and the size limit.
/// </summary>
internal sealed partial class PortableStorage
{
    internal const long LastResultLimit = 50L * 1024 * 1024;
    private static readonly string[] LastResultKinds = { "sync", "reconciliation" };

    private static string LastResultPath(string workspaceRoot, string kind)
    {
        if (Array.IndexOf(LastResultKinds, kind) < 0) throw new InvalidDataException("The saved result type is not supported.");
        string system = Path.Combine(workspaceRoot, SystemDirectoryName);Directory.CreateDirectory(system);return Path.Combine(system, "last-results-" + kind + ".json.dpapi");
    }

    public string LastResults(string systemId, string method, byte[] body, string kind)
    {
        if (String.Equals(method, "GET", StringComparison.Ordinal)) return ReadLastResults(systemId);
        if (String.Equals(method, "POST", StringComparison.Ordinal)) return SaveLastResult(systemId, body);
        if (String.Equals(method, "DELETE", StringComparison.Ordinal)) return ClearLastResult(systemId, kind);
        throw new InvalidDataException("The saved results request method is not supported.");
    }

    public string ReadLastResults(string systemId)
    {
        var result = new Dictionary<string, object>();
        lock (RootLock(systemId))
        {
            string workspaceRoot = LocalWorkspaceRoot(systemId);
            foreach (string kind in LastResultKinds)
            {
                string path = LastResultPath(workspaceRoot, kind);result[kind] = null;
                if (!File.Exists(path)) continue;
                try { Dictionary<string, object> value = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "last-results-" + kind, LastResultLimit)));ValidateLastResult(value, systemId, kind);result[kind] = value; }
                catch { TryDelete(path); }
            }
        }
        return json.Serialize(result);
    }

    public string SaveLastResult(string systemId, byte[] bytes)
    {
        if (bytes == null || bytes.LongLength <= 0 || bytes.LongLength > LastResultLimit) throw new InvalidDataException("The saved result is empty or exceeds 50 MiB.");
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes); }
        catch (DecoderFallbackException) { throw new InvalidDataException("The saved result is not valid UTF-8 JSON."); }
        Dictionary<string, object> value;
        try { value = ObjectDictionary(json.DeserializeObject(text)); }
        catch { throw new InvalidDataException("The saved result is invalid JSON."); }
        string kind = value.ContainsKey("kind") ? Convert.ToString(value["kind"], CultureInfo.InvariantCulture) : "";
        ValidateLastResult(value, systemId, kind);
        lock (RootLock(systemId)) WriteProtectedLocalJson(LastResultPath(LocalWorkspaceRoot(systemId), kind), "last-results-" + kind, text);
        return "{\"saved\":true}";
    }

    public string ClearLastResult(string systemId, string kind)
    {
        lock (RootLock(systemId)) TryDelete(LastResultPath(LocalWorkspaceRoot(systemId), kind ?? ""));
        return "{\"cleared\":true}";
    }

    private static void ValidateLastResult(Dictionary<string, object> value, string systemId, string kind)
    {
        if (Array.IndexOf(LastResultKinds, kind) < 0 || !value.ContainsKey("version") || !value.ContainsKey("kind")) throw new InvalidDataException("The saved result type is not supported.");
        // The file already belongs to this mapped system's storage; the body carries the
        // logical information-system id, which the browser checks when it reads the result.
        string storedKind = RequiredBoundedString(value, "kind", 20, false, "Saved result"), saved = RequiredBoundedString(value, "savedAtUtc", 50, false, "Saved result");
        RequiredBoundedString(value, "systemId", 100, false, "Saved result");RequiredBoundedString(value, "savedBy", 200, true, "Saved result");DateTime parsed;
        if (Convert.ToInt32(value["version"], CultureInfo.InvariantCulture) != 1 || !String.Equals(storedKind, kind, StringComparison.Ordinal) || !DateTime.TryParse(saved, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out parsed)) throw new InvalidDataException("The saved result failed validation.");
        if (String.Equals(kind, "sync", StringComparison.Ordinal) && (!value.ContainsKey("review") || !(value["review"] is Dictionary<string, object>) || !IsSha256(Convert.ToString(value.ContainsKey("baseStateHash") ? value["baseStateHash"] : "", CultureInfo.InvariantCulture)))) throw new InvalidDataException("The saved Sync review failed validation.");
        if (String.Equals(kind, "reconciliation", StringComparison.Ordinal) && (!value.ContainsKey("issues") || !(value["issues"] is object[]))) throw new InvalidDataException("The saved Reconciliation failed validation.");
    }
}
