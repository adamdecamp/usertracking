using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

internal sealed partial class PortableStorage
{
    private const int OperationReceiptVersion = 1;
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

    public void SaveOperationReceipt(string systemId, string operationId, string action, string response)
    {
        if (String.IsNullOrWhiteSpace(operationId)) return;
        string cleanAction = CleanLine(action, 100), compact = response ?? "{}";
        if (Encoding.UTF8.GetByteCount(compact) > OperationReceiptResponseLimit)
        {
            try { Dictionary<string, object> value = ObjectDictionary(json.DeserializeObject(compact));value.Remove("manifest");compact = json.Serialize(value); }
            catch { compact = ""; }
        }
        if (Encoding.UTF8.GetByteCount(compact) > OperationReceiptResponseLimit) compact = "";
        var receipt = new Dictionary<string, object> { { "version", OperationReceiptVersion }, { "operationId", operationId }, { "action", cleanAction }, { "completedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "responseSha256", Sha256(compact) }, { "response", compact } };
        lock (RootLock(systemId))
        {
            string directory = OperationReceiptDirectory(systemId);WriteProtectedLocalJson(OperationReceiptPath(systemId, operationId), "operation-receipt", json.Serialize(receipt));
            foreach (string stale in Directory.EnumerateFiles(directory, "*.json.dpapi", SearchOption.TopDirectoryOnly).Where(path => File.GetLastWriteTimeUtc(path) < DateTime.UtcNow.AddDays(-7)).Take(100).ToArray()) TryDelete(stale);
        }
    }

    public string ReadOperationReceipt(string systemId, string operationId)
    {
        lock (RootLock(systemId))
        {
            string path = OperationReceiptPath(systemId, operationId);if (!File.Exists(path)) return "{\"completed\":false}";
            Dictionary<string, object> value = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "operation-receipt", OperationReceiptLimit)));
            if (Convert.ToInt32(value["version"], CultureInfo.InvariantCulture) != OperationReceiptVersion || !String.Equals(Convert.ToString(value["operationId"], CultureInfo.InvariantCulture), operationId, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The operation receipt failed validation.");
            string response = Convert.ToString(value["response"], CultureInfo.InvariantCulture) ?? "";if (!String.Equals(Convert.ToString(value["responseSha256"], CultureInfo.InvariantCulture), Sha256(response), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The operation receipt failed its SHA-256 check.");
            return json.Serialize(new Dictionary<string, object> { { "completed", true }, { "action", Convert.ToString(value["action"], CultureInfo.InvariantCulture) }, { "completedAtUtc", Convert.ToString(value["completedAtUtc"], CultureInfo.InvariantCulture) }, { "responseAvailable", response.Length > 0 }, { "response", response } });
        }
    }
}
