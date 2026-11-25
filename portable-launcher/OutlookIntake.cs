using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

/// <summary>
/// One received Outlook message as seen by evidence intake. The COM reader in
/// TrackerContext produces these; tests supply them directly, so the intake
/// rules never depend on a live mailbox.
/// </summary>
internal sealed class OutlookIntakeMessage
{
    public string MessageId;
    public string Sender;
    public DateTime ReceivedUtc;
    public readonly List<OutlookIntakeAttachment> Attachments = new List<OutlookIntakeAttachment>();
}

internal sealed class OutlookIntakeAttachment
{
    public string Filename;
    public Action<string> SaveAs;
}

/// <summary>
/// Outlook evidence intake. Read-only toward Outlook: approved-sender PDF
/// attachments are copied into the local organization intake folder, exactly
/// where an operator would drop them, so Daily Sync applies the normal
/// filename, content, identity, and duplicate checks and the operator reviews
/// every result. Nothing here changes a user record.
/// </summary>
internal sealed partial class PortableStorage
{
    internal const int OutlookIntakeMaximumDays = 90, OutlookIntakeMaximumMessages = 2000, OutlookIntakeMaximumAttachments = 50;
    private const int OutlookIntakeLedgerLimit = 20000;

    internal static string OutlookIntakeOrganizationCode(string filename)
    {
        string name = (filename ?? "").Trim();
        if (!name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) return null;
        int open = name.IndexOf('('), close = open > 0 ? name.IndexOf(')', open + 1) : -1;
        if (open <= 0 || close <= open + 1 || close - open - 1 > 100) return null;
        string[] names = name.Substring(0, open).Split(new[] { '_', ' ', ',', '.', '-' }, StringSplitOptions.RemoveEmptyEntries);
        string code = name.Substring(open + 1, close - open - 1).Trim();
        return names.Length >= 2 && code.Length > 0 ? code : null;
    }

    internal static string OutlookIntakeAddress(string value)
    {
        string address = CleanLine(value, 254).Trim().Trim('<', '>').ToLowerInvariant();
        int at = address.IndexOf('@');
        return at > 0 && at < address.Length - 1 && address.IndexOf(' ') < 0 ? address : "";
    }

    private static bool OutlookIntakeLooksLikePdf(byte[] bytes)
    {
        // PDF readers accept a header within the first KiB; Sync performs full content validation.
        int limit = Math.Min(bytes.Length - 5, 1024);
        for (int index = 0; index <= limit; index++) if (bytes[index] == '%' && bytes[index + 1] == 'P' && bytes[index + 2] == 'D' && bytes[index + 3] == 'F' && bytes[index + 4] == '-') return true;
        return false;
    }

    internal string OutlookIntakeDirectory(string systemId) { return LocalPerformanceCacheDirectory(Root(systemId), "Outlook Intake"); }

    internal string[] ReadOutlookIntakeFolder(string systemId)
    {
        string path = Path.Combine(OutlookIntakeDirectory(systemId), "folder.json");
        if (!File.Exists(path)) return null;
        try
        {
            var value = json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
            if (value == null || !value.ContainsKey("storeId") || !value.ContainsKey("entryId")) return null;
            return new[] { Convert.ToString(value["storeId"]), Convert.ToString(value["entryId"]), value.ContainsKey("name") ? Convert.ToString(value["name"]) : "", value.ContainsKey("path") ? Convert.ToString(value["path"]) : "" };
        }
        catch (Exception) { return null; }
    }

    // The folder path (\\Mailbox\Inbox\RAPTOR) is kept beside Outlook's IDs so a
    // folder whose ID stops resolving can still be found by name.
    internal void SaveOutlookIntakeFolder(string systemId, string storeId, string entryId, string name, string path = "")
    {
        if (String.IsNullOrWhiteSpace(storeId) || String.IsNullOrWhiteSpace(entryId)) throw new InvalidDataException("Outlook did not identify the selected folder.");
        string text = json.Serialize(new Dictionary<string, object> { { "storeId", storeId }, { "entryId", entryId }, { "name", CleanLine(name, 200) }, { "path", CleanLine(path, 1000) } });
        AtomicWrite(Path.Combine(OutlookIntakeDirectory(systemId), "folder.json"), Encoding.UTF8.GetBytes(text));
    }

