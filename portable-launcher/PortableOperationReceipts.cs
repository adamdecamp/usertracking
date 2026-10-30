using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

internal sealed partial class PortableStorage
{
    private const int OperationReceiptVersion = 2;
    private const long OperationReceiptLimit = 2L * 1024 * 1024;
    private const long OperationReceiptResponseLimit = 1L * 1024 * 1024;

    private string OperationReceiptDirectory(string systemId)
    {
        string directory = Path.Combine(LocalWorkspaceRoot(systemId), SystemDirectoryName, "Operation Receipts");Directory.CreateDirectory(directory);return directory;
    }

    private string OperationReceiptPath(string systemId, string operationId)
    {
        Guid parsed;if (!Guid.TryParse(operationId, out parsed)) throw new InvalidDataException("The operation receipt identity is invalid.");
        return Path.Combine(OperationReceiptDirectory(systemId), parsed.ToString("D") + ".json.dpapi");
    }

    public void SaveOperationReceipt(string systemId, string operationId, string action, string requestSha256, string response)
    {
        if (String.IsNullOrWhiteSpace(operationId)) return;
        if (!IsSha256(requestSha256)) throw new InvalidDataException("The operation receipt request fingerprint is invalid.");
        string cleanAction = CleanLine(action, 100), compact = response ?? "{}";
        if (Encoding.UTF8.GetByteCount(compact) > OperationReceiptResponseLimit)
        {
            try { Dictionary<string, object> value = ObjectDictionary(json.DeserializeObject(compact));value.Remove("manifest");compact = json.Serialize(value); }
            catch { compact = ""; }
        }
        if (Encoding.UTF8.GetByteCount(compact) > OperationReceiptResponseLimit) compact = "";
        var receipt = new Dictionary<string, object> { { "version", OperationReceiptVersion }, { "operationId", operationId }, { "action", cleanAction }, { "requestSha256", requestSha256.ToLowerInvariant() }, { "completedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "responseSha256", Sha256(compact) }, { "response", compact } };
        lock (RootLock(systemId))
        {
            string directory = OperationReceiptDirectory(systemId), path = OperationReceiptPath(systemId, operationId);
            if (File.Exists(path))
            {
                string existingResponse;
                if (!TryReplayOperation(systemId, operationId, cleanAction, requestSha256, out existingResponse)) throw new InvalidDataException("The existing operation receipt could not be replayed.");
                if (!String.Equals(existingResponse, compact, StringComparison.Ordinal)) throw new InvalidDataException("The completed operation identity cannot be reused for a different response.");
                return;
            }
            WriteProtectedLocalJson(path, "operation-receipt", json.Serialize(receipt));
            foreach (string stale in Directory.EnumerateFiles(directory, "*.json.dpapi", SearchOption.TopDirectoryOnly).Where(candidate => File.GetLastWriteTimeUtc(candidate) < DateTime.UtcNow.AddDays(-7)).Take(100).ToArray()) TryDelete(stale);
        }
    }

    public void SaveOperationReceipt(string systemId, string operationId, string action, string response)
    {
        SaveOperationReceipt(systemId, operationId, action, Sha256("legacy-operation-request\n" + CleanLine(action, 100)), response);
    }

    public bool TryReplayOperation(string systemId, string operationId, string action, string requestSha256, out string response)
    {
        response = null;if (String.IsNullOrWhiteSpace(operationId)) return false;
        lock (RootLock(systemId))
        {
            string path;
            try { path = OperationReceiptPath(systemId, operationId); }
            catch (InvalidOperationException) { return false; }
            if (!File.Exists(path)) return false;
            Dictionary<string, object> value = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "operation-receipt", OperationReceiptLimit)));
            int version = Convert.ToInt32(value["version"], CultureInfo.InvariantCulture);
            if ((version != 1 && version != OperationReceiptVersion) || !String.Equals(Convert.ToString(value["operationId"], CultureInfo.InvariantCulture), operationId, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The operation receipt failed validation.");
            string storedAction = Convert.ToString(value["action"], CultureInfo.InvariantCulture);
            if (!String.Equals(storedAction, CleanLine(action, 100), StringComparison.Ordinal)) throw new InvalidDataException("The operation identity was already used for a different action.");
            if (version >= 2 && !String.Equals(Convert.ToString(value["requestSha256"], CultureInfo.InvariantCulture), requestSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The operation identity was already used for a different request.");
            response = Convert.ToString(value["response"], CultureInfo.InvariantCulture) ?? "";
            if (!String.Equals(Convert.ToString(value["responseSha256"], CultureInfo.InvariantCulture), Sha256(response), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The operation receipt failed its SHA-256 check.");
            return true;
        }
    }

    public string ReadOperationReceipt(string systemId, string operationId)
    {
        // A lost browser connection must be able to observe a long publication
        // while PublishWorkspace owns the per-system root lock. Checking the
        // protected recovery marker before taking that lock prevents the status
        // request from blocking behind the very operation it is monitoring.
        string path = OperationReceiptPath(systemId, operationId);
        if (!File.Exists(path))
        {
            try
            {
                string recoveryPath = RecoveryRunPath(systemId);
                if (File.Exists(recoveryPath))
                {
                    Dictionary<string, object> run = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(recoveryPath, "recovery-run", RecoveryFileLimit)));
                    string runOperationId = Convert.ToString(run["operationId"], CultureInfo.InvariantCulture), state = Convert.ToString(run["state"], CultureInfo.InvariantCulture), action = Convert.ToString(run["action"], CultureInfo.InvariantCulture);
                    if (String.Equals(runOperationId, operationId, StringComparison.OrdinalIgnoreCase))
                    {
                        bool running = String.Equals(state, "running", StringComparison.Ordinal), failed = String.Equals(state, "failed", StringComparison.Ordinal);
                        return json.Serialize(new Dictionary<string, object> { { "completed", false }, { "running", running }, { "failed", failed }, { "action", action }, { "startedAtUtc", Convert.ToString(run["startedAtUtc"], CultureInfo.InvariantCulture) }, { "message", Convert.ToString(run["message"], CultureInfo.InvariantCulture) } });
                    }
                }
            }
            catch { /* A receipt may be appearing atomically; retry on the next poll. */ }
            return "{\"completed\":false,\"running\":false,\"failed\":false}";
        }
        lock (RootLock(systemId))
        {
            if (!File.Exists(path)) return "{\"completed\":false,\"running\":false,\"failed\":false}";
            Dictionary<string, object> value = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "operation-receipt", OperationReceiptLimit)));
            int version = Convert.ToInt32(value["version"], CultureInfo.InvariantCulture);if ((version != 1 && version != OperationReceiptVersion) || !String.Equals(Convert.ToString(value["operationId"], CultureInfo.InvariantCulture), operationId, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The operation receipt failed validation.");
            string response = Convert.ToString(value["response"], CultureInfo.InvariantCulture) ?? "";if (!String.Equals(Convert.ToString(value["responseSha256"], CultureInfo.InvariantCulture), Sha256(response), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The operation receipt failed its SHA-256 check.");
            return json.Serialize(new Dictionary<string, object> { { "completed", true }, { "action", Convert.ToString(value["action"], CultureInfo.InvariantCulture) }, { "completedAtUtc", Convert.ToString(value["completedAtUtc"], CultureInfo.InvariantCulture) }, { "responseAvailable", response.Length > 0 }, { "response", response } });
        }
    }
}
