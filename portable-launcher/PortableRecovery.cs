using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

internal sealed partial class PortableStorage
{
    private const int RecoveryRunVersion = 1;
    private const int RecoveryRetryVersion = 1;
    private const long RecoveryFileLimit = 2L * 1024 * 1024;

    private string RecoveryRunPath(string systemId) { return Path.Combine(SupportDirectory(LocalWorkspaceRoot(systemId), "Recovery"), "active-run.json.dpapi"); }
    private string RecoveryRetryPath(string systemId) { return Path.Combine(SupportDirectory(LocalWorkspaceRoot(systemId), "Recovery"), "retry-queue.json.dpapi"); }

    public string BeginRecoveryOperation(string systemId, string operationId, string action, string requestSha256, string organization)
    {
        string runId = String.IsNullOrWhiteSpace(operationId) ? Guid.NewGuid().ToString("D") : operationId;
        var record = new Dictionary<string, object> { { "version", RecoveryRunVersion }, { "runId", runId }, { "operationId", operationId ?? "" }, { "action", CleanLine(action, 100) }, { "requestSha256", requestSha256 ?? "" }, { "organization", CleanLine(organization ?? "", 200) }, { "state", "running" }, { "stage", "authorized" }, { "startedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "updatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "message", "The launcher authorized the operation and persisted its recovery state." }, { "recoverable", true } };
        lock (RootLock(systemId)) WriteProtectedLocalJson(RecoveryRunPath(systemId), "recovery-run", json.Serialize(record));
        return runId;
    }

    public void CompleteRecoveryOperation(string systemId, string runId, string action)
    {
        UpdateRecoveryOperation(systemId, runId, action, "completed", "committed", "The operation completed and its durable receipt was recorded.", false, null, null);
    }

    public void FailRecoveryOperation(string systemId, string runId, string action, string operationId, string requestSha256, string organization, Exception error)
    {
        string message = CleanLine(error == null ? "The operation failed." : error.Message, 1000);
        UpdateRecoveryOperation(systemId, runId, action, "failed", "failed", message, true, operationId, requestSha256);
        QueueRecoveryRetry(systemId, operationId, action, requestSha256, organization, message);
    }

    private void UpdateRecoveryOperation(string systemId, string runId, string action, string state, string stage, string message, bool recoverable, string operationId, string requestSha256)
    {
        lock (RootLock(systemId))
        {
            string path = RecoveryRunPath(systemId);Dictionary<string, object> record = null;
            try { if (File.Exists(path)) record = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "recovery-run", RecoveryFileLimit))); } catch { }
            if (record == null || !String.Equals(Convert.ToString(record["runId"], CultureInfo.InvariantCulture), runId, StringComparison.Ordinal)) record = new Dictionary<string, object> { { "version", RecoveryRunVersion }, { "runId", runId ?? Guid.NewGuid().ToString("D") }, { "operationId", operationId ?? "" }, { "action", CleanLine(action, 100) }, { "requestSha256", requestSha256 ?? "" }, { "organization", "" }, { "startedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) } };
            record["state"] = state;record["stage"] = stage;record["updatedAtUtc"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);record["message"] = CleanLine(message, 1000);record["recoverable"] = recoverable;
            WriteProtectedLocalJson(path, "recovery-run", json.Serialize(record));
        }
    }

    private void QueueRecoveryRetry(string systemId, string operationId, string action, string requestSha256, string organization, string message)
    {
        lock (RootLock(systemId))
        {
            string path = RecoveryRetryPath(systemId);var items = new List<Dictionary<string, object>>();
            try { if (File.Exists(path)) items.AddRange(ObjectArray(ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "recovery-retry-queue", RecoveryFileLimit)))["items"]).Select(ObjectDictionary)); } catch { items.Clear(); }
            string key = IsSha256(requestSha256) ? requestSha256.ToLowerInvariant() : Sha256((operationId ?? "") + "\n" + (action ?? "") + "\n" + (organization ?? ""));
            int attempts = items.Where(item => String.Equals(Convert.ToString(item["key"], CultureInfo.InvariantCulture), key, StringComparison.OrdinalIgnoreCase)).Select(item => Convert.ToInt32(item["attempts"], CultureInfo.InvariantCulture)).DefaultIfEmpty(0).Max() + 1;
            items.RemoveAll(item => String.Equals(Convert.ToString(item["key"], CultureInfo.InvariantCulture), key, StringComparison.OrdinalIgnoreCase));
            items.Add(new Dictionary<string, object> { { "key", key }, { "operationId", operationId ?? "" }, { "action", CleanLine(action, 100) }, { "organization", CleanLine(organization ?? "", 200) }, { "message", CleanLine(message, 1000) }, { "attempts", attempts }, { "state", "pending" }, { "lastFailedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) } });
            if (items.Count > 1000) items = items.Skip(items.Count - 1000).ToList();
            WriteProtectedLocalJson(path, "recovery-retry-queue", json.Serialize(new Dictionary<string, object> { { "version", RecoveryRetryVersion }, { "items", items.Cast<object>().ToArray() } }));
        }
    }

    public void QueueRecoveryFileFailure(string systemId, string operationKey, string organization, string message)
    {
        QueueRecoveryRetry(systemId, "", "workspace-publish-file", operationKey, organization, message);
    }

    public string ReadRecoveryCenter(string systemId)
    {
        lock (RootLock(systemId))
        {
            object run = null;object[] retries = new object[0];string runPath = RecoveryRunPath(systemId), retryPath = RecoveryRetryPath(systemId);
            try { if (File.Exists(runPath)) run = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(runPath, "recovery-run", RecoveryFileLimit))); } catch { run = new Dictionary<string, object> { { "state", "damaged" }, { "message", "The protected recovery run record could not be read." }, { "recoverable", true } }; }
            try { if (File.Exists(retryPath)) retries = ObjectArray(ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(retryPath, "recovery-retry-queue", RecoveryFileLimit)))["items"]); } catch { retries = new object[] { new Dictionary<string, object> { { "key", Sha256("damaged-retry-queue") }, { "operationId", "" }, { "action", "recovery-queue" }, { "organization", "" }, { "state", "damaged" }, { "attempts", 0 }, { "message", "The protected retry queue could not be read." } } }; }
            return json.Serialize(new Dictionary<string, object> { { "recoveryRun", run }, { "retryQueue", retries }, { "pendingRetries", retries.Count(item => String.Equals(Convert.ToString(ObjectDictionary(item)["state"], CultureInfo.InvariantCulture), "pending", StringComparison.Ordinal)) }, { "automaticDeletion", false } });
        }
    }

    public string DeferRecoveryRetry(string systemId, string key)
    {
        if (!IsSha256(key)) throw new InvalidDataException("The recovery item identity is invalid.");
        lock (RootLock(systemId))
        {
            string path = RecoveryRetryPath(systemId);if (!File.Exists(path)) return "{\"deferred\":false}";
            Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "recovery-retry-queue", RecoveryFileLimit)));object[] values = ObjectArray(envelope["items"]);bool changed = false;
            foreach (object value in values) { Dictionary<string, object> item = ObjectDictionary(value);if (String.Equals(Convert.ToString(item["key"], CultureInfo.InvariantCulture), key, StringComparison.OrdinalIgnoreCase)) { item["state"] = "deferred";item["deferredAtUtc"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);changed = true; } }
            if (changed) WriteProtectedLocalJson(path, "recovery-retry-queue", json.Serialize(new Dictionary<string, object> { { "version", RecoveryRetryVersion }, { "items", values } }));
            return "{\"deferred\":" + (changed ? "true" : "false") + "}";
        }
    }
}