    /// <summary>
    /// Copies new messages' PDF attachments out of Outlook into a per-computer
    /// reading folder. Reading Outlook is the slow part of a check and can wait on
    /// an Outlook prompt, so it runs before the system's storage queue is taken;
    /// filing the copies afterward (ProcessOutlookIntake) is quick. Stops at the
    /// next message once <paramref name="cancel"/> is signalled.
    /// </summary>
    internal List<OutlookIntakeMessage> StageOutlookIntakeMessages(string systemId, IEnumerable<OutlookIntakeMessage> messages, string readingRoot, CancellationToken cancel)
    {
        string ledgerPath = Path.Combine(OutlookIntakeDirectory(systemId), "processed-messages.txt");
        var processed = new HashSet<string>(File.Exists(ledgerPath) ? File.ReadAllLines(ledgerPath, Encoding.UTF8).Where(line => line.Length == 64) : Enumerable.Empty<string>(), StringComparer.Ordinal);
        Directory.CreateDirectory(readingRoot);
        var staged = new List<OutlookIntakeMessage>();
        foreach (OutlookIntakeMessage message in messages ?? Enumerable.Empty<OutlookIntakeMessage>())
        {
            cancel.ThrowIfCancellationRequested();
            if (message == null) continue;
            var copy = new OutlookIntakeMessage { MessageId = message.MessageId, Sender = message.Sender, ReceivedUtc = message.ReceivedUtc };
            staged.Add(copy);
            // Filed on an earlier check: ProcessOutlookIntake only counts it, so its attachments are not copied again.
            if (!String.IsNullOrWhiteSpace(message.MessageId) && processed.Contains(Sha256(message.MessageId.Trim()))) continue;
            foreach (OutlookIntakeAttachment attachment in message.Attachments.Where(item => item != null).Take(OutlookIntakeMaximumAttachments))
            {
                string name = (attachment.Filename ?? "").Trim();
                if (!name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                {
                    // Word documents and scans are only listed by name; their content is never needed.
                    if (OutlookIntakeOtherDocumentExtensions.Contains(Path.GetExtension(name).ToLowerInvariant())) copy.Attachments.Add(new OutlookIntakeAttachment { Filename = attachment.Filename });
                    continue;
                }
                string stagedPath = Path.Combine(readingRoot, Guid.NewGuid().ToString("N") + ".pdf");bool copied = false;
                if (attachment.SaveAs != null) { try { attachment.SaveAs(stagedPath);copied = File.Exists(stagedPath); } catch (Exception) { } }
                copy.Attachments.Add(new OutlookIntakeAttachment { Filename = attachment.Filename, SaveAs = copied ? new Action<string>(destination => File.Copy(stagedPath, destination, true)) : null });
            }
        }
        return staged;
    }

    public string ProcessOutlookIntake(string systemId, string folderName, IEnumerable<OutlookIntakeMessage> messages, IEnumerable<string> senders)
    {
        var approved = new HashSet<string>((senders ?? Enumerable.Empty<string>()).Select(OutlookIntakeAddress).Where(address => address.Length > 0), StringComparer.OrdinalIgnoreCase);
        if (approved.Count == 0) throw new InvalidDataException("No user in this information system has an Official Email, so Outlook intake has no approved senders.");
        string[] organizations = ((object[])json.DeserializeObject(ListOrganizations(systemId))).Select(value => Convert.ToString(value)).ToArray();
        string directory = OutlookIntakeDirectory(systemId), ledgerPath = Path.Combine(directory, "processed-messages.txt"), stagingRoot = Path.Combine(directory, "Staging");
        var ledger = File.Exists(ledgerPath) ? File.ReadAllLines(ledgerPath, Encoding.UTF8).Where(line => line.Length == 64).ToList() : new List<string>();
        var processed = new HashSet<string>(ledger, StringComparer.Ordinal);
        var saved = new List<Dictionary<string, object>>();var skipped = new List<Dictionary<string, object>>();
        int scanned = 0, previouslyProcessed = 0, withoutPdf = 0;string cleanFolder = CleanLine(folderName, 200);
        // Built only when a usable PDF needs checking; see OutlookIntakeRecorded.cs.
        var recorded = new Lazy<OutlookRecordedIndex>(() => OutlookRecordedEvidence(systemId));
        try
        {
            foreach (OutlookIntakeMessage message in messages ?? Enumerable.Empty<OutlookIntakeMessage>())
            {
                if (message == null) continue;
                scanned++;
                string key = String.IsNullOrWhiteSpace(message.MessageId) ? null : Sha256(message.MessageId.Trim());
                if (key != null && processed.Contains(key)) { previouslyProcessed++;continue; }
                List<OutlookIntakeAttachment> pdfs = message.Attachments.Where(item => item != null && (item.Filename ?? "").Trim().EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)).Take(OutlookIntakeMaximumAttachments).ToList();
                string sender = OutlookIntakeAddress(message.Sender), received = message.ReceivedUtc.ToUniversalTime().ToString("o");bool retry = false, approvedSender = approved.Contains(sender);
                if (pdfs.Count == 0) withoutPdf++;
                foreach (OutlookIntakeAttachment attachment in pdfs) retry |= !SaveOutlookIntakeAttachment(systemId, attachment, sender, approvedSender, received, organizations, stagingRoot, recorded, saved, skipped);
                // A Word document or scan from a known user is listed so the operator can ask for a PDF instead.
                if (approvedSender) foreach (OutlookIntakeAttachment document in message.Attachments.Where(item => item != null && OutlookIntakeOtherDocumentExtensions.Contains(Path.GetExtension((item.Filename ?? "").Trim()).ToLowerInvariant())).Take(OutlookIntakeMaximumAttachments))
                {
                    bool held;string name = SafePart(Path.GetFileName((document.Filename ?? "").Trim()), 180);
                    skipped.Add(OutlookHeldSkip(systemId, OutlookHoldInvalid, "This is a " + Path.GetExtension(name).TrimStart('.').ToUpperInvariant() + " file, not a PDF. Ask the sender to send it as a PDF.", name, null, null, sender, received, null, out held));
                    retry |= !held;
                }
                if (key != null && !retry) { processed.Add(key);ledger.Add(key); }
            }
        }
        finally
        {
            if (ledger.Count > OutlookIntakeLedgerLimit) ledger = ledger.Skip(ledger.Count - OutlookIntakeLedgerLimit).ToList();
            AtomicWrite(ledgerPath, Encoding.UTF8.GetBytes(String.Join("\n", ledger) + (ledger.Count > 0 ? "\n" : "")));
            if (recorded.IsValueCreated) SaveOutlookRecordedCache(systemId, recorded.Value);
            try { if (Directory.Exists(stagingRoot)) Directory.Delete(stagingRoot, true); } catch { }
        }
        int alreadyRecorded = skipped.Count(entry => entry.ContainsKey("recorded"));
        AppendAudit(systemId, "OUTLOOK INTAKE: folder " + (cleanFolder.Length > 0 ? cleanFolder : "Unnamed") + "; " + scanned + " messages read; " + saved.Count + " PDF attachments copied to organization intake for Sync review; " + skipped.Count + " attachments skipped; " + alreadyRecorded + " already recorded; " + previouslyProcessed + " messages previously processed; no user record changed");
        return json.Serialize(new Dictionary<string, object> { { "cancelled", false }, { "folder", cleanFolder }, { "scanned", scanned }, { "previouslyProcessed", previouslyProcessed }, { "withoutPdf", withoutPdf }, { "alreadyRecorded", alreadyRecorded }, { "saved", saved }, { "skipped", skipped } });
    }

