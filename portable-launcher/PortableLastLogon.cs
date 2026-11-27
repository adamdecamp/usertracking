using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

internal sealed partial class PortableStorage
{
    private const int StartupAuditFullVerificationDays = 7;

    // Startup reuses this Windows user's protected checkpoint when every audit filename, length, and
    // modification time still matches it and a complete chain verification ran within the last week.
    // Otherwise, and for another Windows user or computer, startup verifies the whole chain. Explicit
    // verification, restoration, and audit viewing always verify the whole chain.
    private AuditState VerifyAuditChainForStartup(string directory)
    {
        AuditState cached = ReadAuditCheckpoint(directory);DateTimeOffset fullyVerified, now = DateTimeOffset.UtcNow;
        bool recent = cached != null && cached.FullVerifiedAtUtc != null && DateTimeOffset.TryParse(cached.FullVerifiedAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out fullyVerified) && fullyVerified <= now.AddMinutes(5) && now - fullyVerified < TimeSpan.FromDays(StartupAuditFullVerificationDays);
        if (recent) { cached.Incremental = true;return cached; }
        AuditState full = VerifyAuditChainWithRetry(directory);
        if (cached == null || cached.Entries != full.Entries || !String.Equals(cached.HeadHash, full.HeadHash, StringComparison.OrdinalIgnoreCase)) return full;
        // The checkpoint covers exactly the chain just verified, so record the full verification on it. The
        // audit lock and a second checkpoint read make sure no entry was appended in between.
        try
        {
            using (AcquireAuditFileLock(directory))
            {
                AuditState locked = ReadAuditCheckpoint(directory);
                if (locked != null && locked.Entries == full.Entries && String.Equals(locked.HeadHash, full.HeadHash, StringComparison.OrdinalIgnoreCase)) { locked.Incremental = true;locked.FullVerifiedAtUtc = now.ToString("o", CultureInfo.InvariantCulture);SaveAuditCheckpoint(directory, locked); }
            }
        }
        catch (IOException) { }
        return full;
    }

    public string ReadLastLogon(string systemId)
    {
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "Audit Logs");
            AuditState state = VerifyAuditChainIncrementalWithRetry(directory);
            EnsureAuditAnchor(directory, state);SaveAuditCheckpoint(directory, state);
            return json.Serialize(LastLogonResult(state));
        }
    }

    private static string EmptyToNull(string value) { return String.IsNullOrWhiteSpace(value) ? null : value; }

    private static bool IsLogonAction(string action)
    {
        return action.StartsWith("READ-ONLY SESSION START", StringComparison.OrdinalIgnoreCase)
            || action.StartsWith("FULL ACCESS SESSION START", StringComparison.OrdinalIgnoreCase)
            || action.StartsWith("MAP SYSTEM FOLDER", StringComparison.OrdinalIgnoreCase);
    }

    private static void TrackLogonActivity(AuditState state, string entryActor, string timestamp, string action)
    {
        if (IsLogonAction(action))
        {
            state.LastLogonActor = CleanLine(entryActor, 500);
            state.LastLogonTimestamp = timestamp;
            state.LastLogonAccessMode = action.StartsWith("READ-ONLY", StringComparison.OrdinalIgnoreCase) ? "Read-Only" : "Full Access";
            state.LastLogonActionCount = state.LastLogonSyncActions = state.LastLogonUserChanges = state.LastLogonEvidenceActions = state.LastLogonReportActions = state.LastLogonAdministrativeActions = 0;
            return;
        }
        if (String.IsNullOrWhiteSpace(state.LastLogonActor) || !String.Equals(state.LastLogonActor, CleanLine(entryActor, 500), StringComparison.OrdinalIgnoreCase) || action.IndexOf("SESSION END", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("APPLICATION SHUTDOWN", StringComparison.OrdinalIgnoreCase) >= 0) return;
        state.LastLogonActionCount++;
        if (action.IndexOf("SYNC", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("CLEAN UP", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("RECONCILIATION", StringComparison.OrdinalIgnoreCase) >= 0) state.LastLogonSyncActions++;
        else if (action.IndexOf("USER", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("PRIVILEGE", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("ACCOUNT", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("DISABLE", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("REENABLE", StringComparison.OrdinalIgnoreCase) >= 0) state.LastLogonUserChanges++;
        else if (action.IndexOf("EVIDENCE", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("ARCHIVE", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("REWORK", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("COMPRESS", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("ORGANIZE", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("NORMALIZE", StringComparison.OrdinalIgnoreCase) >= 0) state.LastLogonEvidenceActions++;
        else if (action.IndexOf("REPORT", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("SNAPSHOT", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("EXPORT", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("OUTLOOK", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("DRAFT", StringComparison.OrdinalIgnoreCase) >= 0 || action.IndexOf("NOTIFICATION", StringComparison.OrdinalIgnoreCase) >= 0) state.LastLogonReportActions++;
        else state.LastLogonAdministrativeActions++;
    }

    private static Dictionary<string, object> LastLogonResult(AuditState state)
    {
        bool available = !String.IsNullOrWhiteSpace(state.LastLogonActor) && !String.IsNullOrWhiteSpace(state.LastLogonTimestamp);
        return new Dictionary<string, object> { { "available", available }, { "actor", state.LastLogonActor ?? "" }, { "timestampUtc", state.LastLogonTimestamp ?? "" }, { "accessMode", state.LastLogonAccessMode ?? "" }, { "actionCount", state.LastLogonActionCount }, { "syncActions", state.LastLogonSyncActions }, { "userChanges", state.LastLogonUserChanges }, { "evidenceActions", state.LastLogonEvidenceActions }, { "reportActions", state.LastLogonReportActions }, { "administrativeActions", state.LastLogonAdministrativeActions } };
    }
}
