using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;

internal sealed partial class PortableStorage
{
    internal const int EvidenceMoveBatchLimit = 100;
    internal static TimeSpan BatchLeaseRecheckInterval = TimeSpan.FromSeconds(30);

    // Sync organizes and renames many files in a row. One request per file paid a
    // browser round trip plus a shared lease-fence read each time; a batch runs the
    // same per-file operations in order inside one request. Every file keeps its own
    // result or error, so one failure never hides the others. The lease is checked
    // again every 30 seconds; once it is lost the remaining files are not touched.
    public string OrganizeEvidenceBatch(string systemId, byte[] body, Func<bool> leaseStillHeld)
    {
        return RunEvidenceMoveBatch(body, leaseStillHeld, item => OrganizeEvidence(systemId, BatchText(item, "path"), BatchText(item, "folder")));
    }

    public string NormalizeEvidenceFilenameBatch(string systemId, byte[] body, Func<bool> leaseStillHeld)
    {
        return RunEvidenceMoveBatch(body, leaseStillHeld, item => NormalizeEvidenceFilename(systemId, BatchText(item, "path"), BatchText(item, "filename")));
    }

    // Clean Up, Unarchive, and Session Commit archive several files the same way. Each item
    // names one of four allowed actions and gets exactly the single-file operation's result.
    public string EvidenceActionBatch(string systemId, byte[] body, Func<bool> leaseStillHeld)
    {
        return RunEvidenceMoveBatch(body, leaseStillHeld, item =>
        {
            string action = BatchText(item, "action"), path = BatchText(item, "path");
            if (action == "archive")
            {
                object filename, rework;
                string requested = item.TryGetValue("filename", out filename) ? filename as string : null;
                bool allowRework = item.TryGetValue("rework", out rework) && rework is bool && (bool)rework;
                return ArchiveEvidence(systemId, path, requested ?? "", allowRework);
            }
            if (action == "rework") return MoveEvidenceToRework(systemId, path);
            if (action == "compress") return CompressEvidence(systemId, path);
            if (action == "unarchive") return UnarchiveEvidence(systemId, path);
            throw new InvalidDataException("The evidence batch action is not supported.");
        });
    }

    private string RunEvidenceMoveBatch(byte[] body, Func<bool> leaseStillHeld, Func<Dictionary<string, object>, string> move)
    {
        object[] items;
        try { items = json.DeserializeObject(new UTF8Encoding(false, true).GetString(body ?? new byte[0])) as object[]; }
        catch (Exception) { throw new InvalidDataException("The evidence batch is not valid JSON."); }
        if (items == null || items.Length == 0 || items.Length > EvidenceMoveBatchLimit) throw new InvalidDataException("The evidence batch must contain between 1 and " + EvidenceMoveBatchLimit + " files.");
        var results = new StringBuilder("[");var sinceLeaseCheck = Stopwatch.StartNew();bool leaseLost = false;
        for (int index = 0; index < items.Length; index++)
        {
            if (index > 0) results.Append(',');
            if (!leaseLost && sinceLeaseCheck.Elapsed >= BatchLeaseRecheckInterval) { leaseLost = !leaseStillHeld();sinceLeaseCheck.Restart(); }
            if (leaseLost) { results.Append(json.Serialize(new Dictionary<string, object> { { "ok", false }, { "leaseLost", true }, { "error", "The exclusive Full Access lease was lost, so this file was not changed." } }));continue; }
            try
            {
                var item = items[index] as Dictionary<string, object>;
                if (item == null) throw new InvalidDataException("Every evidence batch item must be an object.");
                string moved = move(item);
                results.Append("{\"ok\":true,\"result\":").Append(moved).Append('}');
            }
            catch (Exception error)
            {
                if (error is OutOfMemoryException || error is StackOverflowException) throw;
                results.Append(json.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", CleanLine(String.IsNullOrWhiteSpace(error.Message) ? "The evidence file could not be changed." : error.Message, 500) } }));
            }
        }
        return results.Append(']').ToString();
    }

    private static string BatchText(Dictionary<string, object> item, string key)
    {
        object value;
        string text = item.TryGetValue(key, out value) ? value as string : null;
        if (String.IsNullOrWhiteSpace(text)) throw new InvalidDataException("The evidence batch item is missing " + key + ".");
        return text;
    }
}