    // Returns false when the attachment should be retried on a later check. Anything
    // the operator can resolve is held in Needs Attention (OutlookIntakeHold.cs).
    private bool SaveOutlookIntakeAttachment(string systemId, OutlookIntakeAttachment attachment, string sender, bool approvedSender, string received, string[] organizations, string stagingRoot, Lazy<OutlookRecordedIndex> recorded, List<Dictionary<string, object>> saved, List<Dictionary<string, object>> skipped)
    {
        string filename = SafePart(Path.GetFileName((attachment.Filename ?? "").Trim()), 180), code = OutlookIntakeOrganizationCode(filename);
        string organization = code == null ? null : organizations.FirstOrDefault(value => OutlookOrganizationMatches(code, value));
        if (attachment.SaveAs == null) { skipped.Add(OutlookIntakeEntry(filename, organization, sender, received, "Outlook did not provide the attachment content."));return false; }
        string staging = Path.Combine(stagingRoot, Guid.NewGuid().ToString("N")), stagedPath = Path.Combine(staging, "attachment.pdf");bool held;
        try
        {
            Directory.CreateDirectory(staging);
            attachment.SaveAs(stagedPath);
            var info = new FileInfo(stagedPath);
            byte[] bytes = info.Exists && info.Length > 0 && info.Length <= EvidenceLimit ? File.ReadAllBytes(stagedPath) : null;
            string invalid = bytes == null ? "The attachment is empty or exceeds the evidence size limit." : !OutlookIntakeLooksLikePdf(bytes) ? "The attachment is named .pdf but is not a PDF document." : null;
            if (invalid != null)
            {
                // Unusable files from unknown senders are not worth an operator's attention.
                if (!approvedSender) { skipped.Add(OutlookIntakeEntry(filename, organization, sender, received, invalid));return true; }
                skipped.Add(OutlookHeldSkip(systemId, OutlookHoldInvalid, invalid + " Ask the sender to send it again as a PDF.", filename, code, organization, sender, received, null, out held));return held;
            }
            // A PDF already recorded in this system's database is a re-sent copy, whoever sent it and however it is named.
            string recordedFor = OutlookRecordedMatch(recorded.Value, Sha256Bytes(bytes), filename);
            if (recordedFor != null)
            {
                var duplicate = OutlookIntakeEntry(filename, organization, sender, received, "Already recorded for " + recordedFor + ". This exact PDF is already in the database, so it was not copied.");
                duplicate["recorded"] = true;skipped.Add(duplicate);return true;
            }
            if (!approvedSender)
            {
                string reason = sender.Length == 0 ? "Outlook did not reveal the sender address. Outlook security settings may be blocking programmatic access." : "The sender is not the Official Email of a user in this information system.";
                skipped.Add(OutlookHeldSkip(systemId, OutlookHoldSender, reason + " Choose the user it belongs to.", filename, code, organization, sender, received, bytes, out held));return held;
            }
            if (code == null) { skipped.Add(OutlookHeldSkip(systemId, OutlookHoldFilename, "The filename does not follow Last_First_(ORG)_Document_DDMMMYYYY.pdf. Enter the user, organization, artifact type, and date.", filename, null, null, sender, received, bytes, out held));return held; }
            if (organization == null) { skipped.Add(OutlookHeldSkip(systemId, OutlookHoldOrganization, "No organization folder named " + CleanLine(code, 100) + " exists in this information system. Choose the organization to use.", filename, code, null, sender, received, bytes, out held));return held; }
            lock (RootLock(systemId))
            {
                string destination = Path.Combine(LocalIntakeDirectory(systemId, organization), filename);
                if (File.Exists(destination))
                {
                    if (String.Equals(Sha256Bytes(File.ReadAllBytes(destination)), Sha256Bytes(bytes), StringComparison.Ordinal)) { skipped.Add(OutlookIntakeEntry(filename, organization, sender, received, "The same file is already waiting for Sync."));return true; }
                    skipped.Add(OutlookHeldSkip(systemId, OutlookHoldConflict, "A different file with this name is already waiting for Sync. Run Sync first, then choose Retry.", filename, code, organization, sender, received, bytes, out held));return held;
                }
                AtomicWrite(destination, bytes);
            }
            saved.Add(OutlookIntakeEntry(filename, organization, sender, received, null));
            return true;
        }
        catch (Exception error)
        {
            Exception cause = error is TargetInvocationException && error.InnerException != null ? error.InnerException : error;
            skipped.Add(OutlookIntakeEntry(filename, organization, sender, received, "The attachment could not be saved: " + CleanLine(cause.Message, 200)));
            return false;
        }
        finally { try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { } }
    }

    private static Dictionary<string, object> OutlookIntakeEntry(string filename, string organization, string sender, string received, string reason)
    {
        var entry = new Dictionary<string, object> { { "filename", CleanLine(filename, 180) }, { "sender", sender ?? "" }, { "receivedUtc", received } };
        if (organization != null) entry["organization"] = organization;
        if (reason != null) entry["reason"] = reason;
        return entry;
    }
}

/// <summary>
/// Late-bound classic Outlook reader. It only reads mail and saves attachment
/// copies; it never moves, flags, deletes, or sends anything.
/// </summary>
internal sealed partial class TrackerContext
{
    private const BindingFlags OutlookMember = BindingFlags.Public | BindingFlags.Instance;

    private string ChooseOutlookIntakeFolder(string systemId)
    {
        return RunOutlookStaThread(delegate
        {
            object outlook = null, session = null, folder = null;
            try
            {
                outlook = OutlookApplication();session = OutlookCall(outlook, "GetNamespace", "MAPI");
                folder = OutlookCall(session, "PickFolder");
                if (folder == null) return "{\"cancelled\":true}";
                string name = Convert.ToString(OutlookGet(folder, "Name"));
                storage.SaveOutlookIntakeFolder(systemId, Convert.ToString(OutlookGet(folder, "StoreID")), Convert.ToString(OutlookGet(folder, "EntryID")), name, Convert.ToString(OutlookGet(folder, "FolderPath")));
                storage.AppendAudit(systemId, "OUTLOOK INTAKE FOLDER SELECTED: " + CleanError(name));
                return new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "cancelled", false }, { "folder", name } });
            }
            finally { ReleaseComObject(folder);ReleaseComObject(session);ReleaseComObject(outlook); }
        });
    }

    private string RunOutlookIntake(string systemId, byte[] requestBody)
    {
        Dictionary<string, object> request;
        try { request = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024, RecursionLimit = 10 }.DeserializeObject(Encoding.UTF8.GetString(requestBody ?? new byte[0])) as Dictionary<string, object>; }
        catch (Exception error) { throw new InvalidDataException("The Outlook intake request is not valid JSON.", error); }
        object[] senderValues = request != null && request.ContainsKey("senders") ? request["senders"] as object[] : null;
        if (senderValues == null || senderValues.Length > 20000) throw new InvalidDataException("The Outlook intake request must list at most 20,000 approved senders.");
        string[] senders = senderValues.Select(value => Convert.ToString(value)).ToArray();
        int days = request.ContainsKey("days") ? Convert.ToInt32(request["days"]) : 30;
        if (days < 1 || days > PortableStorage.OutlookIntakeMaximumDays) throw new InvalidDataException("Outlook intake can look back between 1 and " + PortableStorage.OutlookIntakeMaximumDays + " days.");
        string[] folderId = storage.ReadOutlookIntakeFolder(systemId);
        // No folder yet, or one Outlook can no longer find: the client asks the operator to choose it.
        if (folderId == null) return "{\"needsFolder\":true}";
        lock (outlookIntakeSystems) { if (!outlookIntakeSystems.Add(systemId)) throw new InvalidOperationException("Outlook is already being checked for this information system. Wait for that check to finish."); }
        string readingRoot = Path.Combine(storage.OutlookIntakeDirectory(systemId), "Reading", Guid.NewGuid().ToString("N"));
        var cancel = new CancellationTokenSource();
        try
        {
            // Phase 1, outside the storage queue: read Outlook and copy new attachments to this computer.
            string folderName = null;bool folderMissing = false;List<OutlookIntakeMessage> staged = null;
            RunOutlookStaThread(delegate
            {
                object outlook = null, session = null, folder = null, items = null;
                try
                {
                    outlook = OutlookApplication();session = OutlookCall(outlook, "GetNamespace", "MAPI");
                    try { folder = OutlookCall(session, "GetFolderFromID", folderId[1], folderId[0]); }
                    catch (Exception) { folder = OutlookFolderByPath(session, folderId[3]); }
                    if (folder == null) { folderMissing = true;return null; }
                    if (!String.Equals(Convert.ToString(OutlookGet(folder, "EntryID")), folderId[1], StringComparison.Ordinal)) storage.SaveOutlookIntakeFolder(systemId, Convert.ToString(OutlookGet(folder, "StoreID")), Convert.ToString(OutlookGet(folder, "EntryID")), folderId[2], folderId[3]);
                    items = OutlookGet(folder, "Items");OutlookCall(items, "Sort", "[ReceivedTime]", true);
                    folderName = Convert.ToString(OutlookGet(folder, "Name"));
                    staged = storage.StageOutlookIntakeMessages(systemId, OutlookMessages(items, DateTime.Now.AddDays(-days)), readingRoot, cancel.Token);
                    return null;
                }
                finally { ReleaseComObject(items);ReleaseComObject(folder);ReleaseComObject(session);ReleaseComObject(outlook); }
            }, cancel);
            // Phase 2, inside the storage queue: file the copies into organization intake.
            return WithStorageQueue(systemId, "outlook intake", delegate
            {
                if (!folderMissing) return storage.ProcessOutlookIntake(systemId, folderName, staged, senders);
                storage.AppendAudit(systemId, "OUTLOOK INTAKE FOLDER NOT FOUND: " + CleanError(folderId[2]) + "; operator asked to choose the folder again");
                return new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "needsFolder", true }, { "missing", CleanError(folderId[2]) } });
            });
        }
        finally
        {
            lock (outlookIntakeSystems) outlookIntakeSystems.Remove(systemId);
            try { if (Directory.Exists(readingRoot)) Directory.Delete(readingRoot, true); } catch (Exception) { }
        }
    }

    private readonly HashSet<string> outlookIntakeSystems = new HashSet<string>(StringComparer.Ordinal);

    // Takes this system's storage queue, as the request router does for serialized actions, for one step of a longer action.
    private string WithStorageQueue(string systemId, string operation, Func<string> work)
    {
        SemaphoreSlim queue = StorageQueue(systemId);
        if (!queue.Wait(TimeSpan.FromMinutes(2)))
        {
            string active = ActiveStorageOperation(systemId);
            throw new InvalidOperationException("This information system is busy completing " + (String.IsNullOrWhiteSpace(active) ? "another verified operation" : active) + " after waiting 120 seconds. Check Outlook again when it finishes; nothing was copied.");
        }
        SetActiveStorageOperation(systemId, operation);
        try { return work(); }
        finally { ClearActiveStorageOperation(systemId);queue.Release(); }
    }

    // Walks session.Folders by the saved FolderPath; null when any part is missing.
    internal static object OutlookFolderByPath(object session, string path)
    {
        string[] parts = (path ?? "").Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return null;
        object folder = null;
        try
        {
            foreach (string part in parts)
            {
                object folders = OutlookGet(folder ?? session, "Folders"), next;
                try { next = OutlookCall(folders, "Item", part); } finally { ReleaseComObject(folders); }
                ReleaseComObject(folder);folder = next;
            }
            return folder;
        }
        catch (Exception) { ReleaseComObject(folder);return null; }
    }

    internal const string OutlookDialogOpenMessage = "Outlook has a window open that is waiting for your answer, such as a prompt asking whether to allow access, a reminder, or a sign-in box. Switch to Outlook, answer or close that window, and then try again.";

    // Outlook refuses automation while one of its own dialogs waits for an answer
    // ("Outlook can't do this because a dialog box is open").
    internal static bool OutlookDialogOpen(Exception error)
    {
        for (Exception cause = error; cause != null; cause = cause.InnerException)
            if (cause is COMException && cause.Message.IndexOf("dialog box is open", StringComparison.OrdinalIgnoreCase) >= 0) return true;
        return false;
    }

    // Retries a call for up to about ten seconds while an Outlook dialog is open, so a
    // prompt the operator is already answering does not fail the draft.
    internal static object OutlookWhenNoDialog(Func<object> call, int attempts = 5, int waitMilliseconds = 2000)
    {
        for (int attempt = 1; ; attempt++)
        {
            try { return call(); }
            catch (Exception error) { if (attempt >= attempts || !OutlookDialogOpen(error)) throw;Thread.Sleep(waitMilliseconds); }
        }
    }

    // On timeout, signals cancel so abandoned reading stops at the next message instead of running on unseen.
    private static string RunOutlookStaThread(Func<string> work, CancellationTokenSource cancel = null)
    {
        string result = null;Exception failure = null;
        var thread = new Thread(delegate () { try { result = work(); } catch (Exception error) { failure = error; } });
        thread.IsBackground = true;thread.Name = "R.A.P.T.O.R. Outlook Intake";thread.SetApartmentState(ApartmentState.STA);thread.Start();
        if (!thread.Join(TimeSpan.FromMinutes(20)))
        {
            if (cancel != null) cancel.Cancel();
            throw new TimeoutException("Outlook did not finish within 20 minutes, so the check was stopped and nothing was copied. If Outlook asked whether to allow access, choose Allow, then try again.");
        }
        while (failure is TargetInvocationException && failure.InnerException != null) failure = failure.InnerException;
        if (OutlookDialogOpen(failure)) throw new InvalidOperationException(OutlookDialogOpenMessage, failure);
        if (failure is COMException) throw new InvalidOperationException("Microsoft Outlook refused the request: " + CleanError(failure.Message) + " Outlook security settings may be blocking programmatic access.", failure);
        if (failure != null) throw failure;
        return result;
    }

    private static object OutlookApplication()
    {
        Type outlookType = Type.GetTypeFromProgID("Outlook.Application");
        if (outlookType == null) throw new InvalidOperationException("Classic Microsoft Outlook for Windows is not installed. Outlook intake needs the classic desktop app; the new Outlook app cannot be read by other programs.");
        return Activator.CreateInstance(outlookType);
    }

    private static object OutlookCall(object target, string name, params object[] arguments) { return target.GetType().InvokeMember(name, BindingFlags.InvokeMethod | OutlookMember, null, target, arguments); }
    private static object OutlookGet(object target, string name) { return target.GetType().InvokeMember(name, BindingFlags.GetProperty | OutlookMember, null, target, null); }

    private static IEnumerable<OutlookIntakeMessage> OutlookMessages(object items, DateTime cutoffLocal)
    {
        object item = OutlookCall(items, "GetFirst");int read = 0;
        try
        {
            while (item != null && read < PortableStorage.OutlookIntakeMaximumMessages)
            {
                DateTime received;
                if (OutlookMailReceived(item, out received))
                {
                    if (received < cutoffLocal) yield break;
                    read++;
                    var attachments = new List<object>();
                    try { yield return OutlookMessage(item, received, attachments); }
                    finally { foreach (object attachment in attachments) ReleaseComObject(attachment); }
                }
                object next = OutlookCall(items, "GetNext");ReleaseComObject(item);item = next;
            }
        }
        finally { ReleaseComObject(item); }
    }

    private static bool OutlookMailReceived(object item, out DateTime received)
    {
        received = DateTime.MinValue;
        try
        {
            if (Convert.ToInt32(OutlookGet(item, "Class")) != 43) return false; // olMail
            received = Convert.ToDateTime(OutlookGet(item, "ReceivedTime"));
            return true;
        }
        catch (Exception) { return false; }
    }

    private static OutlookIntakeMessage OutlookMessage(object item, DateTime received, List<object> attachmentObjects)
    {
        var message = new OutlookIntakeMessage { ReceivedUtc = received.ToUniversalTime(), MessageId = OutlookMessageId(item), Sender = OutlookSender(item) };
        object attachments = null;
        try
        {
            attachments = OutlookGet(item, "Attachments");
            int count = Math.Min(Convert.ToInt32(OutlookGet(attachments, "Count")), PortableStorage.OutlookIntakeMaximumAttachments);
            for (int index = 1; index <= count; index++)
            {
                object attachment = OutlookCall(attachments, "Item", index);attachmentObjects.Add(attachment);
                if (Convert.ToInt32(OutlookGet(attachment, "Type")) != 1) continue; // olByValue
                object source = attachment;
                message.Attachments.Add(new OutlookIntakeAttachment { Filename = Convert.ToString(OutlookGet(attachment, "FileName")), SaveAs = path => OutlookCall(source, "SaveAsFile", path) });
            }
        }
        finally { ReleaseComObject(attachments); }
        return message;
    }

    private static string OutlookMessageId(object item)
    {
        object accessor = null;
        try { accessor = OutlookGet(item, "PropertyAccessor");string id = Convert.ToString(OutlookCall(accessor, "GetProperty", "http://schemas.microsoft.com/mapi/proptag/0x1035001F"));if (!String.IsNullOrWhiteSpace(id)) return id; }
        catch (Exception) { }
        finally { ReleaseComObject(accessor); }
        try { return Convert.ToString(OutlookGet(item, "EntryID")); }
        catch (Exception) { return null; }
    }

    private static string OutlookSender(object item)
    {
        object sender = null, exchangeUser = null;
        try
        {
            if (String.Equals(Convert.ToString(OutlookGet(item, "SenderEmailType")), "EX", StringComparison.OrdinalIgnoreCase))
            {
                sender = OutlookGet(item, "Sender");exchangeUser = sender == null ? null : OutlookCall(sender, "GetExchangeUser");
                if (exchangeUser != null) return Convert.ToString(OutlookGet(exchangeUser, "PrimarySmtpAddress"));
            }
            return Convert.ToString(OutlookGet(item, "SenderEmailAddress"));
        }
        catch (Exception) { return ""; }
        finally { ReleaseComObject(exchangeUser);ReleaseComObject(sender); }
    }
}
