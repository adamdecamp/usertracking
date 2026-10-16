using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal sealed partial class PortableStorage : IDisposable
{
    private const int SnapshotLimit = 30;
    private const long ManifestLimit = 50L * 1024 * 1024;
    private const long SyncIndexLimit = 50L * 1024 * 1024;
    private const long EvidenceLimit = 110L * 1024 * 1024;
    private const long AuditFileLimit = 100L * 1024 * 1024;
    private const long RenamerQueueLimit = 20L * 1024 * 1024;
    private const long JournalLimit = 100L * 1024 * 1024;
    private const long ErrorReportFileLimit = 100L * 1024 * 1024;
    private const int AuditVersion = 1;
    private const int SyncIndexVersion = 2;
    private const int SyncJournalVersion = 1;
    private const int ManifestCacheVersion = 3;
    private const int ManifestCacheFreshMinutes = 10;
    private const int AuditCheckpointVersion = 2;
    private const int AuditAnchorVersion = 1;
    private const int BackupCoalesceSeconds = 30;
    private const int SyncJournalBatchEntryLimit = 64;
    private const int SyncJournalBatchByteLimit = 64 * 1024;
    private const int StorageTransactionVersion = 1;
    private const int MappingCacheVersion = 2;
    private const int NetworkReadAttempts = 6;
    private const int NetworkWriteAttempts = 7;
    private const string SystemDirectoryName = "System";
    private const string TemplateDirectoryName = "Template";
    private const string ErrorReportsDirectoryName = "Error Reports";
    internal const string UserAgreementTemplateFilename = "Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf";
    internal const string QualificationMemoTemplatePattern = "8140_Qualification_Memo DDMMMYYYY.pdf";
    private const string ManifestFilename = "information-system-user-tracker.json";
    private const string ManifestChecksumFilename = ManifestFilename + ".sha256";
    private const string ManifestStorageFormat = "organization-sharded-v1";
    private const int ManifestShardVersion = 1;
    private const string ManifestShardDirectoryName = "Database Shards";
    private const string LocalManifestCacheFilename = "verified-manifest.cache";
    private const string LocalWorkspaceManifestFilename = "information-system-user-tracker.local.json";
    private const string LocalWorkspaceStateFilename = "workspace-state.json";
    private const string LocalWorkspaceEvidenceFilename = "workspace-evidence.json";
    private const string LocalWorkspaceEvidenceRecoveryMarkerFilename = "workspace-evidence-map.v2";
    private const string PendingUploadDirectoryName = "Pending Upload";
    private const string PublishedEvidenceDirectoryName = "Published Evidence";
    private const string LegacyRetainedEvidenceDirectoryName = "Retained Evidence";
    private const int LocalWorkspaceVersion = 1;
    private const int LocalWorkspaceProtectionVersion = 1;
    private const string LocalWorkspacePublicationFilename = "workspace-publication.json";
    private const string LocalWorkspacePublicationProgressFilename = "workspace-publication-progress.jsonl";
    private const int LocalWorkspacePublicationVersion = 1;
    private static readonly string AbsentSharedManifestHash = Sha256("RAPTOR absent shared manifest v1");
    private const string LocalAuditCheckpointFilename = "verified-audit-head.cache";
    private const string LocalAuditSigningKeyFilename = "audit-signing-key.dpapi";
    private const string AuditAnchorFilename = "head-anchors.jsonl";
    private const string PublicationDirectoryName = "Publication Receipts";
    private const string PublicationIndexFilename = "published-evidence.json";
    private const int PublicationIndexVersion = 1;
    private const string PublicationIndexStorageFormat = "organization-sharded-v1";
    private const string PublicationIndexShardDirectoryName = "Organization Shards";
    private const int PublicationIndexShardVersion = 1;
    private const string SyncIndexDirectoryName = "Sync Index";
    private static readonly string[] SupportDirectoryNames = new[] { "Audit Logs", "backup", "Archive Review", "Reports", "Sync Journals", "Storage Transactions", PublicationDirectoryName, ErrorReportsDirectoryName };
    private static readonly string[] ArtifactDirectoryNames = new[] { "SAAR", "User Agreement", "DoD Cyber Cert", "8140 Certification Memo", "Privileged User Training", "DTA Training" };
    private const string SyncIndexFilename = "tracker-sync-index.json";
    private const string SyncIndexChecksumFilename = "tracker-sync-index.json.sha256";
    private const string RetentionMarkerFilename = "retention-preflight-date.txt";
    private const string RenamerQueueFilename = "tracker-document-renamer-queue.json";
    private static readonly string[] OperationalRootFiles = new[] { ManifestFilename, ManifestChecksumFilename, SyncIndexFilename, SyncIndexChecksumFilename, RenamerQueueFilename, "tracker-active-session.json" };
    private static readonly string AuditGenesisHash = new string('0', 64);
    private readonly Dictionary<string, string> roots = new Dictionary<string, string>(StringComparer.Ordinal);
    private readonly Dictionary<string, string> cachedRoots = new Dictionary<string, string>(StringComparer.Ordinal);
    private readonly Dictionary<string, object> rootLocks = new Dictionary<string, object>(StringComparer.Ordinal);
    private readonly Dictionary<string, object> leaseLocks = new Dictionary<string, object>(StringComparer.Ordinal);
    private readonly Dictionary<string, HeldLease> heldLeases = new Dictionary<string, HeldLease>(StringComparer.Ordinal);
    private readonly Dictionary<string, PendingBackupState> pendingBackups = new Dictionary<string, PendingBackupState>(StringComparer.Ordinal);
    private readonly Dictionary<string, FileSystemWatcher> changeWatchers = new Dictionary<string, FileSystemWatcher>(StringComparer.Ordinal);
    private readonly Dictionary<string, ChangeHintState> changeHints = new Dictionary<string, ChangeHintState>(StringComparer.Ordinal);
    private readonly object mapGate = new object();
    private readonly object errorReportGate = new object();
    private readonly object backupGate = new object();
    private readonly object changeHintGate = new object();
    private readonly object localWorkspaceAclGate = new object();
    private readonly HashSet<string> hardenedLocalWorkspaces = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    private readonly Timer backupTimer;
    [ThreadStatic] private static JavaScriptSerializer threadJson;
    [ThreadStatic] private static Dictionary<string, DirectoryScanEntry[]> threadEnumerationSnapshot;
    [ThreadStatic] private static bool threadEnumerationSnapshotEnabled;
    [ThreadStatic] private static int threadEnumerationSnapshotHits;
    [ThreadStatic] private static int threadEnumerationSnapshotMisses;
    [ThreadStatic] private static string threadPriorityOrganization;
    private JavaScriptSerializer json { get { if (threadJson == null) threadJson = new JavaScriptSerializer { MaxJsonLength = 100 * 1024 * 1024, RecursionLimit = 256 };return threadJson; } }
    private readonly string actor;
    private readonly string mappingCachePath;
    private string lastSystemId;
    internal static bool ForceNativeEnumerationForTests { get; set; }
    internal static bool ForceShellEnumerationForTests { get; set; }
    internal static string FailAfterStageForTests { get; set; }
    internal static Func<string, uint?> ReparseTagOverrideForTests { get; set; }
    internal static byte[] AuditSigningKeyOverrideForTests { get; set; }
    internal static Action<string> DirectoryEnumerationForTests { get; set; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeFindData
    {
        public FileAttributes Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint Reserved0;
        public uint Reserved1;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string FileName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string AlternateFileName;
    }

    private static readonly IntPtr InvalidFindHandle = new IntPtr(-1);
    private const uint InvalidFileAttributes = 0xffffffff;
    private const uint ReparseTagNameSurrogate = 0x20000000;
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr FindFirstFileW(string fileName, out NativeFindData findData);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool FindNextFileW(IntPtr findHandle, out NativeFindData findData);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool FindClose(IntPtr findHandle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFileAttributesW(string fileName);

    static PortableStorage()
    {
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
    }

    private sealed class HeldLease
    {
        public string SessionId;
        public FileStream Stream;
        public DateTime LastRenewedUtc;
    }

    private sealed class AuditState
    {
        public long Entries;
        public int Files;
        public int LegacyFiles;
        public string HeadHash = AuditGenesisHash;
        public string FirstTimestamp;
        public string LastTimestamp;
        public DateTimeOffset? LastInstant;
        public readonly List<Dictionary<string, object>> Recent = new List<Dictionary<string, object>>();
        public bool Incremental;
        public string AnchorHash = AuditGenesisHash;
        public long AnchoredEntries;
    }

    private sealed class AuditAnchorState
    {
        public string Hash = AuditGenesisHash;
        public long Entries;
        public string HeadHash = AuditGenesisHash;
        public int Count;
        public readonly HashSet<string> Hashes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class PendingBackupState
    {
        public string SystemId;
        public Dictionary<string, object> Database;
        public byte[] CsvBytes;
        public DateTime QueuedUtc;
    }

    private sealed class ChangeHintState
    {
        public bool Baselined;
        public bool Overflowed;
        public readonly HashSet<string> Organizations = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        public DateTime LastEventUtc;
    }

    private sealed class SyncJournalState
    {
        public string Path;
        public string RunId;
        public string RuleSetVersion;
        public int ResumedFiles;
        public readonly Dictionary<string, Dictionary<string, object>> Completed = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class DirectoryScanEntry
    {
        public string Path;
        public bool IsDirectory;
        public bool IsReparsePoint;
        public bool HasAttributes;
        public bool HasMetadata;
        public long Size;
        public long LastModifiedUnixMs;
    }

    private sealed class PendingEvidenceValidation
    {
        public string File;
        public string Filename;
        public string Relative;
        public long Size;
        public long LastModifiedUnixMs;
        public bool HistoricalSaar;
        public bool ExternalSharedAddition;
    }

    private sealed class EvidenceValidationResult
    {
        public bool Accepted;
        public bool Cacheable = true;
        public bool EncryptedPdf;
        public string Error = "";
        public long StagedBytes;
        public long DurationMilliseconds;
    }

    private sealed class ManifestCacheRecord
    {
        public string Manifest;
        public string CachedAtUtc;
        public string VerifiedAtUtc;
        public string SharedSha256;
        public string ContentSha256;
        public long SharedLength;
        public long SharedModifiedUnixMs;
    }

    private sealed class LocalWorkspaceState
    {
        public string BaseSharedSha256;
        public bool Dirty;
        public string PulledAtUtc;
        public string SavedAtUtc;
    }

    private sealed class PublicationEvidence
    {
        public string Source;
        public string Destination;
        public string OriginalRelative;
        public string Relative;
        public string SourceSha256;
        public string Sha256;
        public string PdfSha256;
        public bool Reused;
    }

    private sealed class PublicationHashCache
    {
        private sealed class Entry
        {
            public long Length;
            public long ModifiedUtcTicks;
            public string ContainerHash;
            public string PdfHash;
        }

        private readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>(StringComparer.OrdinalIgnoreCase);

        private Entry Current(string path)
        {
            var info = new FileInfo(path);info.Refresh();
            if (!info.Exists) throw new FileNotFoundException("The evidence file no longer exists.", path);
            Entry entry;
            if (!entries.TryGetValue(path, out entry) || entry.Length != info.Length || entry.ModifiedUtcTicks != info.LastWriteTimeUtc.Ticks)
            {
                entry = new Entry { Length = info.Length, ModifiedUtcTicks = info.LastWriteTimeUtc.Ticks };
                entries[path] = entry;
            }
            return entry;
        }

        public string Container(string path)
        {
            Entry entry = Current(path);
            if (String.IsNullOrWhiteSpace(entry.ContainerHash)) entry.ContainerHash = TryFileHash(path);
            return entry.ContainerHash;
        }

        public string Pdf(string path)
        {
            Entry entry = Current(path);
            if (String.IsNullOrWhiteSpace(entry.PdfHash)) entry.PdfHash = EvidencePdfSha256(path);
            return entry.PdfHash;
        }

        public void Invalidate(string path) { entries.Remove(path); }
    }

    private sealed class SyncJournalWriter : IDisposable
    {
        private readonly PortableStorage owner;
        private readonly string path;
        private readonly List<string> lines = new List<string>();
        private int byteCount;

        public SyncJournalWriter(PortableStorage value, string journalPath) { owner = value; path = journalPath; }

        public void Append(Dictionary<string, object> item)
        {
            string line = owner.json.Serialize(item) + Environment.NewLine;
            lines.Add(line);byteCount += Encoding.UTF8.GetByteCount(line);
            if (lines.Count >= SyncJournalBatchEntryLimit || byteCount >= SyncJournalBatchByteLimit) Flush();
        }

        public void Flush()
        {
            if (lines.Count == 0) return;
            owner.AppendSyncJournalLines(path, lines, byteCount);
            lines.Clear();byteCount = 0;
        }

        public void Dispose() { Flush(); }
    }

    public PortableStorage(string currentActor, string cachePath = null)
    {
        actor = CleanLine(currentActor, 500);
        // Keep the legacy cache directory so R.A.P.T.O.R. restores existing mappings without migration or remapping.
        mappingCachePath = String.IsNullOrWhiteSpace(cachePath) ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InformationSystemUserTracker", "folder-mappings.json") : Path.GetFullPath(cachePath);
        LoadMappingCache();
        backupTimer = new Timer(delegate { try { FlushDueBackups(false); } catch { } }, null, TimeSpan.FromSeconds(BackupCoalesceSeconds), TimeSpan.FromSeconds(BackupCoalesceSeconds));
    }

    public void Map(string systemId, string path)
    {
        ValidateSystemId(systemId);
        string full = NormalizeRootPath(path);
        if (!DirectoryExistsWithRetry(full)) throw new DirectoryNotFoundException("The selected system folder is unavailable after network-aware retries.");
        ProbeMappedFolder(full);
        MigrateSupportDirectories(full);
        Directory.CreateDirectory(Path.Combine(full, "Organizations"));
        Directory.CreateDirectory(Path.Combine(full, TemplateDirectoryName));
        EnsureOrganizationDocumentFolders(full, false);
        object gate, leaseGate;
        lock (mapGate)
        {
            if (!rootLocks.ContainsKey(systemId)) rootLocks[systemId] = new object();
            if (!leaseLocks.ContainsKey(systemId)) leaseLocks[systemId] = new object();
            gate = rootLocks[systemId];
            leaseGate = leaseLocks[systemId];
        }
        lock (leaseGate)
        lock (gate)
        {
            RecoverTransactions(full);
            HeldLease held = null;
            lock (mapGate)
            {
                string current;
                if (roots.TryGetValue(systemId, out current) && !String.Equals(current, full, StringComparison.OrdinalIgnoreCase) && heldLeases.TryGetValue(systemId, out held)) heldLeases.Remove(systemId);
                roots[systemId] = full;
                foreach (string duplicate in cachedRoots.Where(item => !String.Equals(item.Key, systemId, StringComparison.Ordinal) && String.Equals(item.Value, full, StringComparison.OrdinalIgnoreCase)).Select(item => item.Key).ToArray()) cachedRoots.Remove(duplicate);
                cachedRoots[systemId] = full;
                lastSystemId = systemId;
            }
            if (held != null) DisposeLease(held, true);
        }
        SaveMappingCache();
        PruneEvidenceValidationCache(full, false);
        StartChangeWatcher(systemId, full);
    }

    public bool MapForFullSession(string systemId, string path, string sessionId)
    {
        ValidateSystemId(systemId);ValidateSessionId(sessionId);
        string full = NormalizeRootPath(path);
        if (!DirectoryExistsWithRetry(full)) throw new DirectoryNotFoundException("The selected system folder is unavailable after network-aware retries.");
        string previousRoot = null;bool hadPreviousRoot;
        lock (mapGate)
        {
            hadPreviousRoot = roots.TryGetValue(systemId, out previousRoot);
            HeldLease existing;
            if (heldLeases.TryGetValue(systemId, out existing) && (!String.Equals(existing.SessionId, sessionId, StringComparison.Ordinal) || hadPreviousRoot && !String.Equals(previousRoot, full, StringComparison.OrdinalIgnoreCase))) return false;
            if (!rootLocks.ContainsKey(systemId)) rootLocks[systemId] = new object();
            if (!leaseLocks.ContainsKey(systemId)) leaseLocks[systemId] = new object();
            roots[systemId] = full;
        }
        if (!AcquireLease(systemId, sessionId))
        {
            lock (mapGate) { if (hadPreviousRoot) roots[systemId] = previousRoot;else roots.Remove(systemId); }
            return false;
        }
        try { Map(systemId, full);return true; }
        catch
        {
            ReleaseLease(systemId, sessionId);
            lock (mapGate) { if (hadPreviousRoot) roots[systemId] = previousRoot;else roots.Remove(systemId); }
            throw;
        }
    }

    public void MapReadOnly(string systemId, string path)
    {
        ValidateSystemId(systemId);
        string full = NormalizeRootPath(path);
        if (!DirectoryExistsWithRetry(full)) throw new DirectoryNotFoundException("The selected system folder is unavailable after network-aware retries.");
        string manifestPath = Path.Combine(full, SystemDirectoryName, ManifestFilename);
        if (!File.Exists(manifestPath)) throw new FileNotFoundException("The selected folder does not contain an initialized R.A.P.T.O.R. system database.");
        bool manifestCacheHit;string manifestText = ReadManifestOptimized(full, manifestPath, out manifestCacheHit);
        lock (mapGate)
        {
            roots[systemId] = full;
            if (!rootLocks.ContainsKey(systemId)) rootLocks[systemId] = new object();
            if (!leaseLocks.ContainsKey(systemId)) leaseLocks[systemId] = new object();
            foreach (string duplicate in cachedRoots.Where(item => !String.Equals(item.Key, systemId, StringComparison.Ordinal) && String.Equals(item.Value, full, StringComparison.OrdinalIgnoreCase)).Select(item => item.Key).ToArray()) cachedRoots.Remove(duplicate);
            cachedRoots[systemId] = full;
            lastSystemId = systemId;
        }
        // The mapping cache is local to this Windows profile. Read-Only mapping never creates,
        // migrates, repairs, or reorganizes anything inside the selected shared folder.
        SaveMappingCache();
        StartChangeWatcher(systemId, full);
    }

    public string CachedMappings(bool initializeSharedFolder = true, bool localOnly = false)
    {
        KeyValuePair<string, string>[] mappings;
        string selected;
        lock (mapGate) { mappings = cachedRoots.ToArray(); selected = lastSystemId; }
        var available = new List<Dictionary<string, object>>();
        foreach (KeyValuePair<string, string> mapping in mappings)
        {
            try
            {
                if (!localOnly && !Directory.Exists(mapping.Value)) continue;
                if (!localOnly && initializeSharedFolder)
                {
                    MigrateSupportDirectories(mapping.Value);
                    Directory.CreateDirectory(Path.Combine(mapping.Value, "Organizations"));
                    Directory.CreateDirectory(Path.Combine(mapping.Value, TemplateDirectoryName));
                }
                string cachedAtUtc = "", source = localOnly ? "local-cache" : "shared", manifest;
                if (localOnly) { manifest = ReadLocalManifestCache(mapping.Value, out cachedAtUtc);if (String.IsNullOrWhiteSpace(manifest)) continue; }
                else
                {
                    string manifestPath = Path.Combine(mapping.Value, SystemDirectoryName, ManifestFilename);
                    if (!File.Exists(manifestPath)) continue;
                    bool cacheHit;manifest = ReadManifestOptimized(mapping.Value, manifestPath, out cacheHit);if (cacheHit) source = "shared-cache";
                    cachedAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                }
                Dictionary<string, object> database = ValidateDatabase(manifest);
                object[] systems = ObjectArray(database["systems"]);
                if (systems.Length != 1) continue;
                string logicalSystemId = Convert.ToString(ObjectDictionary(systems[0])["id"], CultureInfo.InvariantCulture);
                ValidateSystemId(logicalSystemId);
                lock (mapGate)
                {
                    roots[mapping.Key] = mapping.Value;
                    if (!rootLocks.ContainsKey(mapping.Key)) rootLocks[mapping.Key] = new object();
                }
                available.Add(new Dictionary<string, object> { { "storageId", mapping.Key }, { "systemId", logicalSystemId }, { "folderName", new DirectoryInfo(mapping.Value).Name }, { "manifest", database }, { "stateHash", StateHash(database) }, { "source", source }, { "cachedAtUtc", cachedAtUtc } });
            }
            catch { }
        }
        available = available.GroupBy(item => Convert.ToString(item["systemId"]), StringComparer.Ordinal).Select(group => group.FirstOrDefault(item => String.Equals(Convert.ToString(item["storageId"]), selected, StringComparison.Ordinal)) ?? group.Last()).ToList();
        Dictionary<string, object> selectedMapping = available.FirstOrDefault(item => String.Equals(Convert.ToString(item["storageId"]), selected, StringComparison.Ordinal));
        selected = selectedMapping != null ? Convert.ToString(selectedMapping["systemId"]) : available.Count > 0 ? Convert.ToString(available[0]["systemId"]) : "";
        return json.Serialize(new Dictionary<string, object> { { "lastSystemId", selected ?? "" }, { "mappings", available } });
    }

    public string FolderName(string systemId) { return new DirectoryInfo(Root(systemId)).Name; }
    public string FolderPath(string systemId) { return Root(systemId); }

    public void ForgetMapping(string systemId)
    {
        ValidateSystemId(systemId);
        HeldLease held = null;
        lock (mapGate)
        {
            roots.Remove(systemId);
            cachedRoots.Remove(systemId);
            rootLocks.Remove(systemId);
            leaseLocks.Remove(systemId);
            if (heldLeases.TryGetValue(systemId, out held)) heldLeases.Remove(systemId);
            if (String.Equals(lastSystemId, systemId, StringComparison.Ordinal)) lastSystemId = cachedRoots.Keys.FirstOrDefault() ?? "";
        }
        if (held != null) DisposeLease(held, true);
        SaveMappingCache();
    }

    public string ResolveUserAgreementTemplate(string systemId)
    {
        string directory = Path.Combine(Root(systemId), TemplateDirectoryName);
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, UserAgreementTemplateFilename);
        string validationError;
        if (!TryValidateEvidenceFile(path, out validationError) || !path.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
        {
            if (validationError.IndexOf("missing", StringComparison.OrdinalIgnoreCase) >= 0) throw new FileNotFoundException("Place the User Agreement template at Template\\" + UserAgreementTemplateFilename + ". Other Template-folder files are ignored.");
            throw new InvalidDataException("The User Agreement template is not a readable PDF. Replace Template\\" + UserAgreementTemplateFilename + " before preparing the notification. " + validationError);
        }
        return path;
    }

    public string Resolve8140QualificationMemoTemplate(string systemId)
    {
        string directory = Path.Combine(Root(systemId), TemplateDirectoryName);
        Directory.CreateDirectory(directory);
        var matches = new List<KeyValuePair<DateTime, string>>();
        string placeholder = null;
        foreach (string path in EnumerateScanFiles(Root(systemId), directory).Where(path => path.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)))
        {
            string filename = Path.GetFileName(path);
            Match match = Regex.Match(filename, @"^8140[_ ]Qualification[_ ]Memo[ _-]+(\d{2}[A-Za-z]{3}\d{4})\.pdf$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            DateTime date;
            if (match.Success && DateTime.TryParseExact(match.Groups[1].Value, "ddMMMyyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out date)) matches.Add(new KeyValuePair<DateTime, string>(date, path));
            else if (Regex.IsMatch(filename, @"^8140[_ ]Qualification[_ ]Memo[ _-]+DDMMMYYYY\.pdf$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) placeholder = path;
        }
        string selected = matches.Count > 0 ? matches.OrderByDescending(item => item.Key).ThenByDescending(item => item.Value, StringComparer.OrdinalIgnoreCase).First().Value : placeholder;
        if (String.IsNullOrWhiteSpace(selected)) throw new FileNotFoundException("Place the 8140 Qualification Memo template in Template using " + QualificationMemoTemplatePattern + " (for example, 8140_Qualification_Memo 06OCT2026.pdf). Spaces, underscores, or a hyphen before the date are accepted. Other Template-folder files are ignored.");
        string validationError;
        if (!TryValidateEvidenceFile(selected, out validationError)) throw new InvalidDataException("The 8140 Qualification Memo template is not a readable PDF. Replace Template\\" + Path.GetFileName(selected) + " before preparing the notification. " + validationError);
        return selected;
    }

    public string StageOutlookTemplateAttachment(string systemId, string templateType)
    {
        string source;
        if (String.Equals(templateType, "8140-qualification-memo", StringComparison.Ordinal)) source = Resolve8140QualificationMemoTemplate(systemId);
        else if (String.Equals(templateType, "user-agreement", StringComparison.Ordinal)) source = ResolveUserAgreementTemplate(systemId);
        else throw new InvalidDataException("The requested Outlook template type is invalid.");
        byte[] bytes = ReadAllBytesWithRetry(source, EvidenceLimit);
        string directory = Path.Combine(Path.GetTempPath(), "RAPTOR", "Outlook Attachments", Guid.NewGuid().ToString("N")), destination = Path.Combine(directory, Path.GetFileName(source));
        try
        {
            Directory.CreateDirectory(directory);
            File.WriteAllBytes(destination, bytes);
            string validationError;
            if (!TryValidateEvidenceFile(destination, out validationError)) throw new InvalidDataException("The locally staged Outlook attachment did not pass PDF validation. " + validationError);
            if (!String.Equals(Sha256Bytes(bytes), Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The locally staged Outlook attachment failed its SHA-256 integrity check.");
            return destination;
        }
        catch
        {
            try { if (File.Exists(destination)) File.Delete(destination); } catch { }
            try { if (Directory.Exists(directory)) Directory.Delete(directory, false); } catch { }
            throw;
        }
    }

    public string ReadManifest(string systemId)
    {
        string root = Root(systemId), path = Path.Combine(root, SystemDirectoryName, ManifestFilename);
        if (!File.Exists(path)) return null;
        bool cacheHit;return ReadManifestOptimized(root, path, out cacheHit);
    }

    public string ReadWorkingManifest(string systemId)
    {
        lock (RootLock(systemId))
        {
            string workspace = LocalWorkspaceRoot(systemId);
            if (File.Exists(LocalWorkspaceManifestPath(workspace))) return json.Serialize(ReadLocalWorkspaceDatabase(workspace));
            string cachedAtUtc;
            return ReadLocalManifestCache(Root(systemId), out cachedAtUtc);
        }
    }

    private string ReadManifestOptimized(string root, string path, out bool cacheHit)
    {
        cacheHit = false;
        string expectedHash = ReadManifestChecksumHash(path, true);
        ManifestCacheRecord cached = ReadLocalManifestCacheRecord(root);
        if (cached != null && IsSha256(expectedHash) && String.Equals(cached.SharedSha256, expectedHash, StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var info = new FileInfo(path);info.Refresh();DateTime verifiedUtc;
                if (info.Exists && info.Length == cached.SharedLength && new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds() == cached.SharedModifiedUnixMs && DateTime.TryParse(cached.VerifiedAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out verifiedUtc) && DateTime.UtcNow - verifiedUtc.ToUniversalTime() <= TimeSpan.FromMinutes(ManifestCacheFreshMinutes)) { cacheHit = true;return cached.Manifest; }
            }
            catch { }
        }
        byte[] bytes = ReadAllBytesWithRetry(path, ManifestLimit);string actualHash = Sha256Bytes(bytes);
        if (IsSha256(expectedHash) && !String.Equals(expectedHash, actualHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The live database failed its SHA-256 integrity check. Full Access is blocked until an operator restores a verified backup.");
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes).TrimStart('\uFEFF'); }
        catch (DecoderFallbackException) { throw new InvalidDataException("The live database is not valid UTF-8 text."); }
        Dictionary<string, object> logicalDatabase = ReadDatabaseManifest(root, text);
        string logical = json.Serialize(logicalDatabase);
        SaveLocalManifestCache(root, logical, actualHash);return logical;
    }

    private Dictionary<string, object> ReadDatabaseManifest(string root, string text)
    {
        Dictionary<string, object> stored;
        try { stored = ObjectDictionary(json.DeserializeObject(text)); }
        catch (Exception) { throw new InvalidDataException("The database manifest is invalid JSON."); }
        string storageFormat = stored.ContainsKey("storageFormat") ? Convert.ToString(stored["storageFormat"], CultureInfo.InvariantCulture) : "";
        if (!String.Equals(storageFormat, ManifestStorageFormat, StringComparison.Ordinal)) return MigrateDatabaseObject(stored);
        if (!stored.ContainsKey("version") || Convert.ToInt32(stored["version"], CultureInfo.InvariantCulture) != 2 || !stored.ContainsKey("systems") || !stored.ContainsKey("userShards") || !stored.ContainsKey("stateHash") || !stored.ContainsKey("userCount")) throw new InvalidDataException("The sharded database catalog is invalid.");
        int expectedTotal = Convert.ToInt32(stored["userCount"], CultureInfo.InvariantCulture);if (expectedTotal < 0 || expectedTotal > 100000) throw new InvalidDataException("The sharded database catalog user count is invalid.");
        object[] shardReferences = ObjectArray(stored["userShards"]);if (shardReferences.Length > 1000) throw new InvalidDataException("The sharded database catalog exceeds its organization limit.");
        string systemDirectory = Path.Combine(root, SystemDirectoryName), shardRoot = Path.Combine(systemDirectory, ManifestShardDirectoryName), shardRootPrefix = Path.GetFullPath(shardRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var positionedUsers = new List<Tuple<int, object>>();var seenPositions = new HashSet<int>();
        foreach (object value in shardReferences)
        {
            Dictionary<string, object> reference = ObjectDictionary(value);
            if (!reference.ContainsKey("organization") || !reference.ContainsKey("file") || !reference.ContainsKey("sha256") || !reference.ContainsKey("records")) throw new InvalidDataException("A database organization-shard reference is invalid.");
            string organization = Convert.ToString(reference["organization"], CultureInfo.InvariantCulture), relative = Convert.ToString(reference["file"], CultureInfo.InvariantCulture), expectedHash = Convert.ToString(reference["sha256"], CultureInfo.InvariantCulture);
            int expectedRecords = Convert.ToInt32(reference["records"], CultureInfo.InvariantCulture);
            if (String.IsNullOrWhiteSpace(organization) || organization.Length > 200 || String.IsNullOrWhiteSpace(relative) || relative.Length > 500 || !IsSha256(expectedHash) || expectedRecords < 0 || expectedRecords > 100000) throw new InvalidDataException("A database organization-shard reference is invalid.");
            string path = Path.GetFullPath(Path.Combine(systemDirectory, relative.Replace('/', Path.DirectorySeparatorChar)));
            if (!path.StartsWith(shardRootPrefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) throw new InvalidDataException("A required database organization shard is missing or outside managed storage.");
            byte[] bytes = ReadAllBytesWithRetry(path, ManifestLimit);if (!String.Equals(Sha256Bytes(bytes), expectedHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A database organization shard failed its SHA-256 integrity check.");
            Dictionary<string, object> shard;
            try { shard = ObjectDictionary(json.DeserializeObject(new UTF8Encoding(false, true).GetString(bytes))); }
            catch (Exception) { throw new InvalidDataException("A database organization shard contains invalid JSON."); }
            if (!shard.ContainsKey("version") || !shard.ContainsKey("organization") || !shard.ContainsKey("users") || !shard.ContainsKey("positions") || Convert.ToInt32(shard["version"], CultureInfo.InvariantCulture) != ManifestShardVersion || !String.Equals(Convert.ToString(shard["organization"], CultureInfo.InvariantCulture), organization, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A database organization shard has an invalid envelope.");
            object[] shardUsers = ObjectArray(shard["users"]), positions = ObjectArray(shard["positions"]);if (shardUsers.Length != expectedRecords || positions.Length != expectedRecords) throw new InvalidDataException("A database organization shard record count does not match its catalog.");
            for (int index = 0; index < shardUsers.Length; index++)
            {
                int position = Convert.ToInt32(positions[index], CultureInfo.InvariantCulture);if (position < 0 || position >= expectedTotal || !seenPositions.Add(position)) throw new InvalidDataException("A database organization shard contains an invalid or duplicate record position.");
                Dictionary<string, object> user = ObjectDictionary(shardUsers[index]);string userOrganization = user.ContainsKey("organization") ? Convert.ToString(user["organization"], CultureInfo.InvariantCulture) : "";
                if (!String.Equals(ManifestOrganization(userOrganization), organization, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A user record is stored in the wrong organization shard.");
                positionedUsers.Add(Tuple.Create(position, (object)user));if (positionedUsers.Count > 100000) throw new InvalidDataException("The database manifest exceeds its user-record limit.");
            }
        }
        if (positionedUsers.Count != expectedTotal) throw new InvalidDataException("The sharded database catalog user count does not match its organization shards.");
        object[] users = positionedUsers.OrderBy(value => value.Item1).Select(value => value.Item2).ToArray();
        var logical = new Dictionary<string, object> { { "version", 2 }, { "updated", stored.ContainsKey("updated") ? stored["updated"] : "" }, { "systems", stored["systems"] }, { "users", users.ToArray() } };
        logical = MigrateDatabaseObject(logical);
        if (!String.Equals(Convert.ToString(stored["stateHash"], CultureInfo.InvariantCulture), StateHash(logical), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The sharded database catalog content hash does not match its records.");
        return logical;
    }

    private byte[] BuildShardedManifest(string root, Dictionary<string, object> database, string updated, out HashSet<string> activeShardFiles)
    {
        string systemDirectory = Path.Combine(root, SystemDirectoryName), shardDirectory = Path.Combine(systemDirectory, ManifestShardDirectoryName);activeShardFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Directory.CreateDirectory(shardDirectory);
        var references = new List<object>();
        object[] users = ObjectArray(database["users"]);IEnumerable<Tuple<int, object>> positionedUsers = users.Select((value, index) => Tuple.Create(index, value));
        foreach (IGrouping<string, Tuple<int, object>> group in positionedUsers.GroupBy(value => ManifestOrganization(Convert.ToString(ObjectDictionary(value.Item2).ContainsKey("organization") ? ObjectDictionary(value.Item2)["organization"] : "", CultureInfo.InvariantCulture)), StringComparer.OrdinalIgnoreCase).OrderBy(value => value.Key, StringComparer.OrdinalIgnoreCase))
        {
            object[] records = group.Select(value => value.Item2).ToArray(), positions = group.Select(value => (object)value.Item1).ToArray();
            var envelope = new Dictionary<string, object> { { "version", ManifestShardVersion }, { "organization", group.Key }, { "positions", positions }, { "users", records } };
            byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(envelope));if (bytes.LongLength > ManifestLimit) throw new InvalidDataException("A database organization shard exceeds the 50 MB safety limit.");
            string hash = Sha256Bytes(bytes), filename = "org-" + Sha256(group.Key.ToUpperInvariant()).Substring(0, 24) + "-" + hash.Substring(0, 24) + ".json", path = Path.Combine(shardDirectory, filename);activeShardFiles.Add(filename);
            if (File.Exists(path)) { if (!String.Equals(TryFileHash(path), hash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("An existing database organization shard failed its SHA-256 integrity check."); }
            else { AtomicWrite(path, bytes);if (!String.Equals(TryFileHash(path), hash, StringComparison.OrdinalIgnoreCase)) throw new IOException("A database organization shard failed post-write SHA-256 verification."); }
            references.Add(new Dictionary<string, object> { { "organization", group.Key }, { "file", ManifestShardDirectoryName + "/" + filename }, { "sha256", hash }, { "records", records.Length } });
        }
        var catalog = new Dictionary<string, object> { { "version", 2 }, { "updated", updated }, { "storageFormat", ManifestStorageFormat }, { "stateHash", StateHash(database) }, { "systems", database["systems"] }, { "userCount", users.Length }, { "userShards", references.ToArray() } };
        byte[] catalogBytes = Encoding.UTF8.GetBytes(json.Serialize(catalog));if (catalogBytes.LongLength > ManifestLimit) throw new InvalidDataException("The sharded database catalog exceeds the 50 MB safety limit.");
        return catalogBytes;
    }

    private static string ManifestOrganization(string value)
    {
        string clean = CleanLine(value, 200).Trim();return clean.Length == 0 ? "Unassigned" : clean;
    }

    private static void PruneManifestShardFiles(string root, HashSet<string> activeShardFiles)
    {
        try
        {
            string directory = Path.Combine(root, SystemDirectoryName, ManifestShardDirectoryName);if (!Directory.Exists(directory)) return;
            foreach (string stale in Directory.EnumerateFiles(directory, "org-*.json", SearchOption.TopDirectoryOnly).Where(path => !activeShardFiles.Contains(Path.GetFileName(path))).ToArray()) TryDelete(stale);
            foreach (string legacyDirectory in Directory.EnumerateDirectories(directory).ToArray()) try { Directory.Delete(legacyDirectory, true); } catch { }
        }
        catch { }
    }

    private static string ReadManifestChecksumHash(string manifestPath, bool allowMissing)
    {
        string checksumPath = manifestPath + ".sha256";
        if (!File.Exists(checksumPath)) { if (allowMissing) return null;throw new FileNotFoundException("The live database integrity checksum is missing."); }
        string checksum = ReadText(checksumPath, 1024).Trim();Match match = Regex.Match(checksum, "^([a-fA-F0-9]{64})\\s{2}" + Regex.Escape(ManifestFilename) + "$");
        if (!match.Success) throw new InvalidDataException("The live database integrity checksum file is invalid.");
        return match.Groups[1].Value.ToLowerInvariant();
    }

    private Dictionary<string, object> ReadManifestFullyVerified(string root, string manifestPath, bool allowMissingChecksum, out string catalogHash)
    {
        byte[] bytes = ReadAllBytesWithRetry(manifestPath, ManifestLimit);catalogHash = Sha256Bytes(bytes);string expectedHash = ReadManifestChecksumHash(manifestPath, allowMissingChecksum);
        if (IsSha256(expectedHash) && !String.Equals(expectedHash, catalogHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The live database failed its SHA-256 integrity check. Full Access is blocked until an operator restores a verified backup.");
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes).TrimStart('\uFEFF'); }
        catch (DecoderFallbackException) { throw new InvalidDataException("The live database is not valid UTF-8 text."); }
        return ReadDatabaseManifest(root, text);
    }

    public string SaveManifest(string systemId, string text)
    {
        Dictionary<string, object> database = ValidateDatabase(text);
        string requestedStateHash = StateHash(database), now = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        lock (RootLock(systemId))
        {
            string root = Root(systemId), manifest = SystemFile(root, ManifestFilename);
            RecoverTransactions(root);
            if (File.Exists(manifest))
            {
                try
                {
                    bool cacheHit;string existingText = ReadManifestOptimized(root, manifest, out cacheHit);Dictionary<string, object> existing = ValidateDatabase(existingText);
                    if (String.Equals(StateHash(existing), requestedStateHash, StringComparison.OrdinalIgnoreCase))
                    {
                        string existingSaved = existing.ContainsKey("updated") ? Convert.ToString(existing["updated"], CultureInfo.InvariantCulture) : now;
                        return json.Serialize(new Dictionary<string, object> { { "saved", existingSaved }, { "backup", existingSaved }, { "snapshotCreated", false }, { "unchanged", true }, { "stateHash", requestedStateHash }, { "cacheHit", cacheHit } });
                    }
                }
                catch (InvalidDataException) { throw; }
                catch { }
            }
            database["updated"] = now;string canonical = json.Serialize(database);
            HashSet<string> activeShardFiles;byte[] manifestBytes = BuildShardedManifest(root, database, now, out activeShardFiles);
            string destinationHash = Sha256Bytes(manifestBytes), transaction = BeginTransaction(root, "manifest-write", manifest, manifest, TryFileHash(manifest), destinationHash);
            try { AtomicWrite(manifest, manifestBytes);FailAfter("manifest-write-before-checksum");WriteManifestChecksum(manifest, destinationHash);SaveLocalManifestCache(root, canonical, destinationHash);FailAfter("manifest-write");CompleteTransaction(transaction);PruneManifestShardFiles(root,activeShardFiles); }
            catch { if (!String.Equals(TryFileHash(manifest), destinationHash, StringComparison.OrdinalIgnoreCase)) CompleteTransaction(transaction);throw; }
            string backupDirectory = SupportDirectory(root, "backup");
            QueueBackup(systemId, database, null);
            return json.Serialize(new Dictionary<string, object> { { "saved", now }, { "backup", LatestCreated(backupDirectory) ?? "" }, { "backupQueuedAt", now }, { "snapshotCreated", false }, { "backupPending", true }, { "unchanged", false }, { "stateHash", requestedStateHash }, { "manifestSha256", destinationHash } });
        }
    }

    public string SaveCsv(string systemId, byte[] bytes)
    {
        if (bytes.Length > ManifestLimit) throw new InvalidDataException("The CSV backup exceeds the 50 MB safety limit.");
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "backup");
            string path = Path.Combine(directory, "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".csv");
            if (!File.Exists(path) || !String.Equals(TryFileHash(path), Sha256Bytes(bytes), StringComparison.OrdinalIgnoreCase)) AtomicWrite(path, bytes);
            return DateTime.UtcNow.ToString("o");
        }
    }

    public string SaveSystemState(string systemId, byte[] bytes)
    {
        if (bytes == null || bytes.LongLength <= 0 || bytes.LongLength > ManifestLimit * 2) throw new InvalidDataException("The combined database commit is empty or exceeds the 100 MB safety limit.");
        Dictionary<string, object> envelope;
        try { envelope = ObjectDictionary(json.DeserializeObject(Encoding.UTF8.GetString(bytes))); }
        catch (Exception) { throw new InvalidDataException("The combined database commit is invalid JSON."); }
        if (!envelope.ContainsKey("database") || !envelope.ContainsKey("csv")) throw new InvalidDataException("The combined database commit is missing its database or CSV backup.");
        Dictionary<string, object> database = ObjectDictionary(envelope["database"]);ValidateDatabaseObject(database);
        lock (RootLock(systemId))
        {
            string workspaceRoot = LocalWorkspaceRoot(systemId);LocalWorkspaceState state = ReadLocalWorkspaceState(workspaceRoot);
            if (state == null)
            {
                string sharedManifest = SystemFile(Root(systemId), ManifestFilename);
                if (File.Exists(sharedManifest)) throw new InvalidDataException("The local workspace has not been initialized from the verified shared master database. Reopen the mapped system before saving changes.");
                WriteLocalWorkspaceState(workspaceRoot, new LocalWorkspaceState { BaseSharedSha256 = AbsentSharedManifestHash, Dirty = false, PulledAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture), SavedAtUtc = "" });
                state = ReadLocalWorkspaceState(workspaceRoot);
            }
            if (state == null || !IsSha256(state.BaseSharedSha256)) throw new InvalidDataException("The local workspace has not been initialized from a verified shared master database.");
            string stateHash = StateHash(database), existingHash = null;
            try { existingHash = StateHash(ReadLocalWorkspaceDatabase(workspaceRoot)); } catch { }
            string saved = WriteLocalWorkspaceDatabase(workspaceRoot, database, state.BaseSharedSha256, state.Dirty || !String.Equals(stateHash, existingHash, StringComparison.OrdinalIgnoreCase));
            return json.Serialize(new Dictionary<string, object> { { "saved", saved }, { "backup", state.PulledAtUtc ?? saved }, { "snapshotCreated", false }, { "backupPending", true }, { "unchanged", String.Equals(stateHash, existingHash, StringComparison.OrdinalIgnoreCase) }, { "stateHash", stateHash }, { "localWorkspace", true }, { "workspacePath", workspaceRoot }, { "sharedCommitPending", true } });
        }
    }

    private string SaveSharedSystemState(string systemId, byte[] bytes)
    {
        if (bytes == null || bytes.LongLength <= 0 || bytes.LongLength > ManifestLimit * 2) throw new InvalidDataException("The combined database commit is empty or exceeds the 100 MB safety limit.");
        Dictionary<string, object> envelope;
        try { envelope = ObjectDictionary(json.DeserializeObject(Encoding.UTF8.GetString(bytes))); }
        catch (Exception) { throw new InvalidDataException("The combined database commit is invalid JSON."); }
        if (!envelope.ContainsKey("database") || !envelope.ContainsKey("csv")) throw new InvalidDataException("The combined database commit is missing its database or CSV backup.");
        Dictionary<string, object> database = ObjectDictionary(envelope["database"]);
        string csv = Convert.ToString(envelope["csv"], CultureInfo.InvariantCulture) ?? "";
        byte[] csvBytes = Encoding.UTF8.GetBytes(csv);
        if (csvBytes.LongLength > ManifestLimit) throw new InvalidDataException("The CSV backup exceeds the 50 MB safety limit.");
        var timer = Stopwatch.StartNew();Dictionary<string, object> result = ObjectDictionary(json.DeserializeObject(SaveManifest(systemId, json.Serialize(database))));bool unchanged = result.ContainsKey("unchanged") && Convert.ToBoolean(result["unchanged"], CultureInfo.InvariantCulture);
        string csvPath = Path.Combine(SupportDirectory(Root(systemId), "backup"), "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".csv");bool csvUnchanged = unchanged && File.Exists(csvPath) && new FileInfo(csvPath).Length == csvBytes.LongLength;
        if (!csvUnchanged) QueueBackup(systemId, null, csvBytes);
        string queuedAt = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);result["csvSaved"] = csvUnchanged ? File.GetLastWriteTimeUtc(csvPath).ToString("o", CultureInfo.InvariantCulture) : queuedAt;result["csvUnchanged"] = csvUnchanged;result["backupPending"] = !unchanged || !csvUnchanged;result["backupQueuedAt"] = queuedAt;result["unchanged"] = unchanged && csvUnchanged;timer.Stop();result["commitDurationMs"] = timer.ElapsedMilliseconds;
        AppendPerformanceDiagnostic(Root(systemId), new Dictionary<string, object> { { "operation", "state-commit" }, { "durationMs", timer.ElapsedMilliseconds }, { "databaseUnchanged", unchanged }, { "csvUnchanged", csvUnchanged }, { "databaseBytes", Encoding.UTF8.GetByteCount(json.Serialize(database)) }, { "csvBytes", csvBytes.LongLength } });
        return json.Serialize(result);
    }

    public string LocalWorkspaceInfo(string systemId)
    {
        lock (RootLock(systemId))
        {
            string workspaceRoot = LocalWorkspaceRoot(systemId);RecoverTransactions(workspaceRoot);MigrateLegacyRetainedEvidence(systemId, workspaceRoot);string manifestPath = LocalWorkspaceManifestPath(workspaceRoot);LocalWorkspaceState state = ReadLocalWorkspaceState(workspaceRoot);
            return json.Serialize(new Dictionary<string, object> { { "path", workspaceRoot }, { "initialized", state != null && File.Exists(manifestPath) }, { "dirty", state != null && state.Dirty }, { "baseSharedSha256", state == null ? "" : state.BaseSharedSha256 }, { "savedAtUtc", state == null ? "" : state.SavedAtUtc } });
        }
    }

    public string LocalWorkspacePath(string systemId)
    {
        lock (RootLock(systemId)) { string path = LocalWorkspaceRoot(systemId);Directory.CreateDirectory(Path.Combine(path, "Organizations"));return path; }
    }

    public string PublishWorkspace(string systemId, byte[] bytes)
    {
        var totalTimer = Stopwatch.StartNew();
        if (bytes == null || bytes.LongLength <= 0 || bytes.LongLength > ManifestLimit * 2) throw new InvalidDataException("The combined database commit is empty or exceeds the 100 MB safety limit.");
        Dictionary<string, object> requestEnvelope;
        try { requestEnvelope = ObjectDictionary(json.DeserializeObject(Encoding.UTF8.GetString(bytes))); }
        catch (Exception) { throw new InvalidDataException("The combined database commit is invalid JSON."); }
        if (!requestEnvelope.ContainsKey("database") || !requestEnvelope.ContainsKey("csv")) throw new InvalidDataException("The combined database commit is missing its database or CSV backup.");
        Dictionary<string, object> requestedDatabase = ObjectDictionary(requestEnvelope["database"]);ValidateDatabaseObject(requestedDatabase);
        string initialWorkspaceRoot = LocalWorkspaceRoot(systemId);bool recoverUnindexedLocalEvidence = !File.Exists(SystemFile(initialWorkspaceRoot, LocalWorkspaceEvidenceRecoveryMarkerFilename));
        var hashCache = new PublicationHashCache();var preparationTimer = Stopwatch.StartNew();var preparationWarnings = new List<string>();var isolatedEvidenceFilenames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int compressedForPublication;Dictionary<string, string> renamedPdfs = PrepareLocalPublicationEvidence(systemId, requestedDatabase, hashCache, preparationWarnings, isolatedEvidenceFilenames, out compressedForPublication);preparationTimer.Stop();
        requestEnvelope["csv"] = PublicationCsvFilenames(Convert.ToString(requestEnvelope["csv"], CultureInfo.InvariantCulture) ?? "", renamedPdfs, isolatedEvidenceFilenames);
        bytes = Encoding.UTF8.GetBytes(json.Serialize(requestEnvelope));string requestedStateHash = StateHash(requestedDatabase);
        // Save locally before touching the share. A failed publication always remains
        // resumable from the protected local database and publication journal.
        SaveSystemState(systemId, bytes);
        lock (RootLock(systemId))
        {
            string sharedRoot = Root(systemId), workspaceRoot = LocalWorkspaceRoot(systemId), sharedManifest = SystemFile(sharedRoot, ManifestFilename);RecoverTransactions(workspaceRoot);MigrateLegacyRetainedEvidence(systemId, workspaceRoot);LocalWorkspaceState state = ReadLocalWorkspaceState(workspaceRoot);
            if (state == null) throw new InvalidDataException("The local workspace state is missing.");
            string currentSharedHash = File.Exists(sharedManifest) ? ReadManifestChecksumHash(sharedManifest, false) : AbsentSharedManifestHash;
            string localOrganizations = Path.Combine(workspaceRoot, "Organizations"), sharedOrganizations = Path.Combine(sharedRoot, "Organizations");Directory.CreateDirectory(sharedOrganizations);
            var staged = new List<PublicationEvidence>();var localEvidence = ReadLocalEvidenceMap(systemId);var mappedLocalSources = new HashSet<string>(localEvidence.Values.Select(item => Path.Combine(workspaceRoot, Convert.ToString(item["localPath"], CultureInfo.InvariantCulture).Replace('/', Path.DirectorySeparatorChar))), StringComparer.OrdinalIgnoreCase);int deferredLocalPdfs = 0;
            var associatedPaths = new HashSet<string>(ObjectArray(requestedDatabase["users"]).SelectMany(value => ObjectArray(ObjectDictionary(value)["artifacts"])).Select(value => ObjectDictionary(value)).Where(item => item.ContainsKey("path")).Select(item => Convert.ToString(item["path"], CultureInfo.InvariantCulture).Replace('\\', '/')), StringComparer.OrdinalIgnoreCase);
            foreach (Dictionary<string, object> item in localEvidence.Values.Where(item => Convert.ToBoolean(item["pending"], CultureInfo.InvariantCulture)))
            {
                string relative = Convert.ToString(item["destination"], CultureInfo.InvariantCulture), source = SafeRelativePath(workspaceRoot, Convert.ToString(item["localPath"], CultureInfo.InvariantCulture)), hash = Convert.ToString(item["sha256"], CultureInfo.InvariantCulture);
                if (!source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) { if (associatedPaths.Contains(relative)) throw new InvalidDataException("A locally associated evidence PDF must be compressed before publication: " + Path.GetFileName(source));deferredLocalPdfs++;continue; }
                if (!String.Equals(hashCache.Container(source), hash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A locally prepared evidence file changed before publication. The local session was preserved.");
                staged.Add(PreparePublicationDestination(sharedRoot, source, relative, hash, hashCache));
            }
            // The protected evidence map is authoritative during routine commits.
            // A full tree enumeration is retained only for one-time recovery of a
            // workspace created before that map existed.
            if (recoverUnindexedLocalEvidence && Directory.Exists(localOrganizations))
            {
                foreach (string localFile in Directory.EnumerateFiles(localOrganizations, "*", SearchOption.AllDirectories).ToArray())
                {
                    if (mappedLocalSources.Contains(localFile)) continue;
                    string relative = Relative(workspaceRoot, localFile).Replace(Path.DirectorySeparatorChar, '/');string[] segments = relative.Split('/');
                    if (segments.Any(segment => IsIncomingStorageDirectory(segment) || IsReworkStorageDirectory(segment) || segment.EndsWith(" Complete", StringComparison.OrdinalIgnoreCase) || String.Equals(segment, "Complete", StringComparison.OrdinalIgnoreCase))) continue;
                    if (!localFile.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && !localFile.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) continue;
                    if (localFile.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) { if (associatedPaths.Contains(relative)) throw new InvalidDataException("A locally associated evidence PDF must be compressed before publication: " + Path.GetFileName(localFile));deferredLocalPdfs++;continue; }
                    string sourceHash = hashCache.Container(localFile);
                    if (!IsSha256(sourceHash)) throw new IOException("A locally staged evidence file failed SHA-256 verification before publication.");
                    staged.Add(PreparePublicationDestination(sharedRoot, localFile, relative, sourceHash, hashCache));
                }
            }

            // Reconcile stale browser requests from the protected local receipt as
            // well as this publication's plan. Local and shared ZIP hashes may
            // differ even when their validated PDF payloads are identical.
            var reconciledNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var references = localEvidence.Values.Where(item => !Convert.ToBoolean(item["pending"], CultureInfo.InvariantCulture) && item.ContainsKey("publishedSha256")).Select(item => new PublicationEvidence { OriginalRelative = item.ContainsKey("publicationSourceDestination") ? Convert.ToString(item["publicationSourceDestination"], CultureInfo.InvariantCulture) : Convert.ToString(item["destination"], CultureInfo.InvariantCulture), Relative = Convert.ToString(item["destination"], CultureInfo.InvariantCulture), SourceSha256 = Convert.ToString(item["sha256"], CultureInfo.InvariantCulture), Sha256 = Convert.ToString(item["publishedSha256"], CultureInfo.InvariantCulture), PdfSha256 = Convert.ToString(item["pdfSha256"], CultureInfo.InvariantCulture) }).Concat(staged).ToArray();
            ReconcilePublicationReferences(requestedDatabase, references, reconciledNames);
            requestEnvelope["csv"] = PublicationCsvFilenames(Convert.ToString(requestEnvelope["csv"], CultureInfo.InvariantCulture) ?? "", reconciledNames, isolatedEvidenceFilenames);
            bytes = Encoding.UTF8.GetBytes(json.Serialize(requestEnvelope));requestedStateHash = StateHash(requestedDatabase);SaveSystemState(systemId, bytes);
            bool manifestAlreadyCommitted = false;
            if (!String.Equals(currentSharedHash, state.BaseSharedSha256, StringComparison.OrdinalIgnoreCase))
            {
                string currentSharedText = ReadManifest(systemId);Dictionary<string, object> currentSharedDatabase = currentSharedText == null ? null : ValidateDatabase(currentSharedText);
                manifestAlreadyCommitted = currentSharedDatabase != null && String.Equals(StateHash(currentSharedDatabase), requestedStateHash, StringComparison.OrdinalIgnoreCase);
                if (!manifestAlreadyCommitted) throw new InvalidDataException("The shared master database changed during this session. No local records were published. Reopen the system and reconcile the newer shared copy before retrying.");
            }
            WritePublicationJournal(workspaceRoot, "prepared", state.BaseSharedSha256, requestedStateHash, staged, 0);
            int copied = 0;long transferredBytes = 0L;var transferTimer = Stopwatch.StartNew();
            // Transfer and verify evidence first. The shared JSON remains the commit record.
            foreach (PublicationEvidence item in staged)
            {
                if (!File.Exists(item.Destination))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(item.Destination));
                    string temporary = Path.Combine(Path.GetDirectoryName(item.Destination), ".isut-" + Guid.NewGuid().ToString("N") + ".tmp.zip");
                    try
                    {
                        long copiedBytes;string streamedHash = StreamVerifiedEvidenceCopy(item.Source, temporary, out copiedBytes);
                        if (copiedBytes > EvidenceLimit) throw new InvalidDataException("A staged evidence file exceeds the publication size limit.");
                        if (!String.Equals(streamedHash, item.SourceSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A locally prepared evidence file changed before transfer. The local session was preserved.");
                        try { File.Move(temporary, item.Destination); } catch (IOException) { if (!File.Exists(item.Destination)) throw; }
                        transferredBytes += copiedBytes;hashCache.Invalidate(item.Destination);
                    }
                    finally { TryDelete(temporary); }
                }
                if (!String.Equals(hashCache.Container(item.Destination), item.Sha256, StringComparison.OrdinalIgnoreCase)) throw new IOException("A shared evidence copy failed post-transfer SHA-256 verification. The shared master database was not changed.");
                copied++;WritePublicationJournal(workspaceRoot, "evidence-copy", state.BaseSharedSha256, requestedStateHash, staged, copied);FailAfter("publication-evidence-copy");
            }
            transferTimer.Stop();

            RecordPublishedEvidence(sharedRoot, staged);
            WritePublicationJournal(workspaceRoot, "evidence-verified", state.BaseSharedSha256, requestedStateHash, staged, copied);
            string resultText = manifestAlreadyCommitted ? json.Serialize(new Dictionary<string, object> { { "saved", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "unchanged", true }, { "stateHash", requestedStateHash } }) : SaveSharedSystemState(systemId, bytes);
            string publishedHash = ReadManifestChecksumHash(sharedManifest, false), now = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);WritePublicationJournal(workspaceRoot, "manifest-committed", state.BaseSharedSha256, requestedStateHash, staged, copied);
            FailAfter("publication-manifest-committed");
            WriteLocalWorkspaceState(workspaceRoot, new LocalWorkspaceState { BaseSharedSha256 = publishedHash, Dirty = false, PulledAtUtc = now, SavedAtUtc = now });
            var completionErrors = new List<string>(preparationWarnings);int completedFiles = 0;
            foreach (PublicationEvidence item in staged)
            {
                try
                {
                    if (!File.Exists(item.Source)) continue;
                    string relative = Relative(workspaceRoot, item.Source);string[] parts = relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length < 3 || !String.Equals(parts[0], "Organizations", StringComparison.OrdinalIgnoreCase)) continue;
                    string organization = parts[1], completeRoot = Path.Combine(workspaceRoot, "Organizations", organization, SafePart(organization, 80) + " Complete"), completeDirectory = Path.Combine(completeRoot, PublishedEvidenceDirectoryName);Directory.CreateDirectory(completeDirectory);
                    string completed = String.Equals(Path.GetDirectoryName(Path.GetFullPath(item.Source)), Path.GetFullPath(completeDirectory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) ? item.Source : UniqueDestination(completeDirectory, Path.GetFileName(item.Source));
                    bool moved = !String.Equals(item.Source, completed, StringComparison.OrdinalIgnoreCase);if (moved) File.Move(item.Source, completed);
                    Dictionary<string, object> originalEntry, resolvedEntry;bool hadOriginal = localEvidence.TryGetValue(item.OriginalRelative, out originalEntry), hadResolved = localEvidence.TryGetValue(item.Relative, out resolvedEntry);
                    try { localEvidence.Remove(item.OriginalRelative);localEvidence[item.Relative] = new Dictionary<string, object> { { "destination", item.Relative }, { "localPath", Relative(workspaceRoot, completed).Replace(Path.DirectorySeparatorChar, '/') }, { "sha256", item.SourceSha256 }, { "publishedSha256", item.Sha256 }, { "pdfSha256", item.PdfSha256 }, { "publicationSourceDestination", item.OriginalRelative }, { "pending", false } };WriteLocalEvidenceMap(systemId, localEvidence); }
                    catch { localEvidence.Remove(item.Relative);if (hadResolved) localEvidence[item.Relative] = resolvedEntry;if (hadOriginal) localEvidence[item.OriginalRelative] = originalEntry;if (moved && File.Exists(completed) && !File.Exists(item.Source)) File.Move(completed, item.Source);throw; }completedFiles++;
                    string pendingDirectory = Path.Combine(completeRoot, PendingUploadDirectoryName);try { if (Directory.Exists(pendingDirectory) && !Directory.EnumerateFileSystemEntries(pendingDirectory).Any()) Directory.Delete(pendingDirectory); } catch { }
                }
                catch (Exception error) { completionErrors.Add(Path.GetFileName(item.Source) + ": " + CleanLine(error.Message, 240)); }
            }
            if (recoverUnindexedLocalEvidence) AtomicWrite(SystemFile(workspaceRoot, LocalWorkspaceEvidenceRecoveryMarkerFilename), Encoding.ASCII.GetBytes("2" + Environment.NewLine));
            DeletePublicationJournal(workspaceRoot);
            Dictionary<string, object> result = ObjectDictionary(json.DeserializeObject(resultText));result["localWorkspace"] = true;result["sharedPublished"] = true;result["publishedFiles"] = staged.Count;result["reusedFiles"] = staged.Count(item => item.Reused);result["archivedConflicts"] = staged.Count(item => !String.Equals(item.Relative, item.OriginalRelative, StringComparison.OrdinalIgnoreCase));result["deferredLocalPdfs"] = deferredLocalPdfs;result["compressedForPublication"] = compressedForPublication;result["manifest"] = requestedDatabase;result["completedFiles"] = completedFiles;result["completionErrors"] = completionErrors.ToArray();result["workspacePath"] = workspaceRoot;result["manifestSha256"] = publishedHash;
            totalTimer.Stop();long transferMilliseconds = Math.Max(1L, transferTimer.ElapsedMilliseconds), bytesPerSecond = transferredBytes == 0 ? 0 : (long)Math.Round(transferredBytes * 1000d / transferMilliseconds);
            AppendPerformanceDiagnostic(sharedRoot, new Dictionary<string, object> { { "operation", "workspace-publish" }, { "durationMs", totalTimer.ElapsedMilliseconds }, { "preparationMs", preparationTimer.ElapsedMilliseconds }, { "transferMs", transferTimer.ElapsedMilliseconds }, { "finalizationMs", Math.Max(0L, totalTimer.ElapsedMilliseconds - preparationTimer.ElapsedMilliseconds - transferTimer.ElapsedMilliseconds) }, { "filesPlanned", staged.Count }, { "filesCopied", copied }, { "bytesTransferred", transferredBytes }, { "bytesPerSecond", bytesPerSecond }, { "legacyTreeRecovery", recoverUnindexedLocalEvidence }, { "hashCacheEnabled", true } });
            return json.Serialize(result);
        }
    }

    private PublicationEvidence PreparePublicationDestination(string sharedRoot, string source, string relative, string sourceHash, PublicationHashCache hashCache)
    {
        string validationError;
        if (!TryValidateEvidenceFile(source, out validationError)) throw new InvalidDataException("A locally staged publication ZIP failed validation: " + validationError);
        var item = new PublicationEvidence { Source = source, OriginalRelative = relative, Relative = relative, Destination = SafeRelativePath(sharedRoot, relative), SourceSha256 = sourceHash, Sha256 = sourceHash, PdfSha256 = hashCache.Pdf(source) };
        string[] parts = relative.Replace('\\', '/').Split('/');
        bool archive = parts.Skip(2).Take(Math.Max(0, parts.Length - 3)).Any(part => String.Equals(part, "Archive", StringComparison.OrdinalIgnoreCase) || part.EndsWith(" Archive", StringComparison.OrdinalIgnoreCase));
        if (TryReusePublicationDestination(item, archive, hashCache)) return item;
        if (!archive) throw PublicationCollision(relative);
        string filename = Path.GetFileName(relative), extension = filename.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase) ? ".pdf.zip" : ".zip", stem = filename.Substring(0, filename.Length - extension.Length), directory = Path.GetDirectoryName(item.Destination);
        stem = Regex.Replace(stem, @"_CONFLICT_[A-F0-9]{8,64}(?:_[0-9]{1,3})?$", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        foreach (int hashLength in new[] { 8, 16, 32, 64 })
        {
            string conflict = FitFilenameForDirectory(directory, stem + "_CONFLICT_" + item.PdfSha256.Substring(0, hashLength).ToUpperInvariant() + extension, extension);
            item.Destination = SafeRelativePath(sharedRoot, Path.Combine(Path.GetDirectoryName(relative), conflict));item.Relative = Relative(sharedRoot, item.Destination).Replace(Path.DirectorySeparatorChar, '/');
            if (TryReusePublicationDestination(item, true, hashCache)) return item;
        }
        for (int index = 2; index <= 100; index++)
        {
            string conflict = FitFilenameForDirectory(directory, stem + "_CONFLICT_" + item.PdfSha256.ToUpperInvariant() + "_" + index.ToString(CultureInfo.InvariantCulture) + extension, extension);
            item.Destination = SafeRelativePath(sharedRoot, Path.Combine(Path.GetDirectoryName(relative), conflict));item.Relative = Relative(sharedRoot, item.Destination).Replace(Path.DirectorySeparatorChar, '/');
            if (TryReusePublicationDestination(item, true, hashCache)) return item;
        }
        throw new IOException("The Archive contains too many conflicting copies of " + Path.GetFileName(relative) + ". All copies were preserved for review.");
    }

    // Return false only for two valid ZIPs with genuinely different PDFs.
    // Invalid active evidence remains an explicit failure. Invalid Archive evidence
    // is preserved and receives a deterministic conflict destination so it cannot
    // block unrelated database publication.
    private bool TryReusePublicationDestination(PublicationEvidence item, bool archive, PublicationHashCache hashCache)
    {
        if (!File.Exists(item.Destination)) return true;
        string sharedHash = hashCache.Container(item.Destination), validationError;
        if (!IsSha256(sharedHash)) { if (archive) return false;throw new IOException("The existing shared evidence could not be verified at " + item.Relative + ". The local session was preserved."); }
        if (!String.Equals(sharedHash, item.SourceSha256, StringComparison.OrdinalIgnoreCase))
        {
            if (!TryValidateEvidenceFile(item.Destination, out validationError)) { if (archive) return false;throw PublicationCollision(item.Relative); }
            if (!String.Equals(hashCache.Pdf(item.Destination), item.PdfSha256, StringComparison.OrdinalIgnoreCase)) return false;
        }
        item.Sha256 = sharedHash;item.Reused = true;return true;
    }

    private static InvalidDataException PublicationCollision(string relative)
    {
        return new InvalidDataException("A different shared evidence file already exists at " + relative + ". The local session was preserved for collision review.");
    }

    private static void ReconcilePublicationReferences(Dictionary<string, object> database, PublicationEvidence[] evidence, Dictionary<string, string> renamed)
    {
        var byPath = new Dictionary<string, List<PublicationEvidence>>(StringComparer.OrdinalIgnoreCase);
        foreach (PublicationEvidence item in evidence)
        {
            foreach (string key in new[] { item.OriginalRelative, item.Relative }.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                List<PublicationEvidence> items;if (!byPath.TryGetValue(key, out items)) { items = new List<PublicationEvidence>();byPath[key] = items; }items.Add(item);
            }
        }
        foreach (object userValue in ObjectArray(database["users"]))
        {
            Dictionary<string, object> user = ObjectDictionary(userValue);
            foreach (object artifactValue in ObjectArray(user["artifacts"]))
            {
                Dictionary<string, object> artifact = ObjectDictionary(artifactValue);string filename = Convert.ToString(artifact["filename"], CultureInfo.InvariantCulture), path = artifact.ContainsKey("path") ? Convert.ToString(artifact["path"], CultureInfo.InvariantCulture).Replace('\\', '/') : "";
                if (String.IsNullOrWhiteSpace(path)) path = Path.Combine("Organizations", ValidOrganizationName(Convert.ToString(user["organization"], CultureInfo.InvariantCulture)), OrganizationArtifactStorageFolder(ArtifactStorageFolder(Convert.ToString(artifact["kind"], CultureInfo.InvariantCulture)), Convert.ToString(user["organization"], CultureInfo.InvariantCulture)), filename).Replace(Path.DirectorySeparatorChar, '/');
                List<PublicationEvidence> matches;if (!byPath.TryGetValue(path, out matches) && !(filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && byPath.TryGetValue(path + ".zip", out matches))) continue;
                string expected = artifact.ContainsKey("sha256") ? Convert.ToString(artifact["sha256"], CultureInfo.InvariantCulture) : "";
                PublicationEvidence match = matches.LastOrDefault(item => String.Equals(expected, item.SourceSha256, StringComparison.OrdinalIgnoreCase) || String.Equals(expected, item.Sha256, StringComparison.OrdinalIgnoreCase) || filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && String.Equals(expected, item.PdfSha256, StringComparison.OrdinalIgnoreCase) || !IsSha256(expected));
                if (match == null) { if (matches.Any(item => item.Source != null)) throw new InvalidDataException("A recorded local ZIP changed before publication: " + filename);continue; }
                string resolvedName = Path.GetFileName(match.Relative);artifact["filename"] = resolvedName;artifact["path"] = match.Relative;artifact["sha256"] = match.Sha256;if (!String.Equals(filename, resolvedName, StringComparison.Ordinal)) renamed[filename] = resolvedName;
            }
        }
    }

    public string ListBackups(string systemId, string logicalSystemId)
    {
        ValidateSystemId(logicalSystemId);
        string directory = SupportDirectory(Root(systemId), "backup");
        var output = new List<Dictionary<string, object>>();
        if (!Directory.Exists(directory)) return "[]";
        foreach (string path in SnapshotPaths(directory).Take(SnapshotLimit))
        {
            try
            {
                Dictionary<string, object> envelope = VerifySnapshot(path);
                Dictionary<string, object> database = ObjectDictionary(envelope["database"]);
                object[] systems = ObjectArray(database["systems"]), users = ObjectArray(database["users"]);
                Dictionary<string, object> system = systems.Length > 0 ? ObjectDictionary(systems[0]) : null;
                if (system == null || !String.Equals(Convert.ToString(system["id"]), logicalSystemId, StringComparison.Ordinal)) throw new InvalidDataException("The snapshot belongs to a different information system.");
                output.Add(new Dictionary<string, object> { { "filename", Path.GetFileName(path) }, { "created", Convert.ToString(envelope["created"]) }, { "systemName", Convert.ToString(system["name"]) }, { "userCount", users.Length }, { "valid", true } });
            }
            catch (Exception ex)
            {
                output.Add(new Dictionary<string, object> { { "filename", Path.GetFileName(path) }, { "valid", false }, { "error", CleanLine(ex.Message, 300) } });
            }
        }
        return json.Serialize(output);
    }

    public string Restore(string systemId, string logicalSystemId, string filename)
    {
        ValidateSystemId(logicalSystemId);
        string directory = SupportDirectory(Root(systemId), "backup"), path = SafeBackupPath(directory, filename);
        lock (RootLock(systemId))
        {
            Dictionary<string, object> envelope = VerifySnapshot(path), restored = ObjectDictionary(envelope["database"]);
            ValidateDatabaseObject(restored);
            object[] systems = ObjectArray(restored["systems"]);
            if (systems.Length != 1 || !String.Equals(Convert.ToString(ObjectDictionary(systems[0])["id"]), logicalSystemId, StringComparison.Ordinal)) throw new InvalidDataException("The backup does not match the selected information system.");
            string manifestPath = SystemFile(Root(systemId), ManifestFilename);
            if (File.Exists(manifestPath))
            {
                string catalogHash;Dictionary<string, object> current = ReadManifestFullyVerified(Root(systemId), manifestPath, true, out catalogHash);
                CreateSnapshot(directory, current, true);
            }
            string now = DateTime.UtcNow.ToString("o");
            restored["updated"] = now;
            string restoredText = json.Serialize(restored);
            HashSet<string> activeShardFiles;byte[] restoredBytes = BuildShardedManifest(Root(systemId), restored, now, out activeShardFiles);
            string destinationHash = Sha256Bytes(restoredBytes), transaction = BeginTransaction(Root(systemId), "manifest-write", manifestPath, manifestPath, TryFileHash(manifestPath), destinationHash);
            try { AtomicWrite(manifestPath, restoredBytes);FailAfter("manifest-write-before-checksum");WriteManifestChecksum(manifestPath, destinationHash);SaveLocalManifestCache(Root(systemId), restoredText, destinationHash);CompleteTransaction(transaction);PruneManifestShardFiles(Root(systemId),activeShardFiles); }
            catch { if (!String.Equals(TryFileHash(manifestPath), destinationHash, StringComparison.OrdinalIgnoreCase)) CompleteTransaction(transaction);throw; }
            CreateSnapshot(directory, restored, true);
            return restoredText;
        }
    }

    public string RestoreDrill(string systemId, string logicalSystemId, string filename)
    {
        ValidateSystemId(logicalSystemId);
        string directory = SupportDirectory(Root(systemId), "backup"), path = SafeBackupPath(directory, filename);
        lock (RootLock(systemId))
        {
            Dictionary<string, object> envelope = VerifySnapshot(path), database = ObjectDictionary(envelope["database"]);
            ValidateDatabaseObject(database);
            object[] systems = ObjectArray(database["systems"]), users = ObjectArray(database["users"]);
            if (systems.Length != 1 || !String.Equals(Convert.ToString(ObjectDictionary(systems[0])["id"]), logicalSystemId, StringComparison.Ordinal)) throw new InvalidDataException("The backup does not match the selected information system.");
            string roundTrip = json.Serialize(database);
            Dictionary<string, object> reconstructed = ValidateDatabase(roundTrip);
            if (!String.Equals(StateHash(reconstructed), Convert.ToString(envelope["contentHash"], CultureInfo.InvariantCulture), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The restore drill reconstructed records with an unexpected content hash.");
            Dictionary<string, object> system = ObjectDictionary(systems[0]);
            return json.Serialize(new Dictionary<string, object> { { "healthy", true }, { "filename", Path.GetFileName(path) }, { "created", Convert.ToString(envelope["created"], CultureInfo.InvariantCulture) }, { "systemName", Convert.ToString(system["name"], CultureInfo.InvariantCulture) }, { "userCount", users.Length }, { "contentHash", Convert.ToString(envelope["contentHash"], CultureInfo.InvariantCulture) }, { "testedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "nonDestructive", true } });
        }
    }

    public string VerifyLatest(string systemId, string logicalSystemId)
    {
        ValidateSystemId(logicalSystemId);
        string manifestPath = SystemFile(Root(systemId), ManifestFilename), directory = SupportDirectory(Root(systemId), "backup");
        if (!File.Exists(manifestPath)) throw new FileNotFoundException("The current database manifest is missing.");
        string fullyVerifiedCatalogHash;Dictionary<string, object> manifestDatabase = ReadManifestFullyVerified(Root(systemId), manifestPath, true, out fullyVerifiedCatalogHash);
        string latest = SnapshotPaths(directory).FirstOrDefault();
        if (latest == null) throw new FileNotFoundException("No backup snapshot is available.");
        Dictionary<string, object> envelope = VerifySnapshot(latest), database = ObjectDictionary(envelope["database"]);
        object[] systems = ObjectArray(database["systems"]);
        if (systems.Length != 1 || !String.Equals(Convert.ToString(ObjectDictionary(systems[0])["id"]), logicalSystemId, StringComparison.Ordinal)) throw new InvalidDataException("The latest backup belongs to a different information system.");
        AuditState audit = VerifyAuditChain(SupportDirectory(Root(systemId), "Audit Logs"));
        bool checksumInitialized = false;
        string manifestSha256;
        if (File.Exists(manifestPath + ".sha256")) manifestSha256 = VerifyManifestChecksum(manifestPath, false);
        else
        {
            if (!String.Equals(StateHash(manifestDatabase), StateHash(database), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The live database has no integrity checksum and does not match the newest verified backup. Full Access is blocked until an operator restores a verified backup.");
            manifestSha256 = fullyVerifiedCatalogHash;
            WriteManifestChecksum(manifestPath, manifestSha256);
            checksumInitialized = true;
        }
        // Reuse this fully verified database in the browser instead of forcing a second
        // catalog-and-shard read across a slow SMB/VPN connection. Full Access also uses
        // a checksum-protected local working database so routine edits do not touch SMB.
        SaveLocalManifestCache(Root(systemId), json.Serialize(manifestDatabase), manifestSha256);
        string workspaceRoot = LocalWorkspaceRoot(systemId);LocalWorkspaceState workspaceState = ReadLocalWorkspaceState(workspaceRoot);bool workspaceResumed = false;
        if (workspaceState != null && workspaceState.Dirty)
        {
            if (!String.Equals(workspaceState.BaseSharedSha256, manifestSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The shared master database changed after this computer created its local working copy. Publishing is blocked to prevent a stale overwrite. Finish or discard the earlier session before continuing.");
            manifestDatabase = ReadLocalWorkspaceDatabase(workspaceRoot);workspaceResumed = true;
        }
        else WriteLocalWorkspaceDatabase(workspaceRoot, manifestDatabase, manifestSha256, false);
        return json.Serialize(new Dictionary<string, object> { { "healthy", true }, { "saved", File.GetLastWriteTimeUtc(manifestPath).ToString("o") }, { "backup", Convert.ToString(envelope["created"]) }, { "filename", Path.GetFileName(latest) }, { "auditHealthy", true }, { "auditEntries", audit.Entries }, { "auditHeadHash", audit.HeadHash }, { "auditVerification", "full-chain" }, { "manifestSha256", manifestSha256 }, { "checksumInitialized", checksumInitialized }, { "manifest", manifestDatabase }, { "localWorkspace", true }, { "workspacePath", workspaceRoot }, { "workspaceResumed", workspaceResumed } });
    }

    public void FinalizeMappedBackups()
    {
        FlushDueBackups(true);
        string[] ids;
        lock (mapGate) ids = roots.Keys.ToArray();
        foreach (string id in ids)
        {
            lock (RootLock(id))
            {
                string root = Root(id), manifest = SystemFile(root, ManifestFilename);
                if (!File.Exists(manifest)) continue;
                VerifyManifestChecksum(manifest, true);
                string catalogHash;Dictionary<string, object> database = ReadManifestFullyVerified(root, manifest, true, out catalogHash);
                string backupDirectory = SupportDirectory(root, "backup");
                CreateSnapshot(backupDirectory, database, false);
            }
        }
    }

    public void FinalizePendingBackups()
    {
        // Shutdown only needs to force out state that changed during this session.
        // Re-reading and snapshotting every cached mapping turns a no-op exit into
        // multiple SMB/VPN round trips and was a major source of slow shutdowns.
        FlushDueBackups(true);
    }

    private void QueueBackup(string systemId, Dictionary<string, object> database, byte[] csvBytes)
    {
        lock (backupGate)
        {
            PendingBackupState pending;
            if (!pendingBackups.TryGetValue(systemId, out pending)) pending = new PendingBackupState { SystemId = systemId };
            if (database != null) pending.Database = database;
            if (csvBytes != null) pending.CsvBytes = csvBytes.ToArray();
            pending.QueuedUtc = DateTime.UtcNow;
            pendingBackups[systemId] = pending;
        }
    }

    private void FlushDueBackups(bool force)
    {
        PendingBackupState[] due;
        lock (backupGate) due = pendingBackups.Values.Where(item => force || DateTime.UtcNow - item.QueuedUtc >= TimeSpan.FromSeconds(BackupCoalesceSeconds)).ToArray();
        foreach (PendingBackupState pending in due)
        {
            try
            {
                lock (RootLock(pending.SystemId))
                {
                    string root = Root(pending.SystemId), manifest = SystemFile(root, ManifestFilename);
                    Dictionary<string, object> database = pending.Database;
                    if (database == null && File.Exists(manifest)) { bool cacheHit;database = ValidateDatabase(ReadManifestOptimized(root, manifest, out cacheHit)); }
                    if (database != null) CreateSnapshot(SupportDirectory(root, "backup"), database, false);
                    if (pending.CsvBytes != null) SaveCsv(pending.SystemId, pending.CsvBytes);
                }
                lock (backupGate)
                {
                    PendingBackupState current;
                    if (pendingBackups.TryGetValue(pending.SystemId, out current) && Object.ReferenceEquals(current, pending)) pendingBackups.Remove(pending.SystemId);
                }
            }
            catch (Exception)
            {
                if (force) throw;
            }
        }
    }

    public string Scan(string systemId) { return Scan(systemId, "legacy", false); }

    public string Scan(string systemId, string ruleSetVersion, bool fullRescan)
    {
        Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(ScanWithJournal(systemId, ruleSetVersion, fullRescan, null, true)));
        return json.Serialize(ObjectArray(envelope["items"]));
    }

    public string ScanWithJournal(string systemId, string ruleSetVersion, bool fullRescan) { return ScanWithJournal(systemId, ruleSetVersion, fullRescan, null, true); }

    public string ScanWithJournal(string systemId, string ruleSetVersion, bool fullRescan, string organization)
    {
        return ScanWithJournal(systemId, ruleSetVersion, fullRescan, organization, true);
    }

    public string ScanWithJournal(string systemId, string ruleSetVersion, bool fullRescan, string organization, bool legacyImport)
    {
        string cleanRuleSet = CleanLine(ruleSetVersion, 100);
        if (String.IsNullOrWhiteSpace(cleanRuleSet)) throw new InvalidDataException("The Sync rule-set version is missing.");
        lock (RootLock(systemId))
        {
            string sharedRoot = Root(systemId), root = SyncOperationRoot(systemId, fullRescan, legacyImport), cleanOrganization = String.IsNullOrWhiteSpace(organization) ? null : ValidOrganizationName(organization), scanRoot = OrganizationScopeRoot(root, cleanOrganization), journalRuleSet = cleanRuleSet + "|scope=" + (cleanOrganization ?? "system") + "|mode=" + (legacyImport ? "legacy" : "daily");bool dailyIncomingOnly = !legacyImport && !fullRescan, scanningSharedRoot = String.Equals(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(sharedRoot).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);Dictionary<string, Dictionary<string, object>> publishedEvidence = scanningSharedRoot ? LoadPublishedEvidence(sharedRoot, cleanOrganization) : null, localAliases = scanningSharedRoot ? null : LocalEvidenceAliases(systemId);
            RecoverTransactions(root);
            SyncJournalState journal = StartOrResumeSyncJournal(root, journalRuleSet, fullRescan);
            using (var journalWriter = new SyncJournalWriter(this, journal.Path))
            {
            FailAfter("scan-start");
            Dictionary<string, Dictionary<string, object>> allPrevious = LoadSyncIndex(root, cleanRuleSet, cleanOrganization), previous = fullRescan ? new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase) : allPrevious;
            var result = new List<Dictionary<string, object>>();
            var next = new List<Dictionary<string, object>>();
            var validations = new List<PendingEvidenceValidation>();
            int discoveredFiles = 0, unchangedFiles = 0;
            var enumerationTimer = Stopwatch.StartNew();
            if (cleanOrganization != null) foreach (KeyValuePair<string, Dictionary<string, object>> item in allPrevious) if (!PathInOrganizationScope(item.Key, cleanOrganization)) next.Add(IndexItem(item.Value));
            var pending = new Stack<Tuple<string, int, bool>>();
            pending.Push(Tuple.Create(scanRoot, 0, false));
            while (pending.Count > 0)
            {
                Tuple<string, int, bool> current = pending.Pop();
                if (current.Item2 > 25) throw new InvalidDataException("Folder nesting limit exceeded.");
                DirectoryScanEntry[] directoryEntries = EnumerateDirectoryEntries(root, current.Item1);
                foreach (DirectoryScanEntry directoryEntry in directoryEntries.Where(item => !item.IsDirectory))
                {
                    string file = directoryEntry.Path;
                    discoveredFiles++;
                    if (discoveredFiles >= 100000) throw new InvalidDataException("File scan limit exceeded.");
                    string filename = Path.GetFileName(file), relative = Relative(root, file).Replace(Path.DirectorySeparatorChar, '/');
                    if (dailyIncomingOnly && !IsOrganizationIncomingEvidencePath(relative) && !IsOrganizationReworkEvidencePath(relative)) continue;
                    Dictionary<string, object> localAlias;if (localAliases != null && localAliases.TryGetValue(relative, out localAlias)) { if (!Convert.ToBoolean(localAlias["pending"], CultureInfo.InvariantCulture)) continue;relative = Convert.ToString(localAlias["destination"], CultureInfo.InvariantCulture); }
                    bool reworkEvidence = IsOrganizationReworkEvidencePath(relative);
                    if (current.Item2 == 0 && (String.Equals(filename, "tracker-active-session.json", StringComparison.OrdinalIgnoreCase) || String.Equals(filename, "tracker-exclusive-session.lock", StringComparison.OrdinalIgnoreCase) || String.Equals(filename, ManifestFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(filename, ManifestChecksumFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(filename, SyncIndexFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(filename, SyncIndexChecksumFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(filename, RenamerQueueFilename, StringComparison.OrdinalIgnoreCase))) continue;
                    bool supportedExtension = filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) || filename.EndsWith(".zip", StringComparison.OrdinalIgnoreCase), historicalSaar = current.Item3 && supportedExtension && LooksLikeSaarFilename(filename);
                    if (current.Item3 && !historicalSaar) continue;
                    long journalSize = supportedExtension && directoryEntry.HasMetadata ? directoryEntry.Size : 0L, journalModified = supportedExtension && directoryEntry.HasMetadata ? directoryEntry.LastModifiedUnixMs : 0L;string journalMetadataError = "";
                    bool journalMetadataRead = !supportedExtension || directoryEntry.HasMetadata || TryReadFileMetadata(file, out journalSize, out journalModified, out journalMetadataError);
                    bool externalSharedAddition = supportedExtension && scanningSharedRoot && !PublishedEvidenceMatches(publishedEvidence, relative, journalSize, journalModified);
                    Dictionary<string, object> resumed;
                    if ((!legacyImport || !reworkEvidence) && journal.Completed.TryGetValue(relative, out resumed) && resumed.ContainsKey("cacheable") && Convert.ToBoolean(resumed["cacheable"], CultureInfo.InvariantCulture) && JournalItemMatches(resumed, filename, journalSize, journalModified))
                    {
                        Dictionary<string, object> indexed;bool indexUnchanged = previous.TryGetValue(relative, out indexed) && JournalItemMatches(indexed, filename, journalSize, journalModified);
                        var resumedItem = new Dictionary<string, object>(resumed);resumedItem["unchanged"] = indexUnchanged;resumedItem["resumed"] = true;resumedItem["externalSharedAddition"] = externalSharedAddition;
                        result.Add(resumedItem);journal.ResumedFiles++;
                        if (indexUnchanged) unchangedFiles++;
                        bool resumedCacheable = resumed.ContainsKey("cacheable") && Convert.ToBoolean(resumed["cacheable"], CultureInfo.InvariantCulture);
                        if (resumedCacheable) next.Add(IndexItem(resumedItem));
                        continue;
                    }
                    Dictionary<string, object> indexedItem = null;
                    bool indexedUnchanged = (!legacyImport || !reworkEvidence) && supportedExtension && previous.TryGetValue(relative, out indexedItem) && JournalItemMatches(indexedItem, filename, journalSize, journalModified);
                    if (indexedUnchanged)
                    {
                        var unchangedItem = new Dictionary<string, object>(indexedItem);unchangedItem["unchanged"] = true;unchangedItem["externalSharedAddition"] = externalSharedAddition;
                        result.Add(unchangedItem);next.Add(IndexItem(unchangedItem));unchangedFiles++;
                        continue;
                    }
                    journalWriter.Append(new Dictionary<string, object> { { "type", "file" }, { "state", "pending" }, { "path", relative }, { "name", CleanLine(filename, 500) }, { "size", journalSize }, { "lastModifiedUnixMs", journalModified }, { "timestampUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) } });
                    FailAfter("scan-file-pending");
                    if (!supportedExtension)
                    {
                        var rejected = new Dictionary<string, object> { { "name", CleanLine(filename, 500) }, { "path", relative }, { "size", journalSize }, { "lastModifiedUnixMs", journalModified }, { "accepted", false }, { "error", "Only PDF evidence or a ZIP containing one PDF is accepted." }, { "unchanged", false }, { "cacheable", true } };
                        result.Add(rejected);AppendSyncJournalResult(journalWriter, rejected, "rejected");
                        continue;
                    }
                    long size = journalSize, lastModifiedUnixMs = journalModified;string metadataError = journalMetadataError;
                    if (!journalMetadataRead)
                    {
                        var rejected = new Dictionary<string, object> { { "name", CleanLine(filename, 500) }, { "path", relative }, { "size", 0L }, { "lastModifiedUnixMs", 0L }, { "accepted", false }, { "error", "File metadata could not be read after network-aware retries: " + metadataError }, { "unchanged", false }, { "cacheable", false } };
                        result.Add(rejected);AppendSyncJournalResult(journalWriter, rejected, "rejected");
                        continue;
                    }
                    validations.Add(new PendingEvidenceValidation { File = file, Filename = filename, Relative = relative, Size = size, LastModifiedUnixMs = lastModifiedUnixMs, HistoricalSaar = historicalSaar, ExternalSharedAddition = externalSharedAddition });
                }
                foreach (DirectoryScanEntry directoryEntry in PrioritizedDirectories(directoryEntries))
                {
                    string directory = directoryEntry.Path;
                    string name = Path.GetFileName(directory);
                    if (!scanningSharedRoot && IsCompleteStorageDirectory(name)) continue;
                    bool permanentSaarArchive = IsPermanentSaarArchiveDirectory(name);
                    bool rework = IsReworkStorageDirectory(name);
                    bool incoming = IsIncomingStorageDirectory(name), artifactStorage = IsArtifactStorageDirectory(name), managedStorage = IsManagedStorageDirectory(name) || incoming || artifactStorage;
                    if (current.Item3) continue;
                    if (dailyIncomingOnly && managedStorage && !incoming && !rework) continue;
                    if (permanentSaarArchive) continue;
                    if (!dailyIncomingOnly && managedStorage && !rework && !incoming && !((fullRescan || legacyImport) && artifactStorage)) continue;
                    if (directoryEntry.IsReparsePoint || !directoryEntry.HasAttributes && IsScanReparsePoint(root, directory)) continue;
                    pending.Push(Tuple.Create(directory, current.Item2 + 1, permanentSaarArchive));
                }
            }
            enumerationTimer.Stop();
            var validationTimer = Stopwatch.StartNew();
            var validationResults = new ConcurrentDictionary<string, EvidenceValidationResult>(StringComparer.OrdinalIgnoreCase);
            int validationConcurrency = 1;
            if (validations.Count > 0)
            {
                EvidenceValidationResult probe = ValidateEvidenceFromLocalStage(root, validations[0]);
                validationResults[validations[0].Relative] = probe;
                validationConcurrency = AdaptiveValidationConcurrency(root, probe.DurationMilliseconds, validations.Count);
                if (validations.Count > 1)
                {
                    var options = new ParallelOptions { MaxDegreeOfParallelism = validationConcurrency };
                    Parallel.ForEach(validations.Skip(1), options, pendingValidation => validationResults[pendingValidation.Relative] = ValidateEvidenceFromLocalStage(root, pendingValidation));
                }
            }
            long stagedBytes = 0L, maxValidationDurationMs = 0L;int slowValidationFiles = 0;
            foreach (PendingEvidenceValidation pendingValidation in validations)
            {
                EvidenceValidationResult validation = validationResults[pendingValidation.Relative];stagedBytes += validation.StagedBytes;maxValidationDurationMs = Math.Max(maxValidationDurationMs, validation.DurationMilliseconds);if (validation.DurationMilliseconds >= 2000) slowValidationFiles++;
                string cleanName = CleanLine(pendingValidation.Filename, 500), cleanError = CleanLine(validation.Error, 300);
                var item = new Dictionary<string, object> { { "name", cleanName }, { "path", pendingValidation.Relative }, { "size", pendingValidation.Size }, { "lastModifiedUnixMs", pendingValidation.LastModifiedUnixMs }, { "accepted", validation.Accepted }, { "error", cleanError }, { "encryptedPdf", validation.EncryptedPdf }, { "externalSharedAddition", pendingValidation.ExternalSharedAddition }, { "unchanged", false } };
                result.Add(item);
                if (validation.Cacheable) next.Add(new Dictionary<string, object> { { "name", cleanName }, { "path", pendingValidation.Relative }, { "size", pendingValidation.Size }, { "lastModifiedUnixMs", pendingValidation.LastModifiedUnixMs }, { "accepted", validation.Accepted }, { "error", cleanError }, { "encryptedPdf", validation.EncryptedPdf }, { "externalSharedAddition", pendingValidation.ExternalSharedAddition } });
                item["cacheable"] = validation.Cacheable;AppendSyncJournalResult(journalWriter, item, validation.Accepted ? "validated" : "rejected");item.Remove("cacheable");
            }
            validationTimer.Stop();
            journalWriter.Flush();
            SaveSyncIndex(root, cleanRuleSet, next, cleanOrganization);
            journalWriter.Append(new Dictionary<string, object> { { "type", "run-state" }, { "state", "indexed" }, { "timestampUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "files", result.Count } });
            journalWriter.Flush();
            var diagnostics = new Dictionary<string, object> { { "enumerationDurationMs", enumerationTimer.ElapsedMilliseconds }, { "validationDurationMs", validationTimer.ElapsedMilliseconds }, { "discoveredFiles", discoveredFiles }, { "changedFiles", validations.Count }, { "unchangedFiles", unchangedFiles }, { "externalSharedAdditions", result.Count(item => item.ContainsKey("externalSharedAddition") && Convert.ToBoolean(item["externalSharedAddition"], CultureInfo.InvariantCulture)) }, { "stagedBytes", stagedBytes }, { "validationConcurrency", validationConcurrency }, { "slowValidationFiles", slowValidationFiles }, { "maxValidationDurationMs", maxValidationDurationMs }, { "networkRoot", IsNetworkRoot(root) } };
            return json.Serialize(new Dictionary<string, object> { { "version", SyncJournalVersion }, { "runId", journal.RunId }, { "resumedFiles", journal.ResumedFiles }, { "items", result.ToArray() }, { "diagnostics", diagnostics } });
            }
        }
    }

    public string ListEvidenceLocations(string systemId) { return ListEvidenceLocations(systemId, null); }

    public string ListEvidenceLocations(string systemId, string organization) { return ListEvidenceLocations(systemId, organization, false); }

    public string ListEvidenceLocations(string systemId, string organization, bool fullRescan)
    {
        lock (RootLock(systemId))
        {
            string sharedRoot = Root(systemId), localRoot = LocalEvidenceRoot(systemId), cleanOrganization = String.IsNullOrWhiteSpace(organization) ? null : ValidOrganizationName(organization);RecoverTransactions(localRoot);
            var result = new List<Dictionary<string, object>>();var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);int skippedZips = 0, skippedArchives = 0;
            CollectEvidenceLocations(localRoot, cleanOrganization, result, seen, ref skippedZips, ref skippedArchives);
            var localAliases = LocalEvidenceAliases(systemId);foreach (Dictionary<string, object> item in result) { Dictionary<string, object> alias;if (localAliases.TryGetValue(Convert.ToString(item["path"], CultureInfo.InvariantCulture), out alias)) item["path"] = alias["destination"]; }seen = new HashSet<string>(result.Select(item => Convert.ToString(item["path"], CultureInfo.InvariantCulture)), StringComparer.OrdinalIgnoreCase);
            if (fullRescan) { RecoverTransactions(sharedRoot);CollectEvidenceLocations(sharedRoot, cleanOrganization, result, seen, ref skippedZips, ref skippedArchives); }
            else CollectRecordedEvidenceLocations(systemId, cleanOrganization, result, seen);
            return json.Serialize(new Dictionary<string, object> { { "items", result.ToArray() }, { "skippedZips", skippedZips }, { "skippedArchives", skippedArchives } });
        }
    }

    private void CollectRecordedEvidenceLocations(string systemId, string organization, List<Dictionary<string, object>> result, HashSet<string> seen)
    {
        string text = ReadWorkingManifest(systemId);if (String.IsNullOrWhiteSpace(text)) return;
        Dictionary<string, object> database = ValidateDatabase(text);
        foreach (object value in ObjectArray(database["users"]))
        {
            Dictionary<string, object> user = ObjectDictionary(value);
            if (user.ContainsKey("disabled") && Convert.ToBoolean(user["disabled"], CultureInfo.InvariantCulture)) continue;
            string userOrganization = Convert.ToString(user["organization"], CultureInfo.InvariantCulture);
            if (organization != null && !String.Equals(userOrganization, organization, StringComparison.OrdinalIgnoreCase)) continue;
            foreach (object artifactValue in ObjectArray(user["artifacts"]))
            {
                Dictionary<string, object> artifact = ObjectDictionary(artifactValue);
                string filename = Convert.ToString(artifact["filename"], CultureInfo.InvariantCulture), relative = artifact.ContainsKey("path") ? Convert.ToString(artifact["path"], CultureInfo.InvariantCulture) : "";
                if (String.IsNullOrWhiteSpace(filename)) continue;
                if (String.IsNullOrWhiteSpace(relative)) relative = "Organizations/" + ValidOrganizationName(userOrganization) + "/" + OrganizationArtifactStorageFolder(ArtifactStorageFolder(Convert.ToString(artifact["kind"], CultureInfo.InvariantCulture)), userOrganization) + "/" + filename;
                relative = relative.Replace('\\', '/');
                if (ContainsManagedStorageDirectory(relative) || !seen.Add(relative)) continue;
                if (result.Count >= 100000) throw new InvalidDataException("Evidence location limit exceeded.");
                result.Add(new Dictionary<string, object> { { "name", filename }, { "path", relative }, { "recorded", true } });
            }
        }
    }

    private static void CollectEvidenceLocations(string root, string organization, List<Dictionary<string, object>> result, HashSet<string> seen, ref int skippedZips, ref int skippedArchives)
    {
            string scanRoot = OrganizationScopeRoot(root, organization);if (!Directory.Exists(scanRoot)) return;
            var pending = new Stack<Tuple<string, int>>();pending.Push(Tuple.Create(scanRoot, 0));
            while (pending.Count > 0)
            {
                Tuple<string, int> current = pending.Pop();
                if (current.Item2 > 25) throw new InvalidDataException("Folder nesting limit exceeded while refreshing evidence locations.");
                DirectoryScanEntry[] directoryEntries = EnumerateDirectoryEntries(root, current.Item1);
                foreach (DirectoryScanEntry directoryEntry in directoryEntries.Where(item => !item.IsDirectory))
                {
                    string file = directoryEntry.Path;
                    if (result.Count >= 100000) throw new InvalidDataException("Evidence location limit exceeded.");
                    string filename = Path.GetFileName(file);
                    if (current.Item2 == 0 && (String.Equals(filename, "tracker-active-session.json", StringComparison.OrdinalIgnoreCase) || String.Equals(filename, "tracker-exclusive-session.lock", StringComparison.OrdinalIgnoreCase) || String.Equals(filename, ManifestFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(filename, ManifestChecksumFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(filename, SyncIndexFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(filename, SyncIndexChecksumFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(filename, RenamerQueueFilename, StringComparison.OrdinalIgnoreCase))) continue;
                    if (!filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && !filename.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) continue;if (filename.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) skippedZips++;
                    string relative = Relative(root, file).Replace(Path.DirectorySeparatorChar, '/');long size = directoryEntry.HasMetadata ? directoryEntry.Size : 0L, modified = directoryEntry.HasMetadata ? directoryEntry.LastModifiedUnixMs : 0L;string metadataError = "";
                    if (!seen.Add(relative)) continue;
                    if (!directoryEntry.HasMetadata && !TryReadFileMetadata(file, out size, out modified, out metadataError)) { result.Add(new Dictionary<string, object> { { "name", CleanLine(filename, 500) }, { "path", relative }, { "error", "File metadata could not be read after network-aware retries: " + metadataError } });continue; }
                    result.Add(new Dictionary<string, object> { { "name", CleanLine(filename, 500) }, { "path", relative }, { "size", size }, { "lastModifiedUnixMs", modified } });
                }
                foreach (DirectoryScanEntry directoryEntry in PrioritizedDirectories(directoryEntries))
                {
                    string directory = directoryEntry.Path;
                    string name = Path.GetFileName(directory);bool rework = IsReworkStorageDirectory(name);
                    if (IsCompleteStorageDirectory(name) || IsManagedStorageDirectory(name) && !rework) { if (name.EndsWith(" Archive", StringComparison.OrdinalIgnoreCase)) skippedArchives++;continue; }
                    if (!directoryEntry.IsReparsePoint && (directoryEntry.HasAttributes || !IsScanReparsePoint(root, directory))) pending.Push(Tuple.Create(directory, current.Item2 + 1));
                }
            }
    }

    public string ListArchivedEvidenceLocations(string systemId, string organization)
    {
        lock (RootLock(systemId))
        {
            string root = LocalEvidenceRoot(systemId), cleanOrganization = ValidOrganizationName(organization);RecoverTransactions(root);
            var result = new List<Dictionary<string, object>>();
            foreach (string file in EnumerateOrganizationArchiveFiles(root, cleanOrganization))
            {
                long size = 0L, modified = 0L;string metadataError;
                if (!TryReadFileMetadata(file, out size, out modified, out metadataError)) continue;
                result.Add(new Dictionary<string, object> { { "name", CleanLine(Path.GetFileName(file), 500) }, { "path", Relative(root, file).Replace(Path.DirectorySeparatorChar, '/') }, { "size", size }, { "lastModifiedUnixMs", modified } });
            }
            return json.Serialize(new Dictionary<string, object> { { "items", result.ToArray() } });
        }
    }

    public string CommitSyncJournal(string systemId, string runId)
    {
        ValidateSessionId(runId);
        lock (RootLock(systemId))
        {
            // Daily journals belong to the workspace cache; full-scan journals belong
            // to the mapped-root cache. Both directories are local to this computer.
            string directory = LocalPerformanceCacheDirectory(LocalWorkspaceRoot(systemId), "Sync Journals"), path = Path.Combine(directory, "sync-" + runId + ".jsonl");
            if (!File.Exists(path)) { directory = LocalPerformanceCacheDirectory(Root(systemId), "Sync Journals");path = Path.Combine(directory, "sync-" + runId + ".jsonl"); }
            // A journal is resumability metadata, not the authoritative commit.
            // The browser finalizes it only after the protected local database has
            // already been saved. A pruned or previously finalized journal must
            // therefore be an idempotent success instead of rolling the UI back to
            // stale file actions that may already have moved their sources.
            if (!File.Exists(path)) return json.Serialize(new Dictionary<string, object> { { "committed", true }, { "alreadyFinalized", true }, { "journalMissing", true } });
            AppendSyncJournal(path, new Dictionary<string, object> { { "type", "run-state" }, { "state", "committed" }, { "timestampUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) } });
            PruneSyncJournals(directory);
            return "{\"committed\":true}";
        }
    }

    private SyncJournalState StartOrResumeSyncJournal(string root, string ruleSetVersion, bool fullRescan)
    {
        string directory = LocalPerformanceCacheDirectory(root, "Sync Journals");
        if (!fullRescan)
        {
            foreach (string candidate in Directory.EnumerateFiles(directory, "sync-*.jsonl", SearchOption.TopDirectoryOnly).OrderByDescending(Path.GetFileName))
            {
                SyncJournalState resumed = ReadResumableSyncJournal(candidate, ruleSetVersion);
                if (resumed != null) return resumed;
            }
        }
        string runId = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffffffZ", CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N"), path = Path.Combine(directory, "sync-" + runId + ".jsonl");
        var state = new SyncJournalState { Path = path, RunId = runId, RuleSetVersion = ruleSetVersion };
        AppendSyncJournal(path, new Dictionary<string, object> { { "type", "run" }, { "version", SyncJournalVersion }, { "runId", runId }, { "ruleSetVersion", ruleSetVersion }, { "state", "running" }, { "startedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) } });
        return state;
    }

    private SyncJournalState ReadResumableSyncJournal(string path, string ruleSetVersion)
    {
        try
        {
            var info = new FileInfo(path);if (!info.Exists || info.Length <= 0 || info.Length > JournalLimit) return null;
            var state = new SyncJournalState { Path = path };
            bool header = false, committed = false;
            foreach (string line in File.ReadLines(path, Encoding.UTF8))
            {
                if (String.IsNullOrWhiteSpace(line)) continue;
                Dictionary<string, object> item = ObjectDictionary(json.DeserializeObject(line));
                string type = item.ContainsKey("type") ? Convert.ToString(item["type"], CultureInfo.InvariantCulture) : "";
                if (type == "run")
                {
                    if (Convert.ToInt32(item["version"], CultureInfo.InvariantCulture) != SyncJournalVersion) return null;
                    state.RunId = Convert.ToString(item["runId"], CultureInfo.InvariantCulture);state.RuleSetVersion = Convert.ToString(item["ruleSetVersion"], CultureInfo.InvariantCulture);header = true;
                }
                else if (type == "file" && item.ContainsKey("path") && item.ContainsKey("state"))
                {
                    string itemState = Convert.ToString(item["state"], CultureInfo.InvariantCulture), relative = Convert.ToString(item["path"], CultureInfo.InvariantCulture);
                    if (itemState == "validated" || itemState == "rejected") state.Completed[relative] = item;
                }
                else if (type == "run-state" && String.Equals(Convert.ToString(item["state"], CultureInfo.InvariantCulture), "committed", StringComparison.Ordinal)) committed = true;
            }
            if (!header || committed || !String.Equals(state.RuleSetVersion, ruleSetVersion, StringComparison.Ordinal) || String.IsNullOrWhiteSpace(state.RunId)) return null;
            return state;
        }
        catch { return null; }
    }

    private void AppendSyncJournalResult(string path, Dictionary<string, object> item, string state)
    {
        var entry = new Dictionary<string, object>(item);entry["type"] = "file";entry["state"] = state;entry["timestampUtc"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        entry.Remove("unchanged");entry.Remove("resumed");AppendSyncJournal(path, entry);
    }

    private static void AppendSyncJournalResult(SyncJournalWriter writer, Dictionary<string, object> item, string state)
    {
        var entry = new Dictionary<string, object>(item);entry["type"] = "file";entry["state"] = state;entry["timestampUtc"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        entry.Remove("unchanged");entry.Remove("resumed");writer.Append(entry);
    }

    private void AppendSyncJournal(string path, Dictionary<string, object> item)
    {
        string line = json.Serialize(item) + Environment.NewLine;
        AppendSyncJournalLines(path, new List<string> { line }, Encoding.UTF8.GetByteCount(line));
    }

    private void AppendSyncJournalLines(string path, IList<string> lines, int expectedBytes)
    {
        if (lines == null || lines.Count == 0) return;
        var builder = new StringBuilder(Math.Max(expectedBytes, 256));
        foreach (string line in lines) builder.Append(line);
        byte[] bytes = Encoding.UTF8.GetBytes(builder.ToString());
        var info = new FileInfo(path);if (info.Exists && info.Length + bytes.Length > JournalLimit) throw new InvalidDataException("The resumable Sync journal exceeds the 100 MB limit.");
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        using (var stream = OpenCompatibleFileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, Math.Max(8192, Math.Min(bytes.Length, 65536)))) { stream.Write(bytes, 0, bytes.Length);FlushCompatible(stream); }
    }

    private static bool JournalItemMatches(Dictionary<string, object> item, string filename, long size, long modified)
    {
        try { return String.Equals(Convert.ToString(item["name"], CultureInfo.InvariantCulture), filename, StringComparison.OrdinalIgnoreCase) && Convert.ToInt64(item["size"], CultureInfo.InvariantCulture) == size && Convert.ToInt64(item["lastModifiedUnixMs"], CultureInfo.InvariantCulture) == modified && item.ContainsKey("accepted") && item.ContainsKey("error"); }
        catch { return false; }
    }

    private static Dictionary<string, object> IndexItem(Dictionary<string, object> item)
    {
        var indexed = new Dictionary<string, object> { { "name", item["name"] }, { "path", item["path"] }, { "size", item["size"] }, { "lastModifiedUnixMs", item["lastModifiedUnixMs"] }, { "accepted", item["accepted"] }, { "error", item["error"] } };
        if (item.ContainsKey("encryptedPdf")) indexed["encryptedPdf"] = item["encryptedPdf"];
        if (item.ContainsKey("externalSharedAddition")) indexed["externalSharedAddition"] = item["externalSharedAddition"];
        return indexed;
    }

    private static void PruneSyncJournals(string directory)
    {
        if (!Directory.Exists(directory)) return;
        foreach (string stale in Directory.EnumerateFiles(directory, "sync-*.jsonl", SearchOption.TopDirectoryOnly).OrderByDescending(Path.GetFileName).Skip(30)) TryDelete(stale);
    }

    private void StartChangeWatcher(string systemId, string root)
    {
        try
        {
            string organizations = Path.Combine(root, "Organizations");
            if (!Directory.Exists(organizations))
            {
                lock (changeHintGate)
                {
                    ChangeHintState unavailable;
                    if (!changeHints.TryGetValue(systemId, out unavailable)) changeHints[systemId] = unavailable = new ChangeHintState();
                    unavailable.Overflowed = true;
                }
                return;
            }
            var watcher = new FileSystemWatcher(organizations) { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size, InternalBufferSize = 64 * 1024 };
            FileSystemEventHandler changed = delegate(object sender, FileSystemEventArgs eventArgs) { RecordChangeHint(systemId, organizations, eventArgs.FullPath); };
            RenamedEventHandler renamed = delegate(object sender, RenamedEventArgs eventArgs) { RecordChangeHint(systemId, organizations, eventArgs.OldFullPath);RecordChangeHint(systemId, organizations, eventArgs.FullPath); };
            ErrorEventHandler failed = delegate { lock (changeHintGate) { ChangeHintState state;if (!changeHints.TryGetValue(systemId, out state)) changeHints[systemId] = state = new ChangeHintState();state.Overflowed = true;state.LastEventUtc = DateTime.UtcNow; } };
            watcher.Created += changed;watcher.Changed += changed;watcher.Deleted += changed;watcher.Renamed += renamed;watcher.Error += failed;watcher.EnableRaisingEvents = true;
            lock (mapGate)
            {
                FileSystemWatcher previous;if (changeWatchers.TryGetValue(systemId, out previous)) try { previous.Dispose(); } catch { }
                changeWatchers[systemId] = watcher;
            }
            lock (changeHintGate) if (!changeHints.ContainsKey(systemId)) changeHints[systemId] = new ChangeHintState();
        }
        catch
        {
            lock (changeHintGate) { ChangeHintState state;if (!changeHints.TryGetValue(systemId, out state)) changeHints[systemId] = state = new ChangeHintState();state.Overflowed = true; }
        }
    }

    private void RecordChangeHint(string systemId, string organizationsRoot, string path)
    {
        try
        {
            string relative = Relative(organizationsRoot, path);string[] parts = relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);if (parts.Length == 0 || ReservedOrganizationName(parts[0])) return;
            lock (changeHintGate) { ChangeHintState state;if (!changeHints.TryGetValue(systemId, out state)) changeHints[systemId] = state = new ChangeHintState();state.Organizations.Add(parts[0]);state.LastEventUtc = DateTime.UtcNow; }
        }
        catch { lock (changeHintGate) { ChangeHintState state;if (!changeHints.TryGetValue(systemId, out state)) changeHints[systemId] = state = new ChangeHintState();state.Overflowed = true; } }
    }

    private string SuggestedChangeHintOrganization(string systemId, out bool noChanges, out int dirtyCount)
    {
        lock (changeHintGate)
        {
            ChangeHintState state;if (!changeHints.TryGetValue(systemId, out state) || !state.Baselined || state.Overflowed) { noChanges = false;dirtyCount = state == null ? 0 : state.Organizations.Count;return null; }
            dirtyCount = state.Organizations.Count;noChanges = dirtyCount == 0;return dirtyCount == 1 ? state.Organizations.First() : null;
        }
    }

    private void CompleteChangeHintScan(string systemId, string organization, bool authoritativeSystemScan)
    {
        lock (changeHintGate)
        {
            ChangeHintState state;if (!changeHints.TryGetValue(systemId, out state)) changeHints[systemId] = state = new ChangeHintState();
            if (authoritativeSystemScan) { state.Baselined = true;state.Overflowed = false;state.Organizations.Clear(); }
            else if (!String.IsNullOrWhiteSpace(organization)) state.Organizations.Remove(organization);
        }
    }

    private static IEnumerable<DirectoryScanEntry> PrioritizedDirectories(DirectoryScanEntry[] entries)
    {
        IEnumerable<DirectoryScanEntry> directories = entries.Where(item => item.IsDirectory);
        if (String.IsNullOrWhiteSpace(threadPriorityOrganization)) return directories;
        // A watcher event only changes traversal order. Every in-scope directory is still
        // enumerated, so a missed or delayed network notification cannot hide evidence.
        return directories.OrderBy(item => String.Equals(Path.GetFileName(item.Path), threadPriorityOrganization, StringComparison.OrdinalIgnoreCase) ? 1 : 0);
    }

    private string LocalPerformanceCacheDirectory(string root, string purpose)
    {
        string parent = Path.GetDirectoryName(mappingCachePath);
        if (String.IsNullOrWhiteSpace(parent)) parent = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InformationSystemUserTracker");
        string rootKey = Sha256(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).ToUpperInvariant()).Substring(0, 24);
        string directory = Path.Combine(parent, "performance-cache", rootKey, purpose);
        Directory.CreateDirectory(directory);
        return directory;
    }

    private void AppendPerformanceDiagnostic(string root, Dictionary<string, object> values)
    {
        try
        {
            var entry = new Dictionary<string, object>(values ?? new Dictionary<string, object>());entry["timestampUtc"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);entry["actor"] = actor;
            string directory = LocalPerformanceCacheDirectory(root, "Performance"), path = Path.Combine(directory, "performance-" + DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ".jsonl"), line = json.Serialize(entry) + Environment.NewLine;byte[] bytes = Encoding.UTF8.GetBytes(line);
            if (File.Exists(path) && new FileInfo(path).Length + bytes.LongLength > 10L * 1024 * 1024) return;
            using (var stream = OpenCompatibleFileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, 16384)) { stream.Write(bytes, 0, bytes.Length);FlushCompatible(stream); }
            foreach (string stale in Directory.EnumerateFiles(directory, "performance-*.jsonl", SearchOption.TopDirectoryOnly).OrderByDescending(Path.GetFileName).Skip(30)) TryDelete(stale);
        }
        catch { }
    }

    public string ReadPerformanceDiagnostics(string systemId)
    {
        string root = Root(systemId), directory = LocalPerformanceCacheDirectory(root, "Performance");var entries = new List<Dictionary<string, object>>();
        try
        {
            foreach (string path in Directory.EnumerateFiles(directory, "performance-*.jsonl", SearchOption.TopDirectoryOnly).OrderByDescending(Path.GetFileName).Take(30).Reverse())
            using (var reader = new StreamReader(path, new UTF8Encoding(false, true)))
            {
                string line;while ((line = reader.ReadLine()) != null) { if (String.IsNullOrWhiteSpace(line) || line.Length > 64 * 1024) continue;try { entries.Add(ObjectDictionary(json.DeserializeObject(line)));if (entries.Count > 500) entries.RemoveAt(0); } catch { } }
            }
        }
        catch { }
        var operations = new List<Dictionary<string, object>>();
        foreach (var group in entries.GroupBy(item => item.ContainsKey("operation") ? Convert.ToString(item["operation"], CultureInfo.InvariantCulture) : "other", StringComparer.OrdinalIgnoreCase))
        {
            long[] durations = group.Select(item => PerformanceDuration(item)).Where(value => value >= 0).OrderBy(value => value).ToArray();if (durations.Length == 0) continue;
            var summary = new Dictionary<string, object> { { "operation", group.Key }, { "runs", durations.Length }, { "averageMs", (long)Math.Round(durations.Average()) }, { "p50Ms", Percentile(durations, 0.50) }, { "p95Ms", Percentile(durations, 0.95) }, { "maximumMs", durations[durations.Length - 1] } };
            foreach (string metric in new[] { "preparationMs", "transferMs", "finalizationMs", "bytesTransferred", "bytesPerSecond" })
            {
                long[] values = group.Where(item => item.ContainsKey(metric)).Select(item => Convert.ToInt64(item[metric], CultureInfo.InvariantCulture)).Where(value => value >= 0).ToArray();if (values.Length > 0) summary["average" + Char.ToUpperInvariant(metric[0]) + metric.Substring(1)] = (long)Math.Round(values.Average());
            }
            operations.Add(summary);
        }
        bool backupPending;lock (backupGate) backupPending = pendingBackups.ContainsKey(systemId);bool watcherBaselined = false, watcherOverflowed = false;string[] dirtyOrganizations = new string[0];
        lock (changeHintGate) { ChangeHintState hints;if (changeHints.TryGetValue(systemId, out hints)) { watcherBaselined = hints.Baselined;watcherOverflowed = hints.Overflowed;dirtyOrganizations = hints.Organizations.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToArray(); } }
        string shardDirectory = LocalPerformanceCacheDirectory(root, "Sync Index Shards");int shards = 0;try { if (Directory.Exists(shardDirectory)) shards = Directory.EnumerateFiles(shardDirectory, "index-*.json", SearchOption.TopDirectoryOnly).Count(); } catch { }
        int databaseShards = 0, publicationIndexShards = 0;string manifestStorageFormat = "legacy-single-file", backupCompression = "Legacy JSON";bool localReadCacheAvailable = File.Exists(Path.Combine(LocalPerformanceCacheDirectory(root, "Manifest"), LocalManifestCacheFilename));
        try { string manifestPath = Path.Combine(root, SystemDirectoryName, ManifestFilename);if (File.Exists(manifestPath)) { Dictionary<string, object> catalog=ObjectDictionary(json.DeserializeObject(ReadText(manifestPath,ManifestLimit)));if(catalog.ContainsKey("storageFormat")&&String.Equals(Convert.ToString(catalog["storageFormat"],CultureInfo.InvariantCulture),ManifestStorageFormat,StringComparison.Ordinal)){manifestStorageFormat=ManifestStorageFormat;databaseShards=ObjectArray(catalog["userShards"]).Length;} } } catch { }
        try { string latest=SnapshotPaths(SupportDirectory(root,"backup")).FirstOrDefault();if(latest!=null)backupCompression=latest.EndsWith(".json.gz",StringComparison.OrdinalIgnoreCase)?"GZip":"Legacy JSON"; } catch { }
        try { string publicationShardDirectory = Path.Combine(root, SystemDirectoryName, PublicationDirectoryName, PublicationIndexShardDirectoryName);if (Directory.Exists(publicationShardDirectory)) publicationIndexShards = Directory.EnumerateFiles(publicationShardDirectory, "published-*.json", SearchOption.TopDirectoryOnly).Count(); } catch { }
        return json.Serialize(new Dictionary<string, object> { { "generatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "networkRoot", IsNetworkRoot(root) }, { "operations", operations.OrderByDescending(item => Convert.ToInt64(item["p95Ms"], CultureInfo.InvariantCulture)).ToArray() }, { "recent", entries.AsEnumerable().Reverse().Take(100).ToArray() }, { "backupPending", backupPending }, { "watcherBaselined", watcherBaselined }, { "watcherOverflowed", watcherOverflowed }, { "dirtyOrganizations", dirtyOrganizations }, { "syncIndexShards", shards }, { "databaseShards", databaseShards }, { "publicationIndexShards", publicationIndexShards }, { "manifestStorageFormat", manifestStorageFormat }, { "localReadCacheAvailable", localReadCacheAvailable }, { "backupCompression", backupCompression }, { "auditCheckpointAvailable", File.Exists(Path.Combine(LocalPerformanceCacheDirectory(root, "Audit"), LocalAuditCheckpointFilename)) } });
    }

    public string ReadSanitizedDiagnostics(string systemId)
    {
        string root = Root(systemId), directory = Path.Combine(root, SystemDirectoryName, ErrorReportsDirectoryName);int fileCount = 0, entryCount = 0;var contexts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        try
        {
            if (Directory.Exists(directory))
            foreach (string path in Directory.EnumerateFiles(directory, "error-report-*.txt", SearchOption.TopDirectoryOnly).OrderByDescending(Path.GetFileName).Take(30))
            {
                fileCount++;var info = new FileInfo(path);if (!info.Exists || info.Length <= 0 || info.Length > ErrorReportFileLimit) continue;
                using (var reader = new StreamReader(path, new UTF8Encoding(false, true)))
                {
                    string line;int lines = 0;while ((line = reader.ReadLine()) != null && lines++ < 250000)
                    {
                        if (line.StartsWith("Report ID:", StringComparison.OrdinalIgnoreCase)) entryCount++;
                        if (!line.StartsWith("Context:", StringComparison.OrdinalIgnoreCase)) continue;
                        string context = DiagnosticContextCategory(line.Substring("Context:".Length));int count;contexts[context] = contexts.TryGetValue(context, out count) ? count + 1 : 1;
                    }
                }
            }
        }
        catch { }
        var categories = contexts.OrderByDescending(item => item.Value).ThenBy(item => item.Key, StringComparer.OrdinalIgnoreCase).Take(100).Select(item => new Dictionary<string, object> { { "context", item.Key }, { "count", item.Value } }).ToArray();
        return json.Serialize(new Dictionary<string, object> { { "generatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "networkRoot", IsNetworkRoot(root) }, { "errorReportFiles", fileCount }, { "errorEntries", entryCount }, { "contexts", categories } });
    }

    private static string DiagnosticContextCategory(string context)
    {
        string value = (context ?? "").ToUpperInvariant();
        if (value.Contains("SYNC") || value.Contains("SCAN") || value.Contains("RECONCIL")) return "Sync and Reconciliation";
        if (value.Contains("OUTLOOK") || value.Contains("EMAIL") || value.Contains("NOTIFICATION")) return "Outlook and Notifications";
        if (value.Contains("EVIDENCE") || value.Contains("PDF") || value.Contains("DOCUMENT") || value.Contains("UPLOAD")) return "Evidence Processing";
        if (value.Contains("USER") || value.Contains("PRIVILEGE") || value.Contains("ACCOUNT")) return "User Management";
        if (value.Contains("BACKUP") || value.Contains("RESTORE")) return "Backup and Restore";
        if (value.Contains("AUDIT")) return "Audit Integrity";
        if (value.Contains("STORAGE") || value.Contains("MANIFEST") || value.Contains("DATABASE") || value.Contains("SESSION") || value.Contains("LEASE")) return "Storage and Session";
        if (value.Contains("REPORT") || value.Contains("SNAPSHOT") || value.Contains("EXPORT")) return "Reporting and Export";
        return "Other Operational Error";
    }

    private static long PerformanceDuration(Dictionary<string, object> item)
    {
        foreach (string key in new[] { "totalDurationMs", "durationMs", "validationDurationMs", "scanDurationMs" }) try { if (item.ContainsKey(key)) return Convert.ToInt64(item[key], CultureInfo.InvariantCulture); } catch { }
        return -1;
    }

    private static long Percentile(long[] sorted, double percentile) { if (sorted == null || sorted.Length == 0) return 0;int index = (int)Math.Ceiling(percentile * sorted.Length) - 1;return sorted[Math.Max(0, Math.Min(sorted.Length - 1, index))]; }

    private static byte[] ManifestCacheEntropy()
    {
        return Encoding.UTF8.GetBytes("RAPTOR verified local manifest cache v2");
    }

    private void SaveLocalManifestCache(string root, string manifest, string sharedSha256)
    {
        try
        {
            if (String.IsNullOrWhiteSpace(manifest)) return;
            ValidateDatabase(manifest);
            string contentHash = Sha256(manifest), sharedHash = IsSha256(sharedSha256) ? sharedSha256.ToLowerInvariant() : contentHash;
            long sharedLength = 0L, sharedModifiedUnixMs = 0L;string manifestPath = Path.Combine(root, SystemDirectoryName, ManifestFilename);
            try { var info = new FileInfo(manifestPath);info.Refresh();if (info.Exists) { sharedLength = info.Length;sharedModifiedUnixMs = new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds(); } } catch { }
            string now = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            var envelope = new Dictionary<string, object> { { "version", ManifestCacheVersion }, { "cachedAtUtc", now }, { "verifiedAtUtc", now }, { "sharedSha256", sharedHash }, { "contentSha256", contentHash }, { "sharedLength", sharedLength }, { "sharedModifiedUnixMs", sharedModifiedUnixMs }, { "manifest", manifest } };
            byte[] clear = Encoding.UTF8.GetBytes(json.Serialize(envelope)), encrypted = ProtectedData.Protect(clear, ManifestCacheEntropy(), DataProtectionScope.CurrentUser);
            AtomicWrite(Path.Combine(LocalPerformanceCacheDirectory(root, "Manifest"), LocalManifestCacheFilename), encrypted);
        }
        catch { }
    }

    private string ReadLocalManifestCache(string root, out string cachedAtUtc)
    {
        ManifestCacheRecord record = ReadLocalManifestCacheRecord(root);cachedAtUtc = record == null ? "" : record.CachedAtUtc;return record == null ? null : record.Manifest;
    }

    private ManifestCacheRecord ReadLocalManifestCacheRecord(string root)
    {
        string path = null;
        try
        {
            path = Path.Combine(LocalPerformanceCacheDirectory(root, "Manifest"), LocalManifestCacheFilename);
            if (!File.Exists(path) || new FileInfo(path).Length <= 0 || new FileInfo(path).Length > ManifestLimit * 2) return null;
            byte[] clear = ProtectedData.Unprotect(File.ReadAllBytes(path), ManifestCacheEntropy(), DataProtectionScope.CurrentUser);
            Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(new UTF8Encoding(false, true).GetString(clear)));
            if (Convert.ToInt32(envelope["version"], CultureInfo.InvariantCulture) != ManifestCacheVersion) return null;
            string manifest = Convert.ToString(envelope["manifest"], CultureInfo.InvariantCulture), hash = Convert.ToString(envelope["sharedSha256"], CultureInfo.InvariantCulture), contentHash = Convert.ToString(envelope["contentSha256"], CultureInfo.InvariantCulture), cachedAtUtc = Convert.ToString(envelope["cachedAtUtc"], CultureInfo.InvariantCulture), verifiedAtUtc = Convert.ToString(envelope["verifiedAtUtc"], CultureInfo.InvariantCulture);
            if (String.IsNullOrWhiteSpace(manifest) || !IsSha256(hash) || !IsSha256(contentHash) || !String.Equals(contentHash, Sha256(manifest), StringComparison.OrdinalIgnoreCase)) return null;
            ValidateDatabase(manifest);DateTime parsed, verified;if (!DateTime.TryParse(cachedAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out parsed) || !DateTime.TryParse(verifiedAtUtc, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out verified)) return null;
            return new ManifestCacheRecord { Manifest = manifest, CachedAtUtc = cachedAtUtc, VerifiedAtUtc = verifiedAtUtc, SharedSha256 = hash.ToLowerInvariant(), ContentSha256 = contentHash.ToLowerInvariant(), SharedLength = Convert.ToInt64(envelope["sharedLength"], CultureInfo.InvariantCulture), SharedModifiedUnixMs = Convert.ToInt64(envelope["sharedModifiedUnixMs"], CultureInfo.InvariantCulture) };
        }
        catch { if (!String.IsNullOrWhiteSpace(path)) TryDelete(path);return null; }
    }

    private Dictionary<string, Dictionary<string, object>> LoadSyncIndex(string root, string ruleSetVersion, string organization = null)
    {
        var result = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
        try
        {
            string directory = Path.Combine(root, SystemDirectoryName, SyncIndexDirectoryName);
            string[] paths = Directory.Exists(directory) ? (String.IsNullOrWhiteSpace(organization) ? Directory.EnumerateFiles(directory, "index-*.json", SearchOption.TopDirectoryOnly).ToArray() : new[] { Path.Combine(directory, SyncIndexShardFilename(organization)) }.Where(File.Exists).ToArray()) : new string[0];
            foreach (string indexPath in paths) LoadSyncIndexFile(root, indexPath, ruleSetVersion, SyncIndexVersion, result);
            if (result.Count > 0 || paths.Length > 0) return result;
            string legacyPath = SystemFile(root, SyncIndexFilename);
            if (File.Exists(legacyPath)) LoadSyncIndexFile(root, legacyPath, ruleSetVersion, 1, result);
            if (!String.IsNullOrWhiteSpace(organization)) foreach (string key in result.Keys.Where(key => !PathInOrganizationScope(key, organization)).ToArray()) result.Remove(key);
        }
        catch { return new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase); }
        return result;
    }

    private void LoadSyncIndexFile(string root, string indexPath, string ruleSetVersion, int expectedVersion, Dictionary<string, Dictionary<string, object>> result)
    {
        string checksumPath = indexPath + ".sha256", filename = Path.GetFileName(indexPath);if (!File.Exists(checksumPath)) return;
        string[] checksumParts = ReadText(checksumPath, 1024).Trim().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);if (checksumParts.Length != 2 || !String.Equals(checksumParts[1], filename, StringComparison.Ordinal) || !IsSha256(checksumParts[0])) return;
        string expectedHash = checksumParts[0].ToLowerInvariant(), localPath = Path.Combine(LocalPerformanceCacheDirectory(root, "Sync Index Shards"), filename), text = null;
        try { if (File.Exists(localPath)) { string cached = File.ReadAllText(localPath, Encoding.UTF8);if (Encoding.UTF8.GetByteCount(cached) <= SyncIndexLimit && String.Equals(expectedHash, Sha256(cached), StringComparison.OrdinalIgnoreCase)) text = cached; } } catch { TryDelete(localPath); }
        if (text == null) { text = ReadText(indexPath, SyncIndexLimit);if (!String.Equals(expectedHash, Sha256(text), StringComparison.OrdinalIgnoreCase)) return;try { AtomicWrite(localPath, Encoding.UTF8.GetBytes(text)); } catch { TryDelete(localPath); } }
        Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(text));if (!envelope.ContainsKey("version") || Convert.ToInt32(envelope["version"], CultureInfo.InvariantCulture) != expectedVersion || !envelope.ContainsKey("ruleSetVersion") || !String.Equals(Convert.ToString(envelope["ruleSetVersion"], CultureInfo.InvariantCulture), ruleSetVersion, StringComparison.Ordinal) || !envelope.ContainsKey("files")) return;
        object[] files = ObjectArray(envelope["files"]);if (files.Length > 100000) return;
        foreach (object value in files)
        {
            Dictionary<string, object> item = ObjectDictionary(value);if (!item.ContainsKey("path") || !item.ContainsKey("name") || !item.ContainsKey("size") || !item.ContainsKey("lastModifiedUnixMs") || !item.ContainsKey("accepted") || !item.ContainsKey("error")) continue;
            string relative = Convert.ToString(item["path"], CultureInfo.InvariantCulture), name = Convert.ToString(item["name"], CultureInfo.InvariantCulture), error = Convert.ToString(item["error"], CultureInfo.InvariantCulture);long size = Convert.ToInt64(item["size"], CultureInfo.InvariantCulture), modified = Convert.ToInt64(item["lastModifiedUnixMs"], CultureInfo.InvariantCulture);
            string normalizedRelative = (relative ?? "").Replace('\\', '/');
            if (String.IsNullOrWhiteSpace(relative) || relative.Length > 32767 || relative.IndexOf('\0') >= 0 || normalizedRelative.StartsWith("System/", StringComparison.OrdinalIgnoreCase) || normalizedRelative.StartsWith("performance-cache/", StringComparison.OrdinalIgnoreCase) || normalizedRelative.IndexOf("/Sync Index/", StringComparison.OrdinalIgnoreCase) >= 0 || normalizedRelative.IndexOf("/Sync Index Shards/", StringComparison.OrdinalIgnoreCase) >= 0 || String.IsNullOrWhiteSpace(name) || name.Length > 500 || size < 0 || modified < 0 || error.Length > 300) continue;
            item["accepted"] = Convert.ToBoolean(item["accepted"], CultureInfo.InvariantCulture);if (item.ContainsKey("encryptedPdf")) item["encryptedPdf"] = Convert.ToBoolean(item["encryptedPdf"], CultureInfo.InvariantCulture);if (item.ContainsKey("externalSharedAddition")) item["externalSharedAddition"] = Convert.ToBoolean(item["externalSharedAddition"], CultureInfo.InvariantCulture);result[relative] = item;
        }
    }

    private static string SyncIndexShardFilename(string organization)
    {
        return String.IsNullOrWhiteSpace(organization) ? "index-root.json" : "index-org-" + Sha256(organization.Trim().ToUpperInvariant()).Substring(0, 20) + ".json";
    }

    private static string SyncIndexOrganization(string relative)
    {
        string[] parts = (relative ?? "").Replace('\\', '/').Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);return parts.Length >= 2 && String.Equals(parts[0], "Organizations", StringComparison.OrdinalIgnoreCase) ? parts[1] : "";
    }

    private void SaveSyncIndex(string root, string ruleSetVersion, List<Dictionary<string, object>> files, string organization = null)
    {
        string directory = Path.Combine(root, SystemDirectoryName, SyncIndexDirectoryName);Directory.CreateDirectory(directory);
        try
        {
            var groups = files.GroupBy(item => SyncIndexOrganization(Convert.ToString(item["path"], CultureInfo.InvariantCulture)), StringComparer.OrdinalIgnoreCase).ToDictionary(group => group.Key, group => group.ToList(), StringComparer.OrdinalIgnoreCase);
            if (!String.IsNullOrWhiteSpace(organization) && !groups.ContainsKey(organization)) groups[organization] = new List<Dictionary<string, object>>();
            var written = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (KeyValuePair<string, List<Dictionary<string, object>>> group in groups)
            {
                string filename = SyncIndexShardFilename(group.Key), indexPath = Path.Combine(directory, filename);written.Add(filename);
                var envelope = new Dictionary<string, object> { { "version", SyncIndexVersion }, { "ruleSetVersion", ruleSetVersion }, { "organization", group.Key }, { "generatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "files", group.Value.ToArray() } };
                string text = json.Serialize(envelope);byte[] bytes = Encoding.UTF8.GetBytes(text);if (bytes.LongLength > SyncIndexLimit) continue;string hash = Sha256(text), currentHash = File.Exists(indexPath + ".sha256") ? ReadSyncIndexChecksum(indexPath + ".sha256", filename) : null;
                if (!String.Equals(hash, currentHash, StringComparison.OrdinalIgnoreCase)) { AtomicWrite(indexPath, bytes);AtomicWrite(indexPath + ".sha256", Encoding.ASCII.GetBytes(hash + "  " + filename + Environment.NewLine)); }
                try { AtomicWrite(Path.Combine(LocalPerformanceCacheDirectory(root, "Sync Index Shards"), filename), bytes); } catch { }
            }
            if (String.IsNullOrWhiteSpace(organization))
            {
                foreach (string stale in Directory.EnumerateFiles(directory, "index-*.json", SearchOption.TopDirectoryOnly).Where(path => !written.Contains(Path.GetFileName(path))).ToArray()) { TryDelete(stale);TryDelete(stale + ".sha256"); }
                TryDelete(SystemFile(root, SyncIndexFilename));TryDelete(SystemFile(root, SyncIndexChecksumFilename));
            }
        }
        catch { }
    }

    private static string ReadSyncIndexChecksum(string path, string filename)
    {
        try { string[] parts = File.ReadAllText(path, Encoding.ASCII).Trim().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);return parts.Length == 2 && String.Equals(parts[1], filename, StringComparison.Ordinal) && IsSha256(parts[0]) ? parts[0].ToLowerInvariant() : null; } catch { return null; }
    }

    public byte[] ReadRelativeFile(string systemId, string relative)
    {
        string root, path = ResolveEvidencePath(systemId, relative, out root);
        var file = new FileInfo(path);
        if (!file.Exists) throw new FileNotFoundException("The selected evidence file no longer exists.");
        if (file.Length > EvidenceLimit) throw new InvalidDataException("The selected evidence file exceeds the size limit.");
        string staged = StagedEvidencePath(root, relative, file.Length, new DateTimeOffset(file.LastWriteTimeUtc).ToUnixTimeMilliseconds(), Path.GetExtension(path));
        try { var stagedInfo = new FileInfo(staged);if (stagedInfo.Exists && stagedInfo.Length == file.Length) return File.ReadAllBytes(staged); } catch { }
        return File.ReadAllBytes(path);
    }

    public string EvidenceLocation(string systemId, string relative)
    {
        string root, path = ResolveEvidencePath(systemId, relative, out root);
        if (!File.Exists(path)) throw new FileNotFoundException("The selected evidence file no longer exists.");
        EnsureReparseSafePath(root, path);
        return path;
    }

    public string ClearEvidenceValidationCache(string systemId)
    {
        PruneEvidenceValidationCache(Root(systemId), true);return "{\"cleared\":true}";
    }

    private EvidenceValidationResult ValidateEvidenceFromLocalStage(string root, PendingEvidenceValidation pending)
    {
        var result = new EvidenceValidationResult();var timer = Stopwatch.StartNew();
        try
        {
            if (pending.HistoricalSaar) { result.Accepted = true;return result; }
            string staged = StagedEvidencePath(root, pending.Relative, pending.Size, pending.LastModifiedUnixMs, Path.GetExtension(pending.File));
            var stagedInfo = new FileInfo(staged);
            if (!stagedInfo.Exists || stagedInfo.Length != pending.Size)
            {
                TryDelete(staged);string temporary = staged + ".tmp-" + Guid.NewGuid().ToString("N");
                try
                {
                    using (var input = File.Open(pending.File, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    using (var output = OpenCompatibleFileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920)) { input.CopyTo(output);FlushCompatible(output); }
                    if (new FileInfo(temporary).Length != pending.Size) throw new IOException("The staged evidence length changed while it was being read.");
                    File.Move(temporary, staged);result.StagedBytes = pending.Size;
                }
                finally { TryDelete(temporary); }
            }
            result.Accepted = TryValidateEvidenceFile(staged, out result.Error, out result.Cacheable, out result.EncryptedPdf);
            long verifiedSize, verifiedModified;string verifiedError;
            if (!TryReadFileMetadata(pending.File, out verifiedSize, out verifiedModified, out verifiedError)) { result.Accepted = false;result.Error = "File metadata could not be rechecked after validation and network-aware retries: " + verifiedError;result.Cacheable = false; }
            else if (verifiedSize != pending.Size || verifiedModified != pending.LastModifiedUnixMs) { result.Accepted = false;result.Error = "The evidence file changed during Sync. Run Sync again.";result.Cacheable = false; }
        }
        catch (Exception error) { result.Accepted = false;result.Cacheable = false;result.Error = CleanLine(error.Message, 300); }
        finally { timer.Stop();result.DurationMilliseconds = timer.ElapsedMilliseconds; }
        return result;
    }

    private string StagedEvidencePath(string root, string relative, long size, long modifiedUnixMs, string extension)
    {
        string key = Sha256(relative.ToUpperInvariant() + "|" + size.ToString(CultureInfo.InvariantCulture) + "|" + modifiedUnixMs.ToString(CultureInfo.InvariantCulture)).Substring(0, 32);
        string safeExtension = String.Equals(extension, ".zip", StringComparison.OrdinalIgnoreCase) ? ".zip" : ".pdf";
        return Path.Combine(EvidenceValidationCacheDirectory(root), key + safeExtension);
    }

    private string EvidenceValidationCacheDirectory(string root)
    {
        string baseDirectory = Path.GetDirectoryName(mappingCachePath);
        if (String.IsNullOrWhiteSpace(baseDirectory)) baseDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InformationSystemUserTracker");
        string rootKey = Sha256(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).ToUpperInvariant()).Substring(0, 12), directory = Path.Combine(baseDirectory, "ev", rootKey);
        Directory.CreateDirectory(directory);return directory;
    }

    private static bool IsNetworkRoot(string root)
    {
        try
        {
            if (root.StartsWith(@"\\", StringComparison.Ordinal)) return true;
            string driveRoot = Path.GetPathRoot(root);return !String.IsNullOrWhiteSpace(driveRoot) && new DriveInfo(driveRoot).DriveType == DriveType.Network;
        }
        catch { return false; }
    }

    private static int AdaptiveValidationConcurrency(string root, long probeMilliseconds, int count)
    {
        if (count <= 1 || probeMilliseconds >= 3000) return 1;
        if (IsNetworkRoot(root)) return probeMilliseconds >= 750 ? 1 : 2;
        return probeMilliseconds >= 1500 ? 2 : Math.Min(4, Math.Max(1, Environment.ProcessorCount / 2));
    }

    private void PruneEvidenceValidationCache(string root, bool removeAll)
    {
        try
        {
            string directory = EvidenceValidationCacheDirectory(root);
            foreach (string file in Directory.EnumerateFiles(directory, "*", SearchOption.TopDirectoryOnly))
            {
                try { if (removeAll || File.GetLastWriteTimeUtc(file) < DateTime.UtcNow.AddMinutes(-30)) TryDelete(file); } catch { }
            }
            if (removeAll && Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory, false);
        }
        catch { }
    }

    public string ReadRenamerQueue(string systemId)
    {
        string path = SystemFile(Root(systemId), RenamerQueueFilename);
        if (!File.Exists(path)) return "null";
        string text = ReadText(path, RenamerQueueLimit);
        object parsed = json.DeserializeObject(text);
        if (!(parsed is Dictionary<string, object>)) throw new InvalidDataException("The saved Document Renamer queue is invalid.");
        return text;
    }

    public string SaveRenamerQueue(string systemId, byte[] bytes)
    {
        if (bytes == null || bytes.LongLength == 0 || bytes.LongLength > RenamerQueueLimit) throw new InvalidDataException("The Document Renamer queue is empty or exceeds the 20 MB limit.");
        string text = new UTF8Encoding(false, true).GetString(bytes);
        var value = json.DeserializeObject(text) as Dictionary<string, object>;
        object rawVersion, rawItems;
        if (value == null || !value.TryGetValue("version", out rawVersion) || Convert.ToInt32(rawVersion, CultureInfo.InvariantCulture) != 1 || !value.TryGetValue("items", out rawItems) || !(rawItems is object[]) || ((object[])rawItems).Length > 10000) throw new InvalidDataException("The Document Renamer queue has an invalid structure.");
        AtomicWrite(SystemFile(Root(systemId), RenamerQueueFilename), bytes);
        return "{\"saved\":true}";
    }

    public string ClearRenamerQueue(string systemId)
    {
        TryDelete(SystemFile(Root(systemId), RenamerQueueFilename));
        return "{\"cleared\":true}";
    }

    public string ArchiveEvidence(string systemId, string relative, string requestedFilename = null, bool allowReworkSource = false)
    {
        lock (RootLock(systemId))
        {
            string root, source = ResolveEvidencePath(systemId, relative, out root);RecoverTransactions(root);string normalized = Relative(root, source);
            if (IsLocalWorkspaceRoot(systemId, root))
            {
                string currentDestination = LocalPublicEvidencePath(systemId, source);
                if (IsArchiveEvidencePath(currentDestination) && normalized.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries).Any(IsCompleteStorageDirectory))
                    return json.Serialize(new Dictionary<string, object> { { "archived", currentDestination }, { "alreadyCompleted", true } });
            }
            if (ContainsManagedStorageDirectory(normalized) && !(allowReworkSource && IsOrganizationReworkEvidencePath(normalized))) throw new InvalidDataException("Only active evidence files can be moved to an organization Archive folder. Collision cleanup may move a verified file from its organization Rework folder.");
            if (!File.Exists(source)) throw new FileNotFoundException("The selected evidence file no longer exists.");
            string validationError;
            if (!TryValidateEvidenceFile(source, out validationError)) throw new InvalidDataException(String.IsNullOrWhiteSpace(validationError) ? "The selected evidence file is invalid." : validationError);
            if (IsLocalWorkspaceRoot(systemId, root)) return json.Serialize(new Dictionary<string, object> { { "archived", StageLocalArchive(systemId, source, requestedFilename) } });
            Tuple<string, string> organization = OrganizationStorageLocation(root, source);
            string filename = SafePart(Path.GetFileName(source), 180), sourceExtension = filename.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase) ? ".pdf.zip" : Path.GetExtension(filename), archiveFilename = String.IsNullOrWhiteSpace(requestedFilename) ? filename : SafePart(requestedFilename, 180);if (String.IsNullOrWhiteSpace(sourceExtension) || !archiveFilename.EndsWith(sourceExtension, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The archive filename must preserve the PDF or ZIP evidence extension.");bool permanentSaar = IsSaarFilename(filename);
            string bucket = permanentSaar ? "Permanent SAAR" : EvidenceOlderThanYears(filename, 5) ? "Superseded" : DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), directory = permanentSaar ? Path.Combine(organization.Item1, SafePart(organization.Item2, 60) + " SAAR Archive") : Path.Combine(organization.Item1, SafePart(organization.Item2, 60) + " Archive", bucket);
            Directory.CreateDirectory(directory);
            string extension = archiveFilename.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase) ? archiveFilename.Substring(archiveFilename.Length - 8) : Path.GetExtension(archiveFilename);archiveFilename = FitFilenameForDirectory(directory, archiveFilename, extension);string stem = archiveFilename.Substring(0, archiveFilename.Length - extension.Length), destination = Path.Combine(directory, archiveFilename);
            for (int index = 1; File.Exists(destination); index++) destination = Path.Combine(directory, stem + "_" + index.ToString(CultureInfo.InvariantCulture) + extension);
            string transaction = BeginTransaction(root, "archive", source, destination, Sha256Bytes(File.ReadAllBytes(source)), "");
            File.Move(source, destination);FailAfter("archive-move");
            if (!String.Equals(Sha256Bytes(File.ReadAllBytes(destination)), Convert.ToString(ObjectDictionary(json.DeserializeObject(ReadText(transaction, 1024 * 1024)))["sourceHash"]), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The archived evidence failed its SHA-256 integrity check.");
            CompleteTransaction(transaction);
            string archived = Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/');
            return json.Serialize(new Dictionary<string, object> { { "archived", archived } });
        }
    }

    private static DateTime? EvidenceDate(string filename)
    {
        string value = filename ?? "";
        var candidates = new List<Tuple<int, DateTime>>();
        AddEvidenceDates(candidates, value, @"(?<![A-Za-z0-9])(0[1-9]|[12][0-9]|3[01])(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)((?:19|20)[0-9]{2})(?![A-Za-z0-9])", "ddMMMyyyy");
        AddEvidenceDates(candidates, value, @"(?<![A-Za-z0-9])(0?[1-9]|[12][0-9]|3[01])[-_., ]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-_., ]+((?:19|20)[0-9]{2})(?![A-Za-z0-9])", "d-MMM-yyyy");
        AddEvidenceDates(candidates, value, @"(?<![A-Za-z0-9])(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-_., ]*(0?[1-9]|[12][0-9]|3[01])[-_., ]*((?:19|20)[0-9]{2})(?![A-Za-z0-9])", "MMM-d-yyyy");
        AddEvidenceDates(candidates, value, @"(?<![A-Za-z0-9])((?:19|20)[0-9]{2})[-_., ]*(0[1-9]|1[0-2])[-_., ]*(0[1-9]|[12][0-9]|3[01])(?![A-Za-z0-9])", "yyyy-MM-dd");
        AddEvidenceDates(candidates, value, @"(?<![A-Za-z0-9])(0[1-9]|1[0-2])[-_., ]*(0[1-9]|[12][0-9]|3[01])[-_., ]*((?:19|20)[0-9]{2})(?![A-Za-z0-9])", "MM-dd-yyyy");
        if (candidates.Count == 0) return null;
        return candidates.OrderByDescending(item => item.Item1).First().Item2.Date;
    }

    private static void AddEvidenceDates(List<Tuple<int, DateTime>> candidates, string value, string pattern, string format)
    {
        foreach (Match match in Regex.Matches(value, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            DateTime date;
            string token = Regex.Replace(match.Value, "[-_., ]+", "-"), effectiveFormat = token.IndexOf('-') >= 0 ? format : format.Replace("-", "");
            if (DateTime.TryParseExact(token, effectiveFormat, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out date) && date.Year >= 1900 && date.Year <= 2099) candidates.Add(Tuple.Create(match.Index, date.Date));
        }
    }

    private static bool EvidenceOlderThanYears(string filename, int years) { DateTime? date = EvidenceDate(filename);return date.HasValue && date.Value < DateTime.UtcNow.Date.AddYears(-years); }

    private static string FitFilenameForDirectory(string directory, string filename, string extension)
    {
        const int safeFullPathLength = 240;
        int available = safeFullPathLength - directory.Length - 1;
        if (filename.Length <= available) return filename;
        if (available <= extension.Length + 18) throw new PathTooLongException("The archive folder path leaves too little space for a safe evidence filename.");
        string stem = filename.Substring(0, filename.Length - extension.Length), hash = Sha256(filename).Substring(0, 12).ToUpperInvariant();
        int content = available - extension.Length - hash.Length - 2;Match conflict = Regex.Match(stem, @"_CONFLICT_[A-F0-9]{8,64}(?:_[0-9]{1,3})?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);int requiredTail = conflict.Success ? conflict.Length : 0, tailLength = Math.Min(stem.Length, Math.Max(requiredTail, Math.Min(32, content / 2))), headLength = content - tailLength;
        if (headLength < 1) { headLength = 1;tailLength = content - headLength; }
        return stem.Substring(0, Math.Min(headLength, stem.Length)) + "_" + hash + "_" + stem.Substring(Math.Max(0, stem.Length - tailLength)) + extension;
    }

    public string ProcessReworkRetention(string systemId) { return ProcessReworkRetention(systemId, "legacy", true, null, true); }

    public string ProcessReworkRetention(string systemId, string ruleSetVersion, bool forceFull) { return ProcessReworkRetention(systemId, ruleSetVersion, forceFull, null, true); }

    public string ProcessReworkRetention(string systemId, string ruleSetVersion, bool forceFull, string organization)
    {
        return ProcessReworkRetention(systemId, ruleSetVersion, forceFull, organization, true);
    }

    public string ProcessReworkRetention(string systemId, string ruleSetVersion, bool forceFull, string organization, bool legacyImport)
    {
        lock (RootLock(systemId))
        {
            string root = SyncOperationRoot(systemId, forceFull, legacyImport), cleanOrganization = String.IsNullOrWhiteSpace(organization) ? null : ValidOrganizationName(organization), scanRoot = OrganizationScopeRoot(root, cleanOrganization);bool localWorkspace = IsLocalWorkspaceRoot(systemId, root);RecoverTransactions(root);
            string cleanRuleSet = CleanLine(ruleSetVersion, 100);if (String.IsNullOrWhiteSpace(cleanRuleSet)) cleanRuleSet = "legacy";
            string today = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), systemDirectory = Path.Combine(root, SystemDirectoryName), markerName = cleanOrganization == null ? RetentionMarkerFilename : ".retention-sweep-" + SafePart(cleanOrganization, 60) + ".txt", markerPath = Path.Combine(systemDirectory, markerName);
            bool fastDaily = !forceFull && !legacyImport, dailyFullSweep = forceFull;try { dailyFullSweep = dailyFullSweep || !fastDaily && (!File.Exists(markerPath) || !String.Equals(ReadText(markerPath, 128).Trim(), today, StringComparison.Ordinal)); } catch { dailyFullSweep = !fastDaily; }
            Dictionary<string, Dictionary<string, object>> previous = dailyFullSweep ? new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase) : LoadSyncIndex(root, cleanRuleSet, cleanOrganization);
            var errors = new List<Dictionary<string, object>>();
            var moved = new List<Dictionary<string, object>>();
            var compressed = new List<Dictionary<string, object>>();
            var deleted = new List<Dictionary<string, object>>();
            var preserved = new List<Dictionary<string, object>>();
            var pending = new Stack<Tuple<string, int, bool, bool, bool, bool>>();
            pending.Push(Tuple.Create(scanRoot, 0, false, false, false, false));
            int scanned = 0, skippedSaar = 0, currentFiles = 0, undated = 0, unchangedSkipped = 0;
            while (pending.Count > 0)
            {
                Tuple<string, int, bool, bool, bool, bool> current = pending.Pop();
                if (current.Item2 > 25) { errors.Add(RetentionError(root, current.Item1, "Folder nesting limit exceeded during the Archive preflight."));continue; }
                DirectoryScanEntry[] directoryEntries;
                try { directoryEntries = EnumerateDirectoryEntries(root, current.Item1); }
                catch (Exception error) { errors.Add(RetentionError(root, current.Item1, CleanLine(error.Message, 300)));directoryEntries = new DirectoryScanEntry[0]; }
                foreach (DirectoryScanEntry sourceEntry in directoryEntries.Where(item => !item.IsDirectory))
                {
                    string source = sourceEntry.Path;
                    if (fastDaily && !current.Item5 && !current.Item6) continue;
                    if (scanned >= 100000) { errors.Add(RetentionError(root, current.Item1, "Archive preflight file limit exceeded."));break; }
                    string filename = Path.GetFileName(source);
                    if (!dailyFullSweep && current.Item3) { unchangedSkipped++;continue; }
                    if (!dailyFullSweep && !current.Item5)
                    {
                        string relative = Relative(root, source).Replace(Path.DirectorySeparatorChar, '/');Dictionary<string, object> cached;long size = sourceEntry.HasMetadata ? sourceEntry.Size : 0L, modified = sourceEntry.HasMetadata ? sourceEntry.LastModifiedUnixMs : 0L;
                        if (!sourceEntry.HasMetadata) try { var metadata = new FileInfo(source);size = metadata.Length;modified = new DateTimeOffset(metadata.LastWriteTimeUtc).ToUnixTimeMilliseconds(); } catch { }
                        if (previous.TryGetValue(relative, out cached) && JournalItemMatches(cached, filename, size, modified)) { unchangedSkipped++;continue; }
                    }
                    if (IsOperatorMarkedIncomplete(filename))
                    {
                        scanned++;
                        try
                        {
                            string relative = Relative(root, source).Replace(Path.DirectorySeparatorChar, '/'), hash = Sha256Bytes(File.ReadAllBytes(source));
                            bool auditRecorded = false;
                            try { AppendAudit(systemId, "PRESERVE OPERATOR-MARKED INCOMPLETE EVIDENCE: " + relative + "; SHA-256 " + hash + "; reason Automatic file deletion is prohibited; operator review required");auditRecorded = true; }
                            catch (Exception auditError) { errors.Add(RetentionError(root, source, "Incomplete evidence was preserved, but its tamper-evident audit entry failed: " + CleanLine(auditError.Message, 220))); }
                            preserved.Add(new Dictionary<string, object> { { "source", relative }, { "sha256", hash }, { "reason", "Operator-marked Incomplete evidence preserved for manual review" }, { "auditRecorded", auditRecorded } });
                        }
                        catch (Exception error) { errors.Add(RetentionError(root, source, "Operator-marked Incomplete preservation audit failed: " + CleanLine(error.Message, 240))); }
                        continue;
                    }
                    bool supported = filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) || filename.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
                    if (!supported)
                    {
                        if (current.Item3 || current.Item5 || IsRootControlFile(root, source)) continue;
                        scanned++;
                        try
                        {
                            Tuple<string, string> orgLocation = OrganizationStorageLocation(root, source);string directory = Path.Combine(orgLocation.Item1, SafePart(orgLocation.Item2, 60) + " Rework");Directory.CreateDirectory(directory);
                            string destination = UniqueDestination(directory, Path.GetFileName(source)), sourceHash = Sha256Bytes(File.ReadAllBytes(source)), transaction = BeginTransaction(root, "rework", source, destination, sourceHash, "");
                            File.Move(source, destination);FailAfter("rework-retention-move");
                            if (!String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The unaccepted-file Rework move failed its SHA-256 integrity check.");
                            CompleteTransaction(transaction);
                            moved.Add(new Dictionary<string, object> { { "source", Relative(root, source).Replace(Path.DirectorySeparatorChar, '/') }, { "archived", Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/') }, { "bucket", "Unaccepted File Format" }, { "evidenceDate", "Not Applicable" } });
                        }
                        catch (Exception error) { errors.Add(RetentionError(root, source, CleanLine(error.Message, 300))); }
                        continue;
                    }
                    scanned++;
                    string effectiveSource = source;
                    if (current.Item5 && effectiveSource.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    {
                        try
                        {
                            string original = Relative(root, effectiveSource).Replace(Path.DirectorySeparatorChar, '/');
                            string extractedPath = ExtractEvidenceZip(root, effectiveSource, current.Item1, "rework-extract", "Rework");
                            effectiveSource = extractedPath;filename = Path.GetFileName(extractedPath);
                            moved.Add(new Dictionary<string, object> { { "source", original }, { "archived", Relative(root, extractedPath).Replace(Path.DirectorySeparatorChar, '/') }, { "bucket", "Rework Extraction" }, { "evidenceDate", "Not Applicable" } });
                        }
                        catch (Exception error) { errors.Add(RetentionError(root, source, "Rework extraction failed: " + CleanLine(error.Message, 260)));continue; }
                    }
                    bool saar = IsSaarFilename(filename), disabledSaar = saar && IsDisabledSaarFilename(filename), archivedSaar = current.Item3 && !current.Item4 && saar;
                    DateTime? evidenceDate = EvidenceDate(filename);bool insideSuperseded = current.Item3 && IsSupersededDirectory(root, current.Item1), datedArchiveRepair = insideSuperseded && !saar && evidenceDate.HasValue && evidenceDate.Value >= DateTime.UtcNow.Date.AddYears(-5);
                    if (current.Item4) continue;
                    if (current.Item3 && !archivedSaar && !datedArchiveRepair) continue;
                    if (!current.Item3 && saar && !disabledSaar) { skippedSaar++;continue; }
                    if (!disabledSaar && !archivedSaar && !datedArchiveRepair)
                    {
                        if (evidenceDate.HasValue) currentFiles++; else undated++;
                        continue;
                    }
                    try
                    {
                        if (localWorkspace)
                        {
                            string original = LocalPublicEvidencePath(systemId, effectiveSource), archived = StageLocalArchive(systemId, effectiveSource, null);
                            moved.Add(new Dictionary<string, object> { { "source", original }, { "archived", archived }, { "bucket", saar ? "Permanent SAAR" : insideSuperseded ? "Superseded" : today }, { "evidenceDate", evidenceDate.HasValue ? evidenceDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "Permanent SAAR" } });continue;
                        }
                        Tuple<string, string> orgLocation = OrganizationStorageLocation(root, effectiveSource);
                        bool permanentSaar = disabledSaar || archivedSaar;string bucket = permanentSaar ? "Permanent SAAR" : evidenceDate.HasValue && evidenceDate.Value < DateTime.UtcNow.Date.AddYears(-5) ? "Superseded" : DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                        string directory = permanentSaar ? Path.Combine(orgLocation.Item1, SafePart(orgLocation.Item2, 60) + " SAAR Archive") : Path.Combine(orgLocation.Item1, SafePart(orgLocation.Item2, 60) + " Archive", bucket), destination;
                        Directory.CreateDirectory(directory);destination = UniqueDestination(directory, filename);
                        string sourceHash = Sha256Bytes(File.ReadAllBytes(effectiveSource)), transaction = BeginTransaction(root, "retention-preflight", effectiveSource, destination, sourceHash, "");
                        File.Move(effectiveSource, destination);FailAfter("rework-retention-move");
                        if (!String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The Archive preflight evidence failed its SHA-256 integrity check.");
                        CompleteTransaction(transaction);
                        moved.Add(new Dictionary<string, object> { { "source", Relative(root, effectiveSource).Replace(Path.DirectorySeparatorChar, '/') }, { "archived", Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/') }, { "bucket", bucket }, { "evidenceDate", evidenceDate.HasValue ? evidenceDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : permanentSaar ? "Permanent SAAR" : "Recognized Filename Year" } });
                    }
                    catch (Exception error) { errors.Add(RetentionError(root, effectiveSource, CleanLine(error.Message, 300))); }
                }
                foreach (DirectoryScanEntry directoryEntry in PrioritizedDirectories(directoryEntries))
                {
                    string directory = directoryEntry.Path;
                    string name = Path.GetFileName(directory);
                    if (localWorkspace && IsCompleteStorageDirectory(name)) continue;
                    bool isSaarArchive = name.EndsWith(" SAAR Archive", StringComparison.OrdinalIgnoreCase);
                    bool isIncoming = IsIncomingStorageDirectory(name);
                    bool reparsePoint = directoryEntry.IsReparsePoint || !directoryEntry.HasAttributes && IsScanReparsePoint(root, directory);
                    if (current.Item3 || name.EndsWith(" Archive", StringComparison.OrdinalIgnoreCase)) { if (!fastDaily && !reparsePoint) pending.Push(Tuple.Create(directory, current.Item2 + 1, true, current.Item4 || isSaarArchive, false, false));continue; }
                    if (IsReworkStorageDirectory(name)) { pending.Push(Tuple.Create(directory, current.Item2 + 1, false, false, true, false));continue; }
                    if (isIncoming) { pending.Push(Tuple.Create(directory, current.Item2 + 1, false, false, false, true));continue; }
                    if (IsManagedStorageDirectory(name) || IsArtifactStorageDirectory(name) || reparsePoint) continue;
                    pending.Push(Tuple.Create(directory, current.Item2 + 1, false, false, false, false));
                }
            }
            if (!fastDaily) { Directory.CreateDirectory(systemDirectory);AtomicWrite(markerPath, Encoding.ASCII.GetBytes(today + Environment.NewLine)); }
            return json.Serialize(new Dictionary<string, object> { { "moved", moved.ToArray() }, { "compressed", compressed.ToArray() }, { "deleted", deleted.ToArray() }, { "preserved", preserved.ToArray() }, { "errors", errors.ToArray() }, { "scanned", scanned }, { "skippedSaar", skippedSaar }, { "current", currentFiles }, { "undated", undated }, { "dailyFullSweep", dailyFullSweep }, { "unchangedSkipped", unchangedSkipped } });
        }
    }

    public string RunSyncPipeline(string systemId, string ruleSetVersion, bool forceFull, string organization, bool legacyImport)
    {
        lock (RootLock(systemId))
        {
            string root = SyncOperationRoot(systemId, forceFull, legacyImport), requestedOrganization = organization, suggestedOrganization = null;bool noHintChanges = false;int dirtyHintCount = 0;bool hintAvailable = false;
            if (!forceFull && !legacyImport && String.IsNullOrWhiteSpace(organization)) { suggestedOrganization = SuggestedChangeHintOrganization(systemId, out noHintChanges, out dirtyHintCount);hintAvailable = noHintChanges || !String.IsNullOrWhiteSpace(suggestedOrganization); }
            threadPriorityOrganization = suggestedOrganization;
            PruneEvidenceValidationCache(root, false);var total = Stopwatch.StartNew();BeginEnumerationSnapshot();
            try
            {
                var retentionTimer = Stopwatch.StartNew();Dictionary<string, object> retention = ObjectDictionary(json.DeserializeObject(ProcessReworkRetention(systemId, ruleSetVersion, forceFull, organization, legacyImport)));retentionTimer.Stop();
                int mutations = ObjectArray(retention["moved"]).Length + ObjectArray(retention["compressed"]).Length + ObjectArray(retention["deleted"]).Length;bool snapshotInvalidated = mutations > 0;
                if (snapshotInvalidated) ResetEnumerationSnapshot();
                var scanTimer = Stopwatch.StartNew();Dictionary<string, object> scan = ObjectDictionary(json.DeserializeObject(ScanWithJournal(systemId, ruleSetVersion, forceFull, organization, legacyImport))), scanDiagnostics = scan.ContainsKey("diagnostics") ? ObjectDictionary(scan["diagnostics"]) : new Dictionary<string, object>();scanTimer.Stop();total.Stop();
                var diagnostics = new Dictionary<string, object> { { "totalDurationMs", total.ElapsedMilliseconds }, { "retentionDurationMs", retentionTimer.ElapsedMilliseconds }, { "scanDurationMs", scanTimer.ElapsedMilliseconds }, { "enumerationCacheHits", threadEnumerationSnapshotHits }, { "enumerationCacheMisses", threadEnumerationSnapshotMisses }, { "singlePassReused", threadEnumerationSnapshotHits > 0 && !snapshotInvalidated }, { "snapshotInvalidatedByMutations", snapshotInvalidated }, { "mutations", mutations }, { "scope", String.IsNullOrWhiteSpace(organization) ? "system" : CleanLine(organization, 100) }, { "requestedScope", String.IsNullOrWhiteSpace(requestedOrganization) ? "system" : CleanLine(requestedOrganization, 100) }, { "mode", legacyImport ? "legacy" : forceFull ? "full" : "daily" }, { "changeHintAvailable", hintAvailable }, { "changeHintNoChanges", noHintChanges }, { "changeHintOrganization", suggestedOrganization ?? "" }, { "dirtyHintCount", dirtyHintCount } };
                foreach (string metric in new[] { "enumerationDurationMs", "validationDurationMs", "discoveredFiles", "changedFiles", "unchangedFiles", "stagedBytes", "validationConcurrency", "slowValidationFiles", "maxValidationDurationMs", "networkRoot" }) if (scanDiagnostics.ContainsKey(metric)) diagnostics[metric] = scanDiagnostics[metric];
                AppendPerformanceDiagnostic(root, new Dictionary<string, object>(diagnostics) { { "operation", "sync-pipeline" } });
                CompleteChangeHintScan(systemId, organization, String.IsNullOrWhiteSpace(requestedOrganization));
                return json.Serialize(new Dictionary<string, object> { { "retention", retention }, { "scan", scan }, { "diagnostics", diagnostics } });
            }
            finally { threadPriorityOrganization = null;EndEnumerationSnapshot(); }
        }
    }

    private static bool IsCompleteStorageDirectory(string name) { return String.Equals(name, "Complete", StringComparison.OrdinalIgnoreCase) || name.EndsWith(" Complete", StringComparison.OrdinalIgnoreCase); }

    private static bool IsReworkStorageDirectory(string name) { return String.Equals(name, "Rework", StringComparison.OrdinalIgnoreCase) || name.EndsWith(" Rework", StringComparison.OrdinalIgnoreCase); }
    private static bool IsSupersededDirectory(string root, string directory) { return Relative(root, directory).Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries).Any(part => String.Equals(part, "Superseded", StringComparison.OrdinalIgnoreCase)); }
    private static bool IsSaarFilename(string filename) { return (filename ?? "").IndexOf("SAAR", StringComparison.OrdinalIgnoreCase) >= 0; }
    private static bool IsDisabledSaarFilename(string filename) { return IsSaarFilename(filename) && Regex.IsMatch(filename ?? "", @"(?:^|[^A-Za-z0-9])DISABLED(?:[^A-Za-z0-9]|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant); }
    private static bool IsOperatorMarkedIncomplete(string filename) { return Regex.IsMatch(filename ?? "", @"(?:^|[^A-Za-z0-9])INCOMPLETE(?:[^A-Za-z0-9]|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant); }
    private static bool IsRootControlFile(string root, string path)
    {
        if (!String.Equals(Path.GetDirectoryName(path).TrimEnd(Path.DirectorySeparatorChar), root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) return false;
        string name = Path.GetFileName(path);
        return String.Equals(name, "tracker-active-session.json", StringComparison.OrdinalIgnoreCase) || String.Equals(name, "tracker-exclusive-session.lock", StringComparison.OrdinalIgnoreCase) || String.Equals(name, ManifestFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(name, ManifestChecksumFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(name, SyncIndexFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(name, SyncIndexChecksumFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(name, RenamerQueueFilename, StringComparison.OrdinalIgnoreCase);
    }
    private static Dictionary<string, object> RetentionError(string root, string path, string message) { return new Dictionary<string, object> { { "path", Relative(root, path).Replace(Path.DirectorySeparatorChar, '/') }, { "message", message } }; }
    private static string UniqueDestination(string directory, string filename)
    {
        string safeName = Path.GetFileName(filename), extension = Path.GetExtension(safeName), stem = Path.GetFileNameWithoutExtension(safeName), destination = Path.Combine(directory, safeName);
        for (int index = 1; File.Exists(destination); index++) destination = Path.Combine(directory, stem + "_" + index.ToString(CultureInfo.InvariantCulture) + extension);
        return destination;
    }

    public string MoveEvidenceToRework(string systemId, string relative)
    {
        lock (RootLock(systemId))
        {
            string root, source = ResolveEvidencePath(systemId, relative, out root);RecoverTransactions(root);string normalized = Relative(root, source);
            if (ContainsManagedStorageDirectory(normalized)) throw new InvalidDataException("Only active correction evidence can be moved to an organization Rework folder.");
            bool sourceIsPdf = source.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase), sourceIsZip = source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
            if (!sourceIsPdf && !sourceIsZip) throw new InvalidDataException("Only a PDF or a ZIP containing one PDF can be moved to Rework.");
            if (!File.Exists(source)) throw new FileNotFoundException("The selected correction evidence no longer exists.");
            Tuple<string, string> organization = OrganizationStorageLocation(root, source);
            string directory = Path.Combine(organization.Item1, SafePart(organization.Item2, 60) + " Rework"), filename = SafePart(Path.GetFileName(source), 180);
            Directory.CreateDirectory(directory);
            if (sourceIsZip)
            {
                string extractedDestination = ExtractEvidenceZip(root, source, directory, "rework-extract", "Rework");
                if (IsLocalWorkspaceRoot(systemId, root)) ForgetLocalEvidence(systemId, source);
                string extracted = Relative(root, extractedDestination).Replace(Path.DirectorySeparatorChar, '/');
                return json.Serialize(new Dictionary<string, object> { { "reworked", extracted }, { "extracted", true }, { "sourceRemoved", false }, { "sourcePreserved", true } });
            }
            string extension = Path.GetExtension(filename), stem = Path.GetFileNameWithoutExtension(filename), destination = Path.Combine(directory, filename);
            for (int index = 1; File.Exists(destination); index++) destination = Path.Combine(directory, stem + "_" + index.ToString(CultureInfo.InvariantCulture) + extension);
            string sourceHash = Sha256Bytes(File.ReadAllBytes(source)), transaction = BeginTransaction(root, "rework", source, destination, sourceHash, "");
            File.Move(source, destination);FailAfter("rework-move");
            if (!String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The Rework move failed its SHA-256 integrity check.");
            CompleteTransaction(transaction);
            if (IsLocalWorkspaceRoot(systemId, root)) ForgetLocalEvidence(systemId, source);
            string reworked = Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/');
            return json.Serialize(new Dictionary<string, object> { { "reworked", reworked }, { "extracted", false }, { "sourceRemoved", true } });
        }
    }

    public string ListUnarchiveCandidates(string systemId, string[] selectedPaths, bool recursive)
    {
        lock (RootLock(systemId))
        {
            string root = Root(systemId);RecoverTransactions(root);
            if (selectedPaths == null || selectedPaths.Length == 0 || selectedPaths.Length > 10000) throw new InvalidDataException("Select between one and 10,000 ZIP files or one folder beneath the mapped system folder.");
            var candidates = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
            foreach (string selectedPath in selectedPaths)
            {
                string selected = SafeSelectedPath(root, selectedPath);
                if (File.Exists(selected))
                {
                    AddUnarchiveCandidate(root, selected, candidates);
                    continue;
                }
                if (!Directory.Exists(selected)) throw new FileNotFoundException("The selected Unarchive folder or ZIP file no longer exists.");
                if (!recursive) throw new InvalidDataException("Select ZIP files when file-selection mode is used.");
                var pending = new Stack<Tuple<string, int>>();pending.Push(Tuple.Create(selected, 0));
                while (pending.Count > 0)
                {
                    Tuple<string, int> current = pending.Pop();
                    if (current.Item2 > 25) throw new InvalidDataException("Folder nesting exceeds the Unarchive selection limit.");
                    foreach (string file in EnumerateScanFiles(root, current.Item1))
                    {
                        AddUnarchiveCandidate(root, file, candidates);
                        if (candidates.Count > 10000) throw new InvalidDataException("More than 10,000 ZIP files were found. Select a smaller folder.");
                    }
                    foreach (string directory in EnumerateScanDirectories(root, current.Item1)) if (!IsScanReparsePoint(root, directory)) pending.Push(Tuple.Create(directory, current.Item2 + 1));
                }
            }
            object[] items = candidates.Values.OrderBy(item => Convert.ToString(item["path"], CultureInfo.InvariantCulture), StringComparer.OrdinalIgnoreCase).Cast<object>().ToArray();
            return json.Serialize(new Dictionary<string, object> { { "cancelled", false }, { "items", items } });
        }
    }

    public string UnarchiveEvidence(string systemId, string relative)
    {
        lock (RootLock(systemId))
        {
            string root, source = ResolveEvidencePath(systemId, relative, out root);RecoverTransactions(root);
            if (!File.Exists(source)) throw new FileNotFoundException("The selected ZIP evidence no longer exists.");
            if (!source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Only a ZIP containing exactly one PDF can be unarchived.");
            string destination = ExtractEvidenceZip(root, source, Path.GetDirectoryName(source), "unarchive-extract", "Unarchive"), unarchived = Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/');
            return json.Serialize(new Dictionary<string, object> { { "unarchived", unarchived }, { "sourceRemoved", false }, { "sourcePreserved", true } });
        }
    }

    private static void AddUnarchiveCandidate(string root, string path, Dictionary<string, Dictionary<string, object>> candidates)
    {
        if (!path.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) return;
        string relative = Relative(root, path).Replace(Path.DirectorySeparatorChar, '/'), folder = Path.GetDirectoryName(relative) ?? "";
        candidates[relative] = new Dictionary<string, object> { { "path", relative }, { "filename", Path.GetFileName(path) }, { "folder", folder.Replace(Path.DirectorySeparatorChar, '/') }, { "size", new FileInfo(path).Length } };
    }

    private string ExtractEvidenceZip(string root, string source, string directory, string operation, string label)
    {
        string validationError;if (!TryValidateEvidenceFile(source, out validationError)) throw new InvalidDataException(String.IsNullOrWhiteSpace(validationError) ? "The selected ZIP evidence is invalid." : validationError);
        string embeddedName, sourceName = SafePart(Path.GetFileName(source), 180);
        using (Stream input = File.Open(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        using (var archive = new ZipArchive(input, ZipArchiveMode.Read, false)) embeddedName = Path.GetFileName(archive.Entries.Single(entry => !entry.FullName.EndsWith("/", StringComparison.Ordinal)).FullName);
        string filename = sourceName.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase) ? sourceName.Substring(0, sourceName.Length - 4) : SafePart(embeddedName, 180);
        if (!filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) filename = SafePart(Path.GetFileNameWithoutExtension(filename), 175) + ".pdf";
        string exactDestination = Path.Combine(directory, filename), sourcePdfHash = EvidencePdfSha256(source);
        if (File.Exists(exactDestination))
        {
            string existingError;
            if (TryValidateEvidenceFile(exactDestination, out existingError) && String.Equals(sourcePdfHash, EvidencePdfSha256(exactDestination), StringComparison.OrdinalIgnoreCase)) return exactDestination;
        }
        string destination = UniqueDestination(directory, filename), temporary = Path.Combine(directory, ".isut-" + Guid.NewGuid().ToString("N") + ".tmp"), sourceHash = Sha256Bytes(File.ReadAllBytes(source)), destinationHash = "", transaction = null;
        try
        {
            using (Stream input = File.Open(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (var archive = new ZipArchive(input, ZipArchiveMode.Read, false))
            using (Stream entry = archive.Entries.Single(item => !item.FullName.EndsWith("/", StringComparison.Ordinal)).Open())
            using (var output = OpenCompatibleFileStream(temporary, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 81920)) { entry.CopyTo(output);FlushCompatible(output);output.Position = 0;ValidatePdfStream(output, filename, output.Length); }
            destinationHash = Sha256Bytes(File.ReadAllBytes(temporary));transaction = BeginTransaction(root, operation, source, destination, sourceHash, destinationHash);
            File.Move(temporary, destination);FailAfter(operation + "-move");
            if (!String.Equals(destinationHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The extracted " + label + " PDF failed its SHA-256 integrity check.");
            CompleteTransaction(transaction);
            return destination;
        }
        catch { TryDelete(temporary);throw; }
    }

    public string OrganizeEvidence(string systemId, string relative, string folder)
    {
        lock (RootLock(systemId))
        {
            string root, source = ResolveEvidencePath(systemId, relative, out root);RecoverTransactions(root);string normalized = Relative(root, source), safeFolder = SafePart(folder, 60);
            if (!ArtifactDirectoryNames.Any(item => String.Equals(item, safeFolder, StringComparison.OrdinalIgnoreCase)) || !String.Equals(safeFolder, folder, StringComparison.Ordinal)) throw new InvalidDataException("The evidence document-type folder is invalid.");
            if (ContainsManagedStorageDirectory(normalized) && !IsOrganizationReworkEvidencePath(normalized)) throw new InvalidDataException("Only active evidence or corrected evidence in an organization Rework folder can be organized by document type.");
            if (!File.Exists(source)) throw new FileNotFoundException("The selected evidence file no longer exists.");
            string validationError;if (!TryValidateEvidenceFile(source, out validationError)) throw new InvalidDataException(String.IsNullOrWhiteSpace(validationError) ? "The selected evidence file is invalid." : validationError);
            Tuple<string, string> organization = OrganizationStorageLocation(root, source);bool local = IsLocalWorkspaceRoot(systemId, root);string canonicalFolder = OrganizationArtifactStorageFolder(safeFolder, organization.Item2), directory = local ? LocalIncomingDirectory(systemId, organization.Item2) : Path.Combine(organization.Item1, canonicalFolder);Directory.CreateDirectory(directory);
            string canonical = Path.Combine("Organizations", organization.Item2, canonicalFolder, Path.GetFileName(source)).Replace(Path.DirectorySeparatorChar, '/'), previous = local ? LocalPublicEvidencePath(systemId, source) : relative;
            string destination = Path.Combine(directory, Path.GetFileName(source));
            if (String.Equals(source, destination, StringComparison.OrdinalIgnoreCase)) { if (local) RegisterLocalEvidence(systemId, source, canonical, previous);return json.Serialize(new Dictionary<string, object> { { "organized", local ? canonical : Relative(root, source).Replace(Path.DirectorySeparatorChar, '/') }, { "alreadyCompleted", true } }); }
            if (File.Exists(destination)) return json.Serialize(new Dictionary<string, object> { { "organized", local ? previous : Relative(root, source).Replace(Path.DirectorySeparatorChar, '/') }, { "collision", true }, { "existing", local ? canonical : Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/') } });
            string sourceHash = Sha256Bytes(File.ReadAllBytes(source)), transaction = BeginTransaction(root, "organize", source, destination, sourceHash, "");
            File.Move(source, destination);FailAfter("organize-move");
            try { if (!String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The organized evidence failed its SHA-256 integrity check."); }
            catch { if (!File.Exists(source) && File.Exists(destination)) File.Move(destination, source);throw; }
            CompleteTransaction(transaction);
            if (local) RegisterLocalEvidence(systemId, destination, canonical, previous);
            return json.Serialize(new Dictionary<string, object> { { "organized", local ? canonical : Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/') } });
        }
    }

    public string NormalizeEvidenceFilename(string systemId, string relative, string filename)
    {
        lock (RootLock(systemId))
        {
            string root, source = ResolveEvidencePath(systemId, relative, out root);RecoverTransactions(root);string normalized = Relative(root, source);
            if (ContainsManagedStorageDirectory(normalized) && !IsOrganizationReworkEvidencePath(normalized)) throw new InvalidDataException("Only active evidence or evidence in an organization Rework folder can be normalized.");
            if (!File.Exists(source)) throw new FileNotFoundException("The selected evidence file no longer exists.");
            string safeName = SafePart(filename, 180);
            if (!String.Equals(safeName, filename, StringComparison.Ordinal) || !String.Equals(Path.GetFileName(filename), filename, StringComparison.Ordinal)) throw new InvalidDataException("The normalized evidence filename is invalid or too long.");
            string sourceExtension = Path.GetExtension(source), targetExtension = Path.GetExtension(safeName);
            if ((!sourceExtension.Equals(".pdf", StringComparison.OrdinalIgnoreCase) && !sourceExtension.Equals(".zip", StringComparison.OrdinalIgnoreCase)) || !sourceExtension.Equals(targetExtension, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The normalized filename must preserve the PDF or ZIP extension.");
            bool local = IsLocalWorkspaceRoot(systemId, root);string previous = local ? LocalPublicEvidencePath(systemId, source) : relative, canonical = previous.Substring(0, previous.LastIndexOf('/') + 1) + safeName;
            string destination = Path.Combine(Path.GetDirectoryName(source), safeName);
            if (String.Equals(source, destination, StringComparison.Ordinal)) return json.Serialize(new Dictionary<string, object> { { "renamed", local ? previous : Relative(root, source).Replace(Path.DirectorySeparatorChar, '/') }, { "alreadyCompleted", true } });
            if (File.Exists(destination)) return json.Serialize(new Dictionary<string, object> { { "renamed", local ? previous : Relative(root, source).Replace(Path.DirectorySeparatorChar, '/') }, { "collision", true }, { "existing", local ? canonical : Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/') } });
            string sourceHash = Sha256Bytes(File.ReadAllBytes(source));
            string transaction = BeginTransaction(root, "rename", source, destination, sourceHash, "");
            File.Move(source, destination);FailAfter("rename-move");
            try
            {
                if (!String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The renamed PDF failed its content-integrity check.");
            }
            catch
            {
                if (!File.Exists(source) && File.Exists(destination)) File.Move(destination, source);
                throw;
            }
            CompleteTransaction(transaction);
            if (local && !String.Equals(previous, Relative(root, source).Replace(Path.DirectorySeparatorChar, '/'), StringComparison.OrdinalIgnoreCase)) RegisterLocalEvidence(systemId, destination, canonical, previous);
            return json.Serialize(new Dictionary<string, object> { { "renamed", local && !String.Equals(previous, Relative(root, source).Replace(Path.DirectorySeparatorChar, '/'), StringComparison.OrdinalIgnoreCase) ? canonical : Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/') } });
        }
    }

    public string RelabelUserEvidence(string systemId, string relative, string organization, string kind, string filename)
    {
        lock (RootLock(systemId))
        {
            string root, source = ResolveEvidencePath(systemId, relative, out root);RecoverTransactions(root);string normalized = Relative(root, source);
            if (ContainsManagedStorageDirectory(normalized)) throw new InvalidDataException("Only active user evidence can be relabeled from the User Record.");
            if (!File.Exists(source)) throw new FileNotFoundException("The selected evidence file no longer exists.");
            string safeOrganization = ValidOrganizationName(organization), folder = ArtifactStorageFolder(kind), safeName = SafePart(filename, 180);
            if (!String.Equals(safeName, filename, StringComparison.Ordinal) || !String.Equals(Path.GetFileName(filename), filename, StringComparison.Ordinal)) throw new InvalidDataException("The relabeled evidence filename is invalid or too long.");
            string sourceExtension = Path.GetExtension(source), targetExtension = Path.GetExtension(safeName);
            if ((!sourceExtension.Equals(".pdf", StringComparison.OrdinalIgnoreCase) && !sourceExtension.Equals(".zip", StringComparison.OrdinalIgnoreCase)) || !sourceExtension.Equals(targetExtension, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The relabeled evidence filename must preserve the PDF or ZIP extension.");
            bool local = IsLocalWorkspaceRoot(systemId, root);string directory = local ? LocalIncomingDirectory(systemId, safeOrganization) : Path.Combine(root, "Organizations", safeOrganization, OrganizationArtifactStorageFolder(folder, safeOrganization));Directory.CreateDirectory(directory);if (!local) EnsureOrganizationDocumentFolders(Path.Combine(root, "Organizations", safeOrganization), safeOrganization, false);
            string destination = Path.Combine(directory, safeName), sourceRelative = local ? LocalPublicEvidencePath(systemId, source) : normalized.Replace(Path.DirectorySeparatorChar, '/'), destinationRelative = local ? Path.Combine("Organizations", safeOrganization, OrganizationArtifactStorageFolder(folder, safeOrganization), safeName).Replace(Path.DirectorySeparatorChar, '/') : Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/');
            if (String.Equals(source, destination, StringComparison.OrdinalIgnoreCase)) return json.Serialize(new Dictionary<string, object> { { "path", sourceRelative }, { "filename", Path.GetFileName(source) }, { "alreadyCompleted", true } });
            if (File.Exists(destination)) return json.Serialize(new Dictionary<string, object> { { "path", sourceRelative }, { "filename", Path.GetFileName(source) }, { "collision", true }, { "existing", destinationRelative } });
            string sourceHash = Sha256Bytes(File.ReadAllBytes(source)), transaction = BeginTransaction(root, "relabel-user-evidence", source, destination, sourceHash, "");
            File.Move(source, destination);FailAfter("relabel-user-evidence-move");
            try { if (!String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The relabeled evidence failed its SHA-256 integrity check."); }
            catch { if (!File.Exists(source) && File.Exists(destination)) File.Move(destination, source);throw; }
            CompleteTransaction(transaction);
            if (local) RegisterLocalEvidence(systemId, destination, destinationRelative, sourceRelative);
            return json.Serialize(new Dictionary<string, object> { { "path", destinationRelative }, { "filename", safeName }, { "sha256", sourceHash } });
        }
    }

    public string CompressEvidence(string systemId, string relative)
    {
        lock (RootLock(systemId))
        {
            string root, source, localRoot = LocalEvidenceRoot(systemId), localSource = null;
            try { localSource = SafeRelativePath(localRoot, relative); } catch (PathTooLongException) { }
            if (!String.IsNullOrEmpty(localSource) && (File.Exists(localSource) || File.Exists(localSource + ".zip"))) { root = localRoot;source = localSource; }
            else { Dictionary<string, object> zipped;if (ReadLocalEvidenceMap(systemId).TryGetValue(relative.Replace('\\', '/') + ".zip", out zipped)) { root = localRoot;source = SafeRelativePath(root, Convert.ToString(zipped["localPath"], CultureInfo.InvariantCulture));source = source.Substring(0, source.Length - 4); } else source = ResolveEvidencePath(systemId, relative, out root); }
            RecoverTransactions(root);string normalized = Relative(root, source);
            if (!IsLocalWorkspaceRoot(systemId, root)) throw new InvalidOperationException("Loose PDFs are compressed only in the protected local workspace. Shared-drive evidence is never modified by the compression workflow.");
            if (ContainsManagedStorageDirectory(normalized)) throw new InvalidDataException("Only active evidence files can be compressed.");
            string previous = File.Exists(source) ? LocalPublicEvidencePath(systemId, source) : relative.Replace('\\', '/');
            bool alreadyCompleted;string destination = CompressEvidenceFile(systemId, root, source, false, out alreadyCompleted), compressed = Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/');
            if (previous.StartsWith("Organizations/", StringComparison.OrdinalIgnoreCase) && !IsOrganizationIncomingEvidencePath(previous) && !IsOrganizationReworkEvidencePath(previous)) { compressed = previous + ".zip";RegisterLocalEvidence(systemId, destination, compressed, previous); }
            if (alreadyCompleted) return json.Serialize(new Dictionary<string, object> { { "compressed", compressed }, { "alreadyCompleted", true }, { "sourceRemoved", true }, { "sourcePreserved", false } });
            return json.Serialize(new Dictionary<string, object> { { "compressed", compressed }, { "sourceRemoved", true }, { "sourcePreserved", false } });
        }
    }

    private string CompressEvidenceFile(string systemId, string root, string source, bool allowManaged) { bool ignored;return CompressEvidenceFile(systemId, root, source, allowManaged, out ignored); }

    private string CompressEvidenceFile(string systemId, string root, string source, bool allowManaged, out bool alreadyCompleted)
    {
        alreadyCompleted = false;
        if (!allowManaged && ContainsManagedStorageDirectory(Relative(root, source))) throw new InvalidDataException("Only active evidence files can be compressed.");
        if (!source.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Only a loose PDF can be compressed.");
        string destination = source + ".zip";
        if (!File.Exists(source))
        {
            string existingError;
            if (File.Exists(destination) && TryValidateEvidenceFile(destination, out existingError)) { alreadyCompleted = true;return destination; }
            throw new FileNotFoundException("The selected PDF no longer exists.");
        }
        if (File.Exists(destination))
        {
            string validationError;
            if (!TryValidateEvidenceFile(source, out validationError)) throw new InvalidDataException(String.IsNullOrWhiteSpace(validationError) ? "The selected PDF is invalid." : validationError);
            string sourcePdfHash = EvidencePdfSha256(source);
            string existingError;
            if (!TryValidateEvidenceFile(destination, out existingError)) throw new IOException("A ZIP with the same filename already exists but is not valid evidence. Both files were preserved for collision review.");
            if (!String.Equals(sourcePdfHash, EvidencePdfSha256(destination), StringComparison.OrdinalIgnoreCase)) throw new IOException("A different PDF already occupies the ZIP compression destination. Both files were preserved for collision review.");
            string existingTransaction = BeginTransaction(root, "compression-delete-source", source, destination, sourcePdfHash, "");
            DeleteCompressedSource(systemId, root, source, destination, sourcePdfHash);CompleteTransaction(existingTransaction);alreadyCompleted = true;return destination;
        }
        string stagingDirectory = Path.Combine(LocalPerformanceCacheDirectory(root, "Compression Staging"), Guid.NewGuid().ToString("N")), stagedPdf = Path.Combine(stagingDirectory, "source.pdf"), stagedZip = Path.Combine(stagingDirectory, "source.pdf.zip"), networkTemporary = Path.Combine(Path.GetDirectoryName(destination), ".isut-" + Guid.NewGuid().ToString("N") + ".tmp.zip");
        try
        {
            Directory.CreateDirectory(stagingDirectory);
            var before = new FileInfo(source);before.Refresh();
            using (Stream input = File.Open(source, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var staged = OpenCompatibleFileStream(stagedPdf, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920)) { input.CopyTo(staged);FlushCompatible(staged); }
            var after = new FileInfo(source);after.Refresh();
            if (!after.Exists || before.Length != after.Length || before.LastWriteTimeUtc != after.LastWriteTimeUtc) throw new IOException("The source PDF changed while it was being staged. Both files were preserved; run Sync again.");
            string validationError;
            if (!TryValidateEvidenceFile(stagedPdf, out validationError)) throw new InvalidDataException(String.IsNullOrWhiteSpace(validationError) ? "The selected PDF is invalid." : validationError);
            string sourcePdfHash = EvidencePdfSha256(stagedPdf);
            using (var output = new FileStream(stagedZip, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
            {
                using (var archive = new ZipArchive(output, ZipArchiveMode.Create, true))
                {
                    ZipArchiveEntry entry = archive.CreateEntry(Path.GetFileName(source), CompressionLevel.Optimal);
                    using (Stream input = File.Open(stagedPdf, FileMode.Open, FileAccess.Read, FileShare.Read))
                    using (Stream target = entry.Open()) input.CopyTo(target);
                }
                output.Position = 0;
                ValidateEvidenceZip(output, Path.GetFileName(destination));
                FlushCompatible(output);
            }
            using (Stream input = File.Open(stagedZip, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var output = OpenCompatibleFileStream(networkTemporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920)) { input.CopyTo(output);FlushCompatible(output); }
            string uploadedError;
            if (!TryValidateEvidenceFile(networkTemporary, out uploadedError) || !String.Equals(sourcePdfHash, EvidencePdfSha256(networkTemporary), StringComparison.OrdinalIgnoreCase)) throw new IOException("The locally compressed evidence failed verification after transfer to the shared folder. The source PDF was preserved.");
            string transaction = BeginTransaction(root, "compression-delete-source", source, destination, sourcePdfHash, "");
            File.Move(networkTemporary, destination);FailAfter("compression-move");
            try { DeleteCompressedSource(systemId, root, source, destination, sourcePdfHash);CompleteTransaction(transaction); }
            catch { if (File.Exists(source)) TryDelete(destination);throw; }
        }
        catch { TryDelete(networkTemporary);throw; }
        finally
        {
            TryDelete(stagedZip);TryDelete(stagedPdf);
            try { if (Directory.Exists(stagingDirectory)) Directory.Delete(stagingDirectory, false); } catch { }
        }
        return destination;
    }

    private void DeleteCompressedSource(string systemId, string root, string source, string destination, string expectedPdfHash)
    {
        if (!File.Exists(source)) return;
        string workspaceRoot = LocalWorkspaceRoot(systemId);
        if (!String.Equals(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(workspaceRoot).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Compressed source PDFs may be removed only from the protected local workspace.");
        string validationError;
        if (!TryValidateEvidenceFile(destination, out validationError) || !String.Equals(expectedPdfHash, EvidencePdfSha256(destination), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The verified ZIP no longer matches its source PDF. The original PDF was retained.");
        File.Delete(source);
        if (File.Exists(source)) throw new IOException("The original PDF could not be removed after ZIP verification.");
        FailAfter("compression-source-delete");
    }

    private bool IsLocalWorkspaceRoot(string systemId, string root)
    {
        return String.Equals(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(LocalWorkspaceRoot(systemId)).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
    }

    public string StoreEvidence(string systemId, string organization, string kind, string filename, byte[] bytes)
    {
        if (bytes.Length > EvidenceLimit) throw new InvalidDataException("The compressed evidence exceeds the size limit.");
        string entry = SafePart(filename, 180), zipName = entry.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ? entry : entry + ".zip";
        if (!entry.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Stored evidence must be a ZIP containing exactly one PDF.");
        try { using (var memory = new MemoryStream(bytes, false)) ValidateEvidenceZip(memory, zipName); }
        catch (InvalidDataException) { throw; }
        catch (Exception) { throw new InvalidDataException("The evidence ZIP is invalid or unreadable."); }
        lock (RootLock(systemId))
        {
            string safeOrganization = ValidOrganizationName(organization), directory = LocalIncomingDirectory(systemId, safeOrganization), destination = Path.Combine(directory, zipName), canonical = Path.Combine("Organizations", safeOrganization, OrganizationArtifactStorageFolder(ArtifactStorageFolder(kind), safeOrganization), zipName).Replace(Path.DirectorySeparatorChar, '/');
            AtomicWrite(destination, bytes);RegisterLocalEvidence(systemId, destination, canonical);
        }
        return zipName;
    }

    public string StoreEvidencePdf(string systemId, string organization, string kind, string filename, byte[] pdfBytes)
    {
        if (pdfBytes == null || pdfBytes.Length == 0) throw new InvalidDataException("The evidence PDF is empty.");
        if (pdfBytes.Length > EvidenceLimit) throw new InvalidDataException("The evidence PDF exceeds the size limit.");
        string zipName = SafePart(filename, 180);
        if (!zipName.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase) || !String.Equals(zipName, filename, StringComparison.Ordinal)) throw new InvalidDataException("The stored evidence filename must end with .pdf.zip.");
        string pdfName = zipName.Substring(0, zipName.Length - 4), root = LocalEvidenceRoot(systemId), stagingDirectory = Path.Combine(LocalPerformanceCacheDirectory(Root(systemId), "Manual Evidence Staging"), Guid.NewGuid().ToString("N")), stagedPdf = Path.Combine(stagingDirectory, "source.pdf"), stagedZip = Path.Combine(stagingDirectory, "source.pdf.zip");
        try
        {
            Directory.CreateDirectory(stagingDirectory);
            using (var output = OpenCompatibleFileStream(stagedPdf, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920)) { output.Write(pdfBytes, 0, pdfBytes.Length);FlushCompatible(output); }
            string validationError;
            if (!TryValidateEvidenceFile(stagedPdf, out validationError)) throw new InvalidDataException(String.IsNullOrWhiteSpace(validationError) ? "The evidence PDF is invalid." : validationError);
            using (var output = new FileStream(stagedZip, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
            {
                using (var archive = new ZipArchive(output, ZipArchiveMode.Create, true))
                {
                    ZipArchiveEntry entry = archive.CreateEntry(pdfName, CompressionLevel.Optimal);
                    using (Stream input = File.Open(stagedPdf, FileMode.Open, FileAccess.Read, FileShare.Read))
                    using (Stream target = entry.Open()) input.CopyTo(target);
                }
                output.Position = 0;ValidateEvidenceZip(output, zipName);FlushCompatible(output);
            }
            byte[] zipBytes = File.ReadAllBytes(stagedZip);
            if (zipBytes.Length > EvidenceLimit) throw new InvalidDataException("The compressed evidence exceeds the size limit.");
            lock (RootLock(systemId))
            {
                string safeOrganization = ValidOrganizationName(organization), directory = LocalIncomingDirectory(systemId, safeOrganization), destination = Path.Combine(directory, zipName);
                Directory.CreateDirectory(directory);AtomicWrite(destination, zipBytes);
                string storedError;
                if (!TryValidateEvidenceFile(destination, out storedError)) throw new IOException(String.IsNullOrWhiteSpace(storedError) ? "The stored evidence failed verification." : storedError);
                string sha256 = TryFileHash(destination), relative = Path.Combine("Organizations", safeOrganization, OrganizationArtifactStorageFolder(ArtifactStorageFolder(kind), safeOrganization), zipName).Replace(Path.DirectorySeparatorChar, '/');
                RegisterLocalEvidence(systemId, destination, relative);
                if (!IsSha256(sha256)) throw new IOException("The stored evidence failed SHA-256 verification.");
                return json.Serialize(new Dictionary<string, object> { { "filename", zipName }, { "path", relative }, { "sha256", sha256 } });
            }
        }
        finally
        {
            TryDelete(stagedZip);TryDelete(stagedPdf);
            try { if (Directory.Exists(stagingDirectory)) Directory.Delete(stagingDirectory, false); } catch { }
        }
    }

    public string VerifyStoredEvidence(string systemId, string organization, string kind, string filename, string expectedSha256)
    {
        string expected = CleanLine(expectedSha256, 64).ToLowerInvariant();
        if (!IsSha256(expected)) throw new InvalidDataException("The expected evidence SHA-256 value is invalid.");
        string safeName = SafePart(filename, 180);
        if (!safeName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) || !String.Equals(safeName, filename, StringComparison.Ordinal)) throw new InvalidDataException("The stored evidence filename is invalid.");
        string root, safeOrganization = ValidOrganizationName(organization), relative = Path.Combine("Organizations", safeOrganization, OrganizationArtifactStorageFolder(ArtifactStorageFolder(kind), safeOrganization), safeName).Replace(Path.DirectorySeparatorChar, '/'), path = ResolveEvidencePath(systemId, relative, out root), actual = TryFileHash(path);
        bool stored = String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase);
        return json.Serialize(new Dictionary<string, object> { { "stored", stored }, { "filename", safeName }, { "path", relative }, { "sha256", actual } });
    }

    public string VerifyStoredEvidencePdf(string systemId, string organization, string kind, string filename, string expectedPdfSha256)
    {
        string expected = CleanLine(expectedPdfSha256, 64).ToLowerInvariant();
        if (!IsSha256(expected)) throw new InvalidDataException("The expected evidence PDF SHA-256 value is invalid.");
        string safeName = SafePart(filename, 180);
        if (!safeName.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase) || !String.Equals(safeName, filename, StringComparison.Ordinal)) throw new InvalidDataException("The stored evidence filename is invalid.");
        string root, safeOrganization = ValidOrganizationName(organization), relative = Path.Combine("Organizations", safeOrganization, OrganizationArtifactStorageFolder(ArtifactStorageFolder(kind), safeOrganization), safeName).Replace(Path.DirectorySeparatorChar, '/'), path = ResolveEvidencePath(systemId, relative, out root), containerSha256 = TryFileHash(path), pdfSha256 = "";
        if (IsSha256(containerSha256)) try { pdfSha256 = EvidencePdfSha256(path); } catch { }
        bool stored = String.Equals(pdfSha256, expected, StringComparison.OrdinalIgnoreCase);
        return json.Serialize(new Dictionary<string, object> { { "stored", stored }, { "filename", safeName }, { "path", relative }, { "sha256", containerSha256 }, { "pdfSha256", pdfSha256 } });
    }

    public string ListOrganizations(string systemId)
    {
        lock (RootLock(systemId))
        {
            string localRoot = LocalEvidenceRoot(systemId), localDirectory = Path.Combine(localRoot, "Organizations");Directory.CreateDirectory(localDirectory);
            string working = ReadWorkingManifest(systemId);if (!String.IsNullOrWhiteSpace(working)) EnsureLocalWorkspaceOrganizationFolders(localRoot, ValidateDatabase(working));
            string[] localNames = Directory.EnumerateDirectories(localDirectory, "*", SearchOption.TopDirectoryOnly).Select(path => new DirectoryInfo(path).Name).Where(name => !ReservedOrganizationName(name)).ToArray();
            string[] names = localNames.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToArray();
            foreach (string name in names) { string localOrganization = Path.Combine(localDirectory, name);Directory.CreateDirectory(localOrganization);Directory.CreateDirectory(Path.Combine(localOrganization, SafePart(name, 80) + " Incoming"));Directory.CreateDirectory(Path.Combine(localOrganization, SafePart(name, 80) + " Rework"));Directory.CreateDirectory(Path.Combine(localOrganization, SafePart(name, 80) + " Complete")); }
            return json.Serialize(names);
        }
    }

    public string CreateOrganization(string systemId, string requested)
    {
        string organization = ValidOrganizationName(requested);
        lock (RootLock(systemId))
        {
            string directory = Path.Combine(LocalEvidenceRoot(systemId), "Organizations", organization);Directory.CreateDirectory(directory);Directory.CreateDirectory(Path.Combine(directory, SafePart(organization, 80) + " Incoming"));Directory.CreateDirectory(Path.Combine(directory, SafePart(organization, 80) + " Rework"));Directory.CreateDirectory(Path.Combine(directory, SafePart(organization, 80) + " Complete"));
            return json.Serialize(new Dictionary<string, object> { { "organization", organization } });
        }
    }

    public string StoreReport(string systemId, string filename, byte[] bytes)
    {
        if (bytes == null || bytes.Length == 0 || bytes.Length > 25L * 1024 * 1024) throw new InvalidDataException("The compliance report is empty or exceeds the 25 MB limit.");
        string safeName = SafePart(filename, 180);
        if (!safeName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Compliance reports must use the PDF format.");
        using (var memory = new MemoryStream(bytes, false)) ValidatePdfStream(memory, safeName, bytes.Length);
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "Reports"), path = Path.Combine(directory, safeName), hash = Sha256Bytes(bytes), saved = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            AtomicWrite(path, bytes);
            try { AtomicWrite(path + ".sha256", Encoding.ASCII.GetBytes(hash + "  " + safeName + "\n")); }
            catch { TryDelete(path); throw; }
            return json.Serialize(new Dictionary<string, object> { { "filename", safeName }, { "saved", saved }, { "sha256", hash } });
        }
    }

    public string StoreErrorReport(string systemId, string filename, string text)
    {
        string safeName = SafePart(filename, 180);if (!safeName.EndsWith(".txt", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Error reports must use the TXT format.");
        string entry = (text ?? "").TrimEnd('\r', '\n') + "\r\n";byte[] bytes = Encoding.UTF8.GetBytes(entry);if (bytes.Length <= 2 || bytes.Length > 1024 * 1024) throw new InvalidDataException("The error report entry is empty or exceeds the 1 MB limit.");
        lock (errorReportGate)
        {
            string root = Root(systemId), directory = SupportDirectory(root, ErrorReportsDirectoryName), dailyName = "error-report-" + DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ".txt", path = Path.Combine(directory, dailyName);
            AppendErrorReportBytes(path, bytes);
            return json.Serialize(new Dictionary<string, object> { { "saved", Relative(Root(systemId), path).Replace(Path.DirectorySeparatorChar, '/') } });
        }
    }

    private static void AppendErrorReportBytes(string path, byte[] entry)
    {
        for (int attempt = 0; ; attempt++)
        {
            try
            {
                long existingLength = File.Exists(path) ? new FileInfo(path).Length : 0L;
                byte[] separator = existingLength > 0 ? Encoding.UTF8.GetBytes("\r\n") : new byte[0];
                if (existingLength + separator.Length + entry.Length > ErrorReportFileLimit) throw new InvalidDataException(Path.GetFileName(path) + " exceeds the daily error-report size limit.");
                using (var stream = OpenCompatibleFileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, 4096))
                {
                    if (separator.Length > 0) stream.Write(separator, 0, separator.Length);
                    stream.Write(entry, 0, entry.Length);FlushCompatible(stream);
                }
                return;
            }
            catch (IOException)
            {
                if (attempt >= 2) throw;
                Thread.Sleep(75 * (attempt + 1));
            }
        }
    }

    public string VerifyAuditLogs(string systemId)
    {
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "Audit Logs");
            AuditState state = VerifyAuditChainWithRetry(directory);
            EnsureAuditAnchor(directory, state);SaveAuditCheckpoint(directory, state);
            return json.Serialize(new Dictionary<string, object> { { "healthy", true }, { "entries", state.Entries }, { "files", state.Files }, { "legacyFiles", state.LegacyFiles }, { "firstTimestamp", state.FirstTimestamp }, { "lastTimestamp", state.LastTimestamp }, { "headHash", state.HeadHash }, { "anchorHash", state.AnchorHash }, { "anchoredEntries", state.AnchoredEntries }, { "anchorAlgorithm", "RSA-SHA256" } });
        }
    }

    public string ReadAuditLogs(string systemId)
    {
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "Audit Logs");
            AuditState state = VerifyAuditChain(directory);
            EnsureAuditAnchor(directory, state);SaveAuditCheckpoint(directory, state);
            state.Recent.Reverse();
            return json.Serialize(new Dictionary<string, object> { { "healthy", true }, { "entries", state.Entries }, { "files", state.Files }, { "legacyFiles", state.LegacyFiles }, { "firstTimestamp", state.FirstTimestamp }, { "lastTimestamp", state.LastTimestamp }, { "headHash", state.HeadHash }, { "anchorHash", state.AnchorHash }, { "anchoredEntries", state.AnchoredEntries }, { "anchorAlgorithm", "RSA-SHA256" }, { "recent", state.Recent } });
        }
    }

    public void AppendAudit(string systemId, string action)
    {
        AppendAuditBatch(systemId, new[] { action });
    }

    public void AppendAuditBatchJson(string systemId, string body)
    {
        object[] values;
        try { values = json.DeserializeObject(body) as object[]; }
        catch (Exception) { throw new InvalidDataException("The audit batch is not valid JSON."); }
        if (values == null) throw new InvalidDataException("The audit batch must be a JSON array.");
        var actions = new string[values.Length];
        for (int index = 0; index < values.Length; index++)
        {
            actions[index] = values[index] as string;
            if (actions[index] == null) throw new InvalidDataException("Every audit batch item must be text.");
        }
        AppendAuditBatch(systemId, actions);
    }

    public void AppendAuditBatch(string systemId, string[] actions)
    {
        if (actions == null || actions.Length == 0 || actions.Length > 10000) throw new InvalidDataException("The audit batch must contain between 1 and 10,000 actions.");
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "Audit Logs");
            using (FileStream auditLock = AcquireAuditFileLock(directory))
            {
            AuditState state = VerifyAuditChainIncrementalWithRetry(directory);
            EnsureAuditAnchor(directory, state);
            DateTimeOffset now = DateTimeOffset.UtcNow;
            if (state.LastInstant.HasValue && now < state.LastInstant.Value.Subtract(TimeSpan.FromSeconds(1))) throw new InvalidDataException("The system clock is earlier than the most recent audit entry.");
            if (state.LastInstant.HasValue && now <= state.LastInstant.Value) now = state.LastInstant.Value.AddTicks(1);
            string currentPath = null;
            var buffer = new StringBuilder();
            for (int index = 0; index < actions.Length; index++)
            {
                if (index > 0) now = now.AddTicks(1);
                string timestamp = now.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture), cleanAction = CleanLine(actions[index], 500);
                long sequence = checked(state.Entries + 1);
                string entryHash = AuditEntryHash(AuditVersion, sequence, timestamp, actor, cleanAction, state.HeadHash);
                var entry = new Dictionary<string, object> { { "version", AuditVersion }, { "sequence", sequence }, { "timestampUtc", timestamp }, { "actor", actor }, { "action", cleanAction }, { "previousHash", state.HeadHash }, { "entryHash", entryHash } };
                string path = Path.Combine(directory, "audit-" + now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ".jsonl");
                if (currentPath != null && !String.Equals(currentPath, path, StringComparison.Ordinal))
                {
                    AppendAuditBytes(currentPath, Encoding.UTF8.GetBytes(buffer.ToString()));
                    buffer.Clear();
                }
                if (!String.Equals(currentPath, path, StringComparison.Ordinal) && !File.Exists(path)) state.Files++;
                currentPath = path;
                buffer.Append(json.Serialize(entry)).Append('\n');
                state.Entries = sequence;
                state.HeadHash = entryHash;
                state.LastInstant = now;
                state.LastTimestamp = timestamp;
                state.FirstTimestamp = state.FirstTimestamp ?? timestamp;
            }
            if (currentPath != null) AppendAuditBytes(currentPath, Encoding.UTF8.GetBytes(buffer.ToString()));
            AppendAuditAnchor(directory, state);
            SaveAuditCheckpoint(directory, state);
            }
        }
    }

    private static FileStream AcquireAuditFileLock(string directory)
    {
        string path = Path.Combine(directory, "audit-chain.lock");
        for (int attempt = 0; ; attempt++)
        {
            try { return OpenCompatibleFileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 4096); }
            catch (IOException)
            {
                if (attempt >= 100) throw new IOException("The audit chain is busy with another session. Retry after the other audit entry finishes.");
                Thread.Sleep(100);
            }
        }
    }

    private static void AppendAuditBytes(string path, byte[] bytes)
    {
        for (int attempt = 0; ; attempt++)
        {
            try
            {
                long existingLength = File.Exists(path) ? new FileInfo(path).Length : 0L;
                if (existingLength + bytes.Length > AuditFileLimit) throw new InvalidDataException(Path.GetFileName(path) + " exceeds the audit-log size limit.");
                using (var stream = OpenCompatibleFileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, 4096))
                {
                    stream.Write(bytes, 0, bytes.Length);
                    FlushCompatible(stream);
                }
                return;
            }
            catch (IOException)
            {
                if (attempt >= 2) throw;
                Thread.Sleep(75 * (attempt + 1));
            }
        }
    }

    private static byte[] AuditCheckpointEntropy() { return Encoding.UTF8.GetBytes("RAPTOR verified audit checkpoint v1"); }

    private AuditState VerifyAuditChainIncrementalWithRetry(string directory)
    {
        for (int attempt = 0; ; attempt++)
        {
            try
            {
                AuditState cached = ReadAuditCheckpoint(directory);
                if (cached != null) { cached.Incremental = true;return cached; }
                return VerifyAuditChain(directory);
            }
            catch (IOException) { if (attempt >= 2) throw;Thread.Sleep(75 * (attempt + 1)); }
        }
    }

    private void SaveAuditCheckpoint(string directory, AuditState state)
    {
        try
        {
            string root = Path.GetDirectoryName(Path.GetDirectoryName(directory));if (String.IsNullOrWhiteSpace(root)) return;
            string[] paths = Directory.Exists(directory) ? Directory.EnumerateFiles(directory, "audit-*.jsonl", SearchOption.TopDirectoryOnly).OrderBy(Path.GetFileName, StringComparer.Ordinal).ToArray() : new string[0];
            var files = new List<object>();foreach (string path in paths) { var info = new FileInfo(path);files.Add(new Dictionary<string, object> { { "name", info.Name }, { "length", info.Length }, { "modifiedUnixMs", new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds() } }); }
            var envelope = new Dictionary<string, object> { { "version", AuditCheckpointVersion }, { "verifiedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "entries", state.Entries }, { "filesCount", state.Files }, { "legacyFiles", state.LegacyFiles }, { "headHash", state.HeadHash }, { "anchorHash", state.AnchorHash ?? AuditGenesisHash }, { "anchoredEntries", state.AnchoredEntries }, { "firstTimestamp", state.FirstTimestamp ?? "" }, { "lastTimestamp", state.LastTimestamp ?? "" }, { "files", files.ToArray() } };
            byte[] clear = Encoding.UTF8.GetBytes(json.Serialize(envelope)), encrypted = ProtectedData.Protect(clear, AuditCheckpointEntropy(), DataProtectionScope.CurrentUser);AtomicWrite(Path.Combine(LocalPerformanceCacheDirectory(root, "Audit"), LocalAuditCheckpointFilename), encrypted);
        }
        catch { }
    }

    private AuditState ReadAuditCheckpoint(string directory)
    {
        string path = null;
        try
        {
            string root = Path.GetDirectoryName(Path.GetDirectoryName(directory));if (String.IsNullOrWhiteSpace(root)) return null;path = Path.Combine(LocalPerformanceCacheDirectory(root, "Audit"), LocalAuditCheckpointFilename);if (!File.Exists(path) || new FileInfo(path).Length <= 0 || new FileInfo(path).Length > 10L * 1024 * 1024) return null;
            byte[] clear = ProtectedData.Unprotect(File.ReadAllBytes(path), AuditCheckpointEntropy(), DataProtectionScope.CurrentUser);Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(new UTF8Encoding(false, true).GetString(clear)));if (Convert.ToInt32(envelope["version"], CultureInfo.InvariantCulture) != AuditCheckpointVersion) return null;
            object[] cachedFiles = ObjectArray(envelope["files"]);string[] current = Directory.Exists(directory) ? Directory.EnumerateFiles(directory, "audit-*.jsonl", SearchOption.TopDirectoryOnly).OrderBy(Path.GetFileName, StringComparer.Ordinal).ToArray() : new string[0];if (cachedFiles.Length != current.Length) return null;
            for (int index = 0; index < current.Length; index++)
            {
                Dictionary<string, object> cached = ObjectDictionary(cachedFiles[index]);var info = new FileInfo(current[index]);if (!String.Equals(Convert.ToString(cached["name"], CultureInfo.InvariantCulture), info.Name, StringComparison.Ordinal) || Convert.ToInt64(cached["length"], CultureInfo.InvariantCulture) != info.Length || Convert.ToInt64(cached["modifiedUnixMs"], CultureInfo.InvariantCulture) != new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds()) return null;
            }
            string headHash = Convert.ToString(envelope["headHash"], CultureInfo.InvariantCulture), firstTimestamp = Convert.ToString(envelope["firstTimestamp"], CultureInfo.InvariantCulture), lastTimestamp = Convert.ToString(envelope["lastTimestamp"], CultureInfo.InvariantCulture);if (!IsSha256(headHash)) return null;DateTimeOffset instant;DateTimeOffset? parsedInstant = String.IsNullOrWhiteSpace(lastTimestamp) ? (DateTimeOffset?)null : DateTimeOffset.TryParse(lastTimestamp, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out instant) ? instant : (DateTimeOffset?)null;if (!String.IsNullOrWhiteSpace(lastTimestamp) && !parsedInstant.HasValue) return null;
            string anchorHash = Convert.ToString(envelope["anchorHash"], CultureInfo.InvariantCulture);if (!IsSha256(anchorHash)) return null;
            return new AuditState { Entries = Convert.ToInt64(envelope["entries"], CultureInfo.InvariantCulture), Files = Convert.ToInt32(envelope["filesCount"], CultureInfo.InvariantCulture), LegacyFiles = Convert.ToInt32(envelope["legacyFiles"], CultureInfo.InvariantCulture), HeadHash = headHash.ToLowerInvariant(), AnchorHash = anchorHash.ToLowerInvariant(), AnchoredEntries = Convert.ToInt64(envelope["anchoredEntries"], CultureInfo.InvariantCulture), FirstTimestamp = String.IsNullOrWhiteSpace(firstTimestamp) ? null : firstTimestamp, LastTimestamp = String.IsNullOrWhiteSpace(lastTimestamp) ? null : lastTimestamp, LastInstant = parsedInstant, Incremental = true };
        }
        catch { if (!String.IsNullOrWhiteSpace(path)) TryDelete(path);return null; }
    }

    private static byte[] AuditSigningKeyEntropy() { return Encoding.UTF8.GetBytes("RAPTOR audit signing key v1"); }

    private byte[] LoadOrCreateAuditSigningKey(string root)
    {
        if (AuditSigningKeyOverrideForTests != null) return (byte[])AuditSigningKeyOverrideForTests.Clone();
        string directory = LocalPerformanceCacheDirectory(root, "Audit"), path = Path.Combine(directory, LocalAuditSigningKeyFilename);
        if (File.Exists(path))
        {
            byte[] clear = ProtectedData.Unprotect(File.ReadAllBytes(path), AuditSigningKeyEntropy(), DataProtectionScope.CurrentUser);
            using (var probe = new RSACryptoServiceProvider()) { probe.PersistKeyInCsp = false;probe.ImportCspBlob(clear);if (probe.PublicOnly) throw new InvalidDataException("The local audit signing key does not contain its private component."); }
            return clear;
        }
        byte[] privateBlob;
        using (var rsa = new RSACryptoServiceProvider(2048)) { rsa.PersistKeyInCsp = false;privateBlob = rsa.ExportCspBlob(true); }
        byte[] protectedBlob = ProtectedData.Protect(privateBlob, AuditSigningKeyEntropy(), DataProtectionScope.CurrentUser);AtomicWrite(path, protectedBlob);
        return privateBlob;
    }

    private static string AuditAnchorPayload(int version, string timestamp, string anchorActor, long entries, int files, string headHash, string previousAnchorHash, string publicKeyId, string publicKey)
    {
        return version.ToString(CultureInfo.InvariantCulture) + "\n" + timestamp + "\n" + CleanLine(anchorActor, 500) + "\n" + entries.ToString(CultureInfo.InvariantCulture) + "\n" + files.ToString(CultureInfo.InvariantCulture) + "\n" + headHash.ToLowerInvariant() + "\n" + previousAnchorHash.ToLowerInvariant() + "\n" + publicKeyId.ToLowerInvariant() + "\n" + publicKey;
    }

    private void AppendAuditAnchor(string directory, AuditState state)
    {
        string root = Path.GetDirectoryName(Path.GetDirectoryName(directory));if (String.IsNullOrWhiteSpace(root)) throw new InvalidDataException("The audit root could not be resolved.");
        byte[] privateBlob = LoadOrCreateAuditSigningKey(root), publicBlob, signature;string timestamp = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture), publicKey;
        using (var rsa = new RSACryptoServiceProvider())
        using (var sha = new SHA256CryptoServiceProvider())
        {
            rsa.PersistKeyInCsp = false;rsa.ImportCspBlob(privateBlob);publicBlob = rsa.ExportCspBlob(false);publicKey = Convert.ToBase64String(publicBlob);
            string keyId = Sha256Bytes(publicBlob), payload = AuditAnchorPayload(AuditAnchorVersion, timestamp, actor, state.Entries, state.Files, state.HeadHash, state.AnchorHash, keyId, publicKey);
            signature = rsa.SignData(Encoding.UTF8.GetBytes(payload), sha);
            string signatureText = Convert.ToBase64String(signature), anchorHash = Sha256(payload + "\n" + signatureText);
            var entry = new Dictionary<string, object> { { "version", AuditAnchorVersion }, { "timestampUtc", timestamp }, { "actor", actor }, { "entries", state.Entries }, { "files", state.Files }, { "headHash", state.HeadHash }, { "previousAnchorHash", state.AnchorHash }, { "publicKeyId", keyId }, { "publicKey", publicKey }, { "signature", signatureText }, { "anchorHash", anchorHash } };
            AppendAuditBytes(Path.Combine(directory, AuditAnchorFilename), Encoding.UTF8.GetBytes(json.Serialize(entry) + "\n"));state.AnchorHash = anchorHash;state.AnchoredEntries = state.Entries;
        }
    }

    private void EnsureAuditAnchor(string directory, AuditState audit)
    {
        string root = Path.GetDirectoryName(Path.GetDirectoryName(directory));if (String.IsNullOrWhiteSpace(root)) throw new InvalidDataException("The audit root could not be resolved.");
        string path = Path.Combine(directory, AuditAnchorFilename), expectedLocalHash = ExpectedLocalAuditAnchorHash(root);
        if (!File.Exists(path))
        {
            if (!String.Equals(expectedLocalHash, AuditGenesisHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The cryptographic audit-anchor log is missing after this Windows user previously verified it.");
            audit.AnchorHash = AuditGenesisHash;AppendAuditAnchor(directory, audit);return;
        }
        var anchors = new AuditAnchorState();var info = new FileInfo(path);if (info.Length <= 0 || info.Length > AuditFileLimit) throw new InvalidDataException("The cryptographic audit-anchor log is empty or exceeds its size limit.");
        using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var reader = new StreamReader(stream, new UTF8Encoding(false, true), true, 4096))
        {
            string line;
            while ((line = reader.ReadLine()) != null)
            {
                if (line.Length == 0 || line.Length > 32768) throw new InvalidDataException("The cryptographic audit-anchor log contains an invalid entry length.");
                Dictionary<string, object> entry;try { entry = ObjectDictionary(json.DeserializeObject(line)); } catch { throw new InvalidDataException("The cryptographic audit-anchor log contains invalid JSON."); }
                int version, files;long entries;string timestamp, anchorActor, headHash, previousHash, publicKeyId, publicKey, signatureText, anchorHash;
                try { version = Convert.ToInt32(entry["version"], CultureInfo.InvariantCulture);timestamp = Convert.ToString(entry["timestampUtc"], CultureInfo.InvariantCulture);anchorActor = Convert.ToString(entry["actor"], CultureInfo.InvariantCulture);entries = Convert.ToInt64(entry["entries"], CultureInfo.InvariantCulture);files = Convert.ToInt32(entry["files"], CultureInfo.InvariantCulture);headHash = Convert.ToString(entry["headHash"], CultureInfo.InvariantCulture);previousHash = Convert.ToString(entry["previousAnchorHash"], CultureInfo.InvariantCulture);publicKeyId = Convert.ToString(entry["publicKeyId"], CultureInfo.InvariantCulture);publicKey = Convert.ToString(entry["publicKey"], CultureInfo.InvariantCulture);signatureText = Convert.ToString(entry["signature"], CultureInfo.InvariantCulture);anchorHash = Convert.ToString(entry["anchorHash"], CultureInfo.InvariantCulture); }
                catch { throw new InvalidDataException("The cryptographic audit-anchor log is missing required fields."); }
                DateTimeOffset instant;if (version != AuditAnchorVersion || entries < 0 || files < 0 || !timestamp.EndsWith("Z", StringComparison.Ordinal) || !DateTimeOffset.TryParse(timestamp, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out instant) || !IsSha256(headHash) || !IsSha256(previousHash) || !IsSha256(publicKeyId) || !IsSha256(anchorHash) || !String.Equals(previousHash, anchors.Hash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The cryptographic audit-anchor chain is invalid.");
                byte[] publicBlob, signature;try { publicBlob = Convert.FromBase64String(publicKey);signature = Convert.FromBase64String(signatureText); } catch { throw new InvalidDataException("The cryptographic audit-anchor key or signature is invalid."); }
                if (!String.Equals(Sha256Bytes(publicBlob), publicKeyId, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The cryptographic audit-anchor public key identifier is invalid.");
                string payload = AuditAnchorPayload(version, timestamp, anchorActor, entries, files, headHash, previousHash, publicKeyId, publicKey), calculatedHash = Sha256(payload + "\n" + signatureText);
                if (!String.Equals(calculatedHash, anchorHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The cryptographic audit-anchor hash is invalid.");
                bool verified;try { using (var rsa = new RSACryptoServiceProvider()) using (var sha = new SHA256CryptoServiceProvider()) { rsa.PersistKeyInCsp = false;rsa.ImportCspBlob(publicBlob);verified = rsa.VerifyData(Encoding.UTF8.GetBytes(payload), sha, signature); } } catch { verified = false; }
                if (!verified) throw new InvalidDataException("The cryptographic audit-anchor signature is invalid.");
                if (anchors.Count > 0 && entries <= anchors.Entries) throw new InvalidDataException("The cryptographic audit-anchor sequence is not increasing.");
                anchors.Hash = anchorHash.ToLowerInvariant();anchors.Entries = entries;anchors.HeadHash = headHash.ToLowerInvariant();anchors.Count++;anchors.Hashes.Add(anchors.Hash);
            }
        }
        if (anchors.Count == 0) throw new InvalidDataException("The cryptographic audit-anchor log contains no anchors.");
        if (!String.Equals(expectedLocalHash, AuditGenesisHash, StringComparison.OrdinalIgnoreCase) && !anchors.Hashes.Contains(expectedLocalHash)) throw new InvalidDataException("The cryptographic audit-anchor log no longer contains the last head verified by this Windows user.");
        if (anchors.Entries > audit.Entries) throw new InvalidDataException("The cryptographic audit anchor is ahead of the audit log.");
        if (anchors.Entries == audit.Entries && !String.Equals(anchors.HeadHash, audit.HeadHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The cryptographic audit anchor does not match the audit head.");
        if (anchors.Entries < audit.Entries && !String.Equals(AuditHeadAtSequence(directory, anchors.Entries), anchors.HeadHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The cryptographic audit anchor is not a valid prefix of the audit chain.");
        audit.AnchorHash = anchors.Hash;audit.AnchoredEntries = anchors.Entries;
        if (anchors.Entries < audit.Entries) AppendAuditAnchor(directory, audit);
    }

    private string ExpectedLocalAuditAnchorHash(string root)
    {
        string path = Path.Combine(LocalPerformanceCacheDirectory(root, "Audit"), LocalAuditCheckpointFilename);
        try
        {
            if (!File.Exists(path)) return AuditGenesisHash;
            byte[] clear = ProtectedData.Unprotect(File.ReadAllBytes(path), AuditCheckpointEntropy(), DataProtectionScope.CurrentUser);Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(new UTF8Encoding(false, true).GetString(clear)));
            if (Convert.ToInt32(envelope["version"], CultureInfo.InvariantCulture) != AuditCheckpointVersion) return AuditGenesisHash;
            string value = Convert.ToString(envelope["anchorHash"], CultureInfo.InvariantCulture);return IsSha256(value) ? value.ToLowerInvariant() : AuditGenesisHash;
        }
        catch { return AuditGenesisHash; }
    }

    private string AuditHeadAtSequence(string directory, long target)
    {
        if (target == 0) return AuditGenesisHash;
        foreach (string path in Directory.EnumerateFiles(directory, "audit-*.jsonl", SearchOption.TopDirectoryOnly).OrderBy(item => Path.GetFileName(item), StringComparer.Ordinal))
        using (var reader = new StreamReader(path, new UTF8Encoding(false, true)))
        {
            string line;while ((line = reader.ReadLine()) != null) { Dictionary<string, object> entry = ObjectDictionary(json.DeserializeObject(line));long sequence = Convert.ToInt64(entry["sequence"], CultureInfo.InvariantCulture);if (sequence == target) return Convert.ToString(entry["entryHash"], CultureInfo.InvariantCulture);if (sequence > target) break; }
        }
        return "";
    }

    private AuditState VerifyAuditChainWithRetry(string directory)
    {
        for (int attempt = 0; ; attempt++)
        {
            try { return VerifyAuditChain(directory); }
            catch (IOException)
            {
                if (attempt >= 2) throw;
                Thread.Sleep(75 * (attempt + 1));
            }
        }
    }

    private AuditState VerifyAuditChain(string directory)
    {
        var state = new AuditState();
        if (!Directory.Exists(directory)) return state;
        state.LegacyFiles = Directory.EnumerateFiles(directory, "audit-*.txt", SearchOption.TopDirectoryOnly).Count();
        string[] paths = Directory.EnumerateFiles(directory, "audit-*.jsonl", SearchOption.TopDirectoryOnly).OrderBy(path => Path.GetFileName(path), StringComparer.Ordinal).ToArray();
        if (paths.Length > 10000) throw new InvalidDataException("The audit-log file count exceeds the verification limit.");
        foreach (string path in paths)
        {
            string filename = Path.GetFileName(path), dayText;
            DateTime fileDay;
            if (filename.Length != 22 || !filename.StartsWith("audit-", StringComparison.Ordinal) || !filename.EndsWith(".jsonl", StringComparison.Ordinal) || !DateTime.TryParseExact(dayText = filename.Substring(6, 10), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out fileDay)) throw new InvalidDataException("An audit-log filename is invalid.");
            var info = new FileInfo(path);
            if (info.Length <= 0 || info.Length > AuditFileLimit) throw new InvalidDataException(filename + " is empty or exceeds the audit-log size limit.");
            int fileEntries = 0;
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var reader = new StreamReader(stream, new UTF8Encoding(false, true), true, 4096))
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    if (line.Length == 0 || line.Length > 8192) throw new InvalidDataException(filename + " contains an invalid audit entry length.");
                    Dictionary<string, object> entry;
                    try { entry = ObjectDictionary(json.DeserializeObject(line)); }
                    catch (Exception) { throw new InvalidDataException(filename + " contains invalid audit JSON."); }
                    int version; long sequence; string timestamp, entryActor, entryAction, previousHash, entryHash;
                    try
                    {
                        version = Convert.ToInt32(entry["version"], CultureInfo.InvariantCulture);
                        sequence = Convert.ToInt64(entry["sequence"], CultureInfo.InvariantCulture);
                        timestamp = Convert.ToString(entry["timestampUtc"], CultureInfo.InvariantCulture);
                        entryActor = Convert.ToString(entry["actor"], CultureInfo.InvariantCulture);
                        entryAction = Convert.ToString(entry["action"], CultureInfo.InvariantCulture);
                        previousHash = Convert.ToString(entry["previousHash"], CultureInfo.InvariantCulture);
                        entryHash = Convert.ToString(entry["entryHash"], CultureInfo.InvariantCulture);
                    }
                    catch (Exception) { throw new InvalidDataException(filename + " is missing required audit fields."); }
                    DateTimeOffset instant;
                    if (version != AuditVersion || sequence != state.Entries + 1 || String.IsNullOrWhiteSpace(timestamp) || !timestamp.EndsWith("Z", StringComparison.Ordinal) || !DateTimeOffset.TryParse(timestamp, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out instant) || instant.Offset != TimeSpan.Zero || instant.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) != dayText) throw new InvalidDataException(filename + " contains an invalid sequence or UTC timestamp.");
                    if (state.LastInstant.HasValue && instant <= state.LastInstant.Value) throw new InvalidDataException(filename + " contains a non-increasing UTC timestamp.");
                    if (!IsSha256(previousHash) || !IsSha256(entryHash) || !String.Equals(previousHash, state.HeadHash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException(filename + " has a broken audit hash chain.");
                    string expected = AuditEntryHash(version, sequence, timestamp, entryActor, entryAction, previousHash);
                    if (!String.Equals(entryHash, expected, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException(filename + " failed its audit-entry integrity check.");
                    state.Entries = sequence;
                    state.HeadHash = entryHash.ToLowerInvariant();
                    state.FirstTimestamp = state.FirstTimestamp ?? timestamp;
                    state.LastTimestamp = timestamp;
                    state.LastInstant = instant;
                    state.Recent.Add(new Dictionary<string, object> { { "version", version }, { "sequence", sequence }, { "timestampUtc", timestamp }, { "actor", entryActor }, { "action", entryAction }, { "previousHash", previousHash }, { "entryHash", entryHash } });
                    if (state.Recent.Count > 500) state.Recent.RemoveAt(0);
                    fileEntries++;
                }
            }
            if (fileEntries == 0) throw new InvalidDataException(filename + " contains no audit entries.");
            state.Files++;
        }
        return state;
    }

    private static string AuditEntryHash(int version, long sequence, string timestamp, string entryActor, string entryAction, string previousHash)
    {
        string payload = version.ToString(CultureInfo.InvariantCulture) + "\n" + sequence.ToString(CultureInfo.InvariantCulture) + "\n" + timestamp + "\n" + CleanLine(entryActor, 500) + "\n" + CleanLine(entryAction, 500) + "\n" + previousHash.ToLowerInvariant();
        return Sha256(payload);
    }

    private static bool IsSha256(string value)
    {
        if (value == null || value.Length != 64) return false;
        foreach (char c in value) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
        return true;
    }

    public bool AcquireLease(string systemId, string sessionId)
    {
        ValidateSessionId(sessionId);
        lock (LeaseLock(systemId))
        {
            HeldLease held;
            lock (mapGate) heldLeases.TryGetValue(systemId, out held);
            if (held != null)
            {
                if (!String.Equals(held.SessionId, sessionId, StringComparison.Ordinal)) return false;
                bool refreshed = RefreshLease(systemId, held, false);
                if (refreshed) RememberLastSystem(systemId);
                return refreshed;
            }
            string path = Path.Combine(Root(systemId), "tracker-exclusive-session.lock");
            FileStream stream;
            try { stream = OpenCompatibleFileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 4096); }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
            held = new HeldLease { SessionId = sessionId, Stream = stream };
            try
            {
                WriteLeaseMetadata(held, false);
                lock (mapGate) heldLeases[systemId] = held;
                RememberLastSystem(systemId);
                return true;
            }
            catch { DisposeLease(held, false); return false; }
        }
    }

    public bool RenewLease(string systemId, string sessionId)
    {
        ValidateSessionId(sessionId);
        lock (LeaseLock(systemId))
        {
            HeldLease held;
            lock (mapGate) heldLeases.TryGetValue(systemId, out held);
            return held != null && String.Equals(held.SessionId, sessionId, StringComparison.Ordinal) && RefreshLease(systemId, held, false);
        }
    }

    public bool OwnsLease(string systemId, string sessionId)
    {
        if (String.IsNullOrWhiteSpace(sessionId)) return false;
        try { ValidateSessionId(sessionId); }
        catch { return false; }
        lock (LeaseLock(systemId))
        {
            HeldLease held;
            lock (mapGate) heldLeases.TryGetValue(systemId, out held);
            return held != null && String.Equals(held.SessionId, sessionId, StringComparison.Ordinal);
        }
    }

    public void ReleaseLease(string systemId, string sessionId)
    {
        ValidateSessionId(sessionId);
        lock (LeaseLock(systemId))
        {
            HeldLease held;
            lock (mapGate)
            {
                if (!heldLeases.TryGetValue(systemId, out held) || !String.Equals(held.SessionId, sessionId, StringComparison.Ordinal)) return;
                heldLeases.Remove(systemId);
            }
            DisposeLease(held, true);
        }
    }

    public void ReleaseAllLeases()
    {
        HeldLease[] leases;
        lock (mapGate) { leases = heldLeases.Values.ToArray();heldLeases.Clear(); }
        foreach (HeldLease held in leases) DisposeLease(held, true);
    }

    public void Dispose() { Dispose(true); }

    public void Dispose(bool flushBackups)
    {
        try { backupTimer.Dispose(); } catch { }
        // The launcher normally finalizes backups before disposal. Forced shutdown
        // deliberately skips a second network flush so a stalled share cannot hold
        // the Windows process open indefinitely; the protected local workspace is
        // retained for recovery on the next launch.
        if (flushBackups) try { FlushDueBackups(true); } catch { }
        HeldLease[] leases;string[] mappedRoots;
        FileSystemWatcher[] watchers;
        lock (mapGate) { leases = heldLeases.Values.ToArray();heldLeases.Clear();mappedRoots = roots.Values.Concat(cachedRoots.Values).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();watchers = changeWatchers.Values.ToArray();changeWatchers.Clear(); }
        foreach (FileSystemWatcher watcher in watchers) try { watcher.Dispose(); } catch { }
        foreach (HeldLease held in leases) DisposeLease(held, true);
        foreach (string root in mappedRoots) PruneEvidenceValidationCache(root, true);
    }

    public void ExpireLeases(TimeSpan maximumAge)
    {
        string[] ids;
        lock (mapGate) ids = heldLeases.Keys.ToArray();
        foreach (string id in ids)
        {
            lock (LeaseLock(id))
            {
                HeldLease expired = null;
                lock (mapGate)
                {
                    HeldLease held;
                    if (heldLeases.TryGetValue(id, out held) && DateTime.UtcNow - held.LastRenewedUtc >= maximumAge) { expired = held; heldLeases.Remove(id); }
                }
                if (expired != null) DisposeLease(expired, true);
            }
        }
    }

    private string CreateSnapshot(string directory, Dictionary<string, object> database, bool force)
    {
        Directory.CreateDirectory(directory);
        string stateHash = StateHash(database), today = DateTime.UtcNow.ToString("yyyy-MM-dd"), latest = SnapshotPaths(directory).FirstOrDefault();
        if (!force && latest != null && Path.GetFileName(latest).Contains(today))
        {
            try { if (String.Equals(Convert.ToString(VerifySnapshot(latest)["contentHash"]), stateHash, StringComparison.OrdinalIgnoreCase)) return null; }
            catch { }
        }
        string created = DateTime.UtcNow.ToString("o"), filename = "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss-fffffffZ") + ".json.gz";
        var envelope = new Dictionary<string, object> { { "backupVersion", 1 }, { "created", created }, { "contentHash", stateHash }, { "database", database } };
        string text = json.Serialize(envelope);byte[] compressed = CompressGzip(Encoding.UTF8.GetBytes(text)), pathBytes = compressed;string path = Path.Combine(directory, filename), integrity = Sha256Bytes(pathBytes);
        AtomicWrite(path, pathBytes);
        try { AtomicWrite(path + ".sha256", Encoding.ASCII.GetBytes(integrity + "  " + filename + Environment.NewLine)); }
        catch { TryDelete(path); throw; }
        return created;
    }

    private Dictionary<string, object> VerifySnapshot(string path)
    {
        if (!File.Exists(path + ".sha256")) throw new InvalidDataException("The matching SHA-256 file is missing.");
        byte[] stored = ReadAllBytesWithRetry(path, ManifestLimit);string checksum = ReadText(path + ".sha256", 1024).Trim(), filename = Path.GetFileName(path);
        string[] parts = checksum.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2 || parts[1] != filename || parts[0].Length != 64 || !String.Equals(parts[0], Sha256Bytes(stored), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The backup SHA-256 integrity check failed.");
        byte[] clear = filename.EndsWith(".json.gz", StringComparison.OrdinalIgnoreCase) ? DecompressGzip(stored, ManifestLimit) : stored;string text;
        try { text = new UTF8Encoding(false, true).GetString(clear); }
        catch (DecoderFallbackException) { throw new InvalidDataException("The backup is not valid UTF-8 JSON."); }
        Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(text));
        if (Convert.ToInt32(envelope["backupVersion"]) != 1 || !(envelope["created"] is string) || !(envelope["contentHash"] is string) || !envelope.ContainsKey("database")) throw new InvalidDataException("The backup format is invalid.");
        Dictionary<string, object> database = ObjectDictionary(envelope["database"]);
        if (!String.Equals(Convert.ToString(envelope["contentHash"]), StateHash(database), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The backup content hash does not match its records.");
        database = MigrateDatabaseObject(database);envelope["database"] = database;
        return envelope;
    }

    private string LatestCreated(string directory)
    {
        string latest = SnapshotPaths(directory).FirstOrDefault();
        if (latest == null) return null;
        try { return Convert.ToString(VerifySnapshot(latest)["created"]); }
        catch { return null; }
    }

    private IEnumerable<string> SnapshotPaths(string directory)
    {
        if (!Directory.Exists(directory)) return Enumerable.Empty<string>();
        return Directory.EnumerateFiles(directory, "user-tracker-*", SearchOption.TopDirectoryOnly).Where(path => path.EndsWith(".json", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".json.gz", StringComparison.OrdinalIgnoreCase)).OrderByDescending(path => Path.GetFileName(path), StringComparer.Ordinal);
    }

    private static byte[] CompressGzip(byte[] clear)
    {
        using (var memory = new MemoryStream())
        {
            using (var gzip = new GZipStream(memory, CompressionLevel.Optimal, true)) gzip.Write(clear, 0, clear.Length);
            return memory.ToArray();
        }
    }

    private static byte[] DecompressGzip(byte[] compressed, long maximumBytes)
    {
        using (var input = new MemoryStream(compressed, false))
        using (var gzip = new GZipStream(input, CompressionMode.Decompress))
        using (var output = new MemoryStream())
        {
            var buffer = new byte[64 * 1024];int read;
            while ((read = gzip.Read(buffer, 0, buffer.Length)) > 0) { if (output.Length + read > maximumBytes) throw new InvalidDataException("The decompressed backup exceeds the safety limit.");output.Write(buffer, 0, read); }
            return output.ToArray();
        }
    }

    private static string ManifestChecksumText(string hash)
    {
        return hash.ToLowerInvariant() + "  " + ManifestFilename + Environment.NewLine;
    }

    private static void WriteManifestChecksum(string manifestPath, string hash)
    {
        if (String.IsNullOrWhiteSpace(hash) || !Regex.IsMatch(hash, "^[a-fA-F0-9]{64}$")) throw new InvalidDataException("The database manifest SHA-256 value is invalid.");
        AtomicWrite(manifestPath + ".sha256", Encoding.ASCII.GetBytes(ManifestChecksumText(hash)));
    }

    private static string VerifyManifestChecksum(string manifestPath, bool allowMissing)
    {
        string expected = ReadManifestChecksumHash(manifestPath, allowMissing);if (!IsSha256(expected)) return null;
        string actual = Sha256Bytes(ReadAllBytesWithRetry(manifestPath, ManifestLimit));
        if (!String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The live database failed its SHA-256 integrity check. Full Access is blocked until an operator restores a verified backup.");
        return actual;
    }

    private Dictionary<string, object> ValidateDatabase(string text)
    {
        if (Encoding.UTF8.GetByteCount(text) > ManifestLimit) throw new InvalidDataException("The database manifest exceeds the 50 MB safety limit.");
        Dictionary<string, object> value;
        try { value = ObjectDictionary(json.DeserializeObject(text)); }
        catch (Exception) { throw new InvalidDataException("The database manifest is invalid JSON."); }
        return MigrateDatabaseObject(value);
    }

    private static Dictionary<string, object> MigrateDatabaseObject(Dictionary<string, object> value)
    {
        int version = value.ContainsKey("version") ? Convert.ToInt32(value["version"], CultureInfo.InvariantCulture) : 1;
        if (version == 1)
        {
            if (!value.ContainsKey("systems") || !value.ContainsKey("users")) throw new InvalidDataException("The database manifest format is invalid.");
            foreach (object raw in ObjectArray(value["users"]))
            {
                Dictionary<string, object> user = ObjectDictionary(raw);
                if (!user.ContainsKey("privilegedUsernames")) user["privilegedUsernames"] = new object[0];
                if (!user.ContainsKey("privilegedTypes")) user["privilegedTypes"] = new object[0];
                if (!user.ContainsKey("changes")) user["changes"] = new object[0];
                if (!user.ContainsKey("exceptions")) user["exceptions"] = new object[0];
            }
            value["version"] = 2;version = 2;
        }
        if (version != 2 || !value.ContainsKey("systems") || !value.ContainsKey("users")) throw new InvalidDataException("The database manifest format is invalid or uses a newer unsupported schema.");
        object[] systems = ObjectArray(value["systems"]), users = ObjectArray(value["users"]);
        if (systems.Length > 1000 || users.Length > 100000) throw new InvalidDataException("The database manifest exceeds its record limits.");
        var systemIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (object raw in systems)
        {
            Dictionary<string, object> system = ObjectDictionary(raw);string id = RequiredBoundedString(system, "id", 100, false, "system"), name = RequiredBoundedString(system, "name", 200, false, "system");
            RequiredBoundedString(system, "type", 200, true, "system");RequiredBoundedString(system, "organization", 200, true, "system");RequiredBoolean(system, "archived", "system");
            if (!systemIds.Add(id)) throw new InvalidDataException("The database contains a duplicate system ID: " + CleanLine(id, 100) + ".");
            if (String.IsNullOrWhiteSpace(name)) throw new InvalidDataException("A system name cannot be blank.");
        }
        var userIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (object raw in users)
        {
            Dictionary<string, object> user = ObjectDictionary(raw);
            if (!user.ContainsKey("privilegedUsernames")) user["privilegedUsernames"] = new object[0];if (!user.ContainsKey("privilegedTypes")) user["privilegedTypes"] = new object[0];if (!user.ContainsKey("changes")) user["changes"] = new object[0];if (!user.ContainsKey("exceptions")) user["exceptions"] = new object[0];
            string id = RequiredBoundedString(user, "id", 100, false, "user"), systemId = RequiredBoundedString(user, "systemId", 100, false, "user");
            if (!userIds.Add(id)) throw new InvalidDataException("The database contains a duplicate user ID: " + CleanLine(id, 100) + ".");
            if (!systemIds.Contains(systemId)) throw new InvalidDataException("A user references an unknown information system.");
            RequiredBoundedString(user, "organization", 200, true, "user");RequiredBoundedString(user, "last", 100, true, "user");RequiredBoundedString(user, "first", 100, true, "user");RequiredBoundedString(user, "middle", 10, true, "user");RequiredBoundedString(user, "email", 254, true, "user");RequiredBoolean(user, "disabled", "user");
            ValidateStringArray(user, "roles", 20, 100, "user");foreach (string role in ObjectArray(user["roles"]).Cast<object>().Select(item => Convert.ToString(item, CultureInfo.InvariantCulture))) if (role != "General" && role != "Privileged" && role != "DTA") throw new InvalidDataException("A user contains an unsupported role.");
            ValidateStringArray(user, "privilegedUsernames", 50, 200, "user");ValidateStringArray(user, "privilegedTypes", 50, 200, "user");
            object[] artifacts = RequiredArray(user, "artifacts", 100, "user");foreach (object artifactRaw in artifacts) ValidateArtifactRecord(ObjectDictionary(artifactRaw));
            object[] changes = RequiredArray(user, "changes", 10000, "user");foreach (object changeRaw in changes) ValidateChangeRecord(ObjectDictionary(changeRaw));
            object[] exceptions = RequiredArray(user, "exceptions", 1000, "user");foreach (object exceptionRaw in exceptions) ValidateExceptionRecord(ObjectDictionary(exceptionRaw));
        }
        return value;
    }

    private static string RequiredBoundedString(Dictionary<string, object> record, string key, int maximum, bool allowEmpty, string label)
    {
        object raw;if (!record.TryGetValue(key, out raw) || !(raw is string)) throw new InvalidDataException("A " + label + " record has an invalid " + key + " field.");
        string value = (string)raw;if (value.Length > maximum || value.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0 || (!allowEmpty && String.IsNullOrWhiteSpace(value))) throw new InvalidDataException("A " + label + " record has an invalid " + key + " field.");return value;
    }

    private static string OptionalBoundedString(Dictionary<string, object> record, string key, int maximum, string label)
    {
        if (!record.ContainsKey(key) || record[key] == null) return null;return RequiredBoundedString(record, key, maximum, true, label);
    }

    private static void RequiredBoolean(Dictionary<string, object> record, string key, string label) { if (!record.ContainsKey(key) || !(record[key] is bool)) throw new InvalidDataException("A " + label + " record has an invalid " + key + " field."); }

    private static object[] RequiredArray(Dictionary<string, object> record, string key, int maximum, string label)
    {
        object raw;if (!record.TryGetValue(key, out raw)) throw new InvalidDataException("A " + label + " record is missing " + key + ".");object[] values = ObjectArray(raw);if (values.Length > maximum) throw new InvalidDataException("A " + label + " record exceeds the " + key + " limit.");return values;
    }

    private static void ValidateStringArray(Dictionary<string, object> record, string key, int maximumItems, int maximumLength, string label)
    {
        foreach (object raw in RequiredArray(record, key, maximumItems, label)) { string value = raw as string;if (value == null || value.Length > maximumLength || value.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) throw new InvalidDataException("A " + label + " record has an invalid " + key + " value."); }
    }

    private static void ValidateArtifactRecord(Dictionary<string, object> artifact)
    {
        RequiredBoundedString(artifact, "kind", 100, false, "artifact");string filename = RequiredBoundedString(artifact, "filename", 500, false, "artifact");string hash = OptionalBoundedString(artifact, "sha256", 64, "artifact"), path = OptionalBoundedString(artifact, "path", 32767, "artifact"), source = OptionalBoundedString(artifact, "source", 30, "artifact");OptionalBoundedString(artifact, "storedAt", 50, "artifact");OptionalBoundedString(artifact, "storedBy", 500, "artifact");
        if (!String.Equals(filename, Path.GetFileName(filename), StringComparison.Ordinal) || filename == "." || filename == "..") throw new InvalidDataException("An artifact contains an invalid stored filename.");
        if (hash != null && !IsSha256(hash)) throw new InvalidDataException("An artifact contains an invalid SHA-256 value.");
        if (path != null && (path.IndexOfAny(new[] { '\r', '\n', '\0', ':' }) >= 0 || Path.IsPathRooted(path) || path.Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries).Any(part => part == "." || part == ".."))) throw new InvalidDataException("An artifact contains an invalid stored path.");
        if (source != null && source != "Manual Add" && source != "Manual Update" && source != "Sync") throw new InvalidDataException("An artifact contains an unsupported source.");
    }

    private static void ValidateChangeRecord(Dictionary<string, object> change)
    {
        RequiredBoundedString(change, "timestamp", 50, false, "change");RequiredBoundedString(change, "actor", 500, true, "change");RequiredBoundedString(change, "action", 500, false, "change");RequiredBoundedString(change, "description", 500, true, "change");ValidateStringArray(change, "rolesBefore", 20, 100, "change");ValidateStringArray(change, "rolesAfter", 20, 100, "change");ValidateStringArray(change, "files", 100, 500, "change");
    }

    private static void ValidateExceptionRecord(Dictionary<string, object> exception)
    {
        RequiredBoundedString(exception, "id", 100, false, "exception");RequiredBoundedString(exception, "artifact", 100, false, "exception");RequiredBoundedString(exception, "reason", 500, false, "exception");RequiredBoundedString(exception, "approvedBy", 200, false, "exception");RequiredBoundedString(exception, "createdAt", 50, false, "exception");RequiredBoundedString(exception, "createdBy", 500, false, "exception");string expires = RequiredBoundedString(exception, "expiresOn", 10, false, "exception");OptionalBoundedString(exception, "revokedAt", 50, "exception");OptionalBoundedString(exception, "revokedBy", 500, "exception");DateTime parsed;if (!DateTime.TryParseExact(expires, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out parsed)) throw new InvalidDataException("An exception has an invalid expiration date.");
    }

    private static void ValidateDatabaseObject(Dictionary<string, object> value) { MigrateDatabaseObject(value); }

    private string StateHash(Dictionary<string, object> database)
    {
        var state = new Dictionary<string, object> { { "systems", database["systems"] }, { "users", database["users"] } };
        return Sha256(json.Serialize(state));
    }

    private bool RefreshLease(string systemId, HeldLease held, bool released)
    {
        for (int attempt = 0; attempt < 2; attempt++)
        {
            try { WriteLeaseMetadata(held, released); return true; }
            catch { if (attempt == 0) Thread.Sleep(50); }
        }
        lock (mapGate) { HeldLease current; if (heldLeases.TryGetValue(systemId, out current) && Object.ReferenceEquals(current, held)) heldLeases.Remove(systemId); }
        DisposeLease(held, false);
        return false;
    }

    private void WriteLeaseMetadata(HeldLease held, bool released)
    {
        var value = new Dictionary<string, object> { { "sessionId", held.SessionId }, { "actor", actor }, { "computer", Environment.MachineName }, { "processId", System.Diagnostics.Process.GetCurrentProcess().Id }, { "updated", DateTime.UtcNow.ToString("o") }, { "released", released }, { "lockType", "exclusive-windows-file-lock" } };
        byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(value));
        held.Stream.Position = 0;
        held.Stream.Write(bytes, 0, bytes.Length);
        held.Stream.SetLength(bytes.Length);
        FlushCompatible(held.Stream);
        held.LastRenewedUtc = DateTime.UtcNow;
    }

    private void DisposeLease(HeldLease held, bool markReleased)
    {
        if (held == null) return;
        try { if (markReleased) WriteLeaseMetadata(held, true); } catch { }
        try { held.Stream.Dispose(); } catch { }
    }

    private string Root(string systemId)
    {
        ValidateSystemId(systemId);
        lock (mapGate) { string root; if (roots.TryGetValue(systemId, out root)) return root; }
        throw new InvalidOperationException("Map the selected information system folder first.");
    }

    private string LocalWorkspaceRoot(string systemId)
    {
        string sharedRoot = Root(systemId), parent = Path.GetDirectoryName(mappingCachePath);
        if (String.IsNullOrWhiteSpace(parent)) parent = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InformationSystemUserTracker");
        string rootKey = Sha256(Path.GetFullPath(sharedRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).ToUpperInvariant()).Substring(0, 24);
        string workspace = Path.Combine(parent, "Local Workspaces", rootKey);
        // Custom/test profiles and some redirected corporate profiles can already
        // consume most of MAX_PATH before an evidence filename is appended. Keep
        // the normal documented location stable, but use a deterministic compact
        // form when the workspace base itself is unusually long.
        if (workspace.Length > 120) workspace = Path.Combine(parent, "W", rootKey.Substring(0, 16));
        Directory.CreateDirectory(workspace);
        bool harden;
        lock (localWorkspaceAclGate) harden = hardenedLocalWorkspaces.Add(workspace);
        if (harden)
        {
            try { HardenLocalWorkspaceAcl(workspace); }
            catch { lock (localWorkspaceAclGate) hardenedLocalWorkspaces.Remove(workspace);throw; }
        }
        return workspace;
    }

    private static string LocalWorkspaceManifestPath(string workspaceRoot)
    {
        string system = Path.Combine(workspaceRoot, SystemDirectoryName);Directory.CreateDirectory(system);
        return Path.Combine(system, LocalWorkspaceManifestFilename);
    }

    private static string LocalWorkspaceStatePath(string workspaceRoot)
    {
        string system = Path.Combine(workspaceRoot, SystemDirectoryName);Directory.CreateDirectory(system);
        return Path.Combine(system, LocalWorkspaceStateFilename);
    }

    private static string LocalWorkspacePublicationPath(string workspaceRoot)
    {
        string system = Path.Combine(workspaceRoot, SystemDirectoryName);Directory.CreateDirectory(system);return Path.Combine(system, LocalWorkspacePublicationFilename);
    }

    private static string LocalWorkspacePublicationProgressPath(string workspaceRoot)
    {
        string system = Path.Combine(workspaceRoot, SystemDirectoryName);Directory.CreateDirectory(system);return Path.Combine(system, LocalWorkspacePublicationProgressFilename);
    }

    private void WritePublicationJournal(string workspaceRoot, string phase, string baseSharedSha256, string targetStateHash, List<PublicationEvidence> staged, int completedCopies)
    {
        if (String.Equals(phase, "evidence-copy", StringComparison.Ordinal) || String.Equals(phase, "evidence-verified", StringComparison.Ordinal))
        {
            AppendPublicationProgress(workspaceRoot, phase, targetStateHash, completedCopies);
            return;
        }
        var items = staged.Select(item => (object)new Dictionary<string, object> { { "source", Relative(workspaceRoot, item.Source).Replace(Path.DirectorySeparatorChar, '/') }, { "destination", item.Relative }, { "sha256", item.Sha256 }, { "sourceSha256", item.SourceSha256 }, { "pdfSha256", item.PdfSha256 } }).ToArray();
        var journal = new Dictionary<string, object> { { "version", LocalWorkspacePublicationVersion }, { "updatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "phase", phase }, { "baseSharedSha256", baseSharedSha256 }, { "targetStateHash", targetStateHash }, { "completedCopies", completedCopies }, { "items", items } };
        WriteProtectedLocalJson(LocalWorkspacePublicationPath(workspaceRoot), "workspace-publication", json.Serialize(journal));
        if (String.Equals(phase, "prepared", StringComparison.Ordinal) || String.Equals(phase, "manifest-committed", StringComparison.Ordinal)) TryDelete(LocalWorkspacePublicationProgressPath(workspaceRoot));
    }

    private void AppendPublicationProgress(string workspaceRoot, string phase, string targetStateHash, int completedCopies)
    {
        var progress = new Dictionary<string, object> { { "version", LocalWorkspacePublicationVersion }, { "updatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "phase", phase }, { "targetStateHash", targetStateHash }, { "completedCopies", completedCopies } };
        byte[] clear = Encoding.UTF8.GetBytes(json.Serialize(progress)), protectedBytes = ProtectedData.Protect(clear, LocalWorkspaceEntropy("workspace-publication-progress"), DataProtectionScope.CurrentUser), line = Encoding.ASCII.GetBytes(Convert.ToBase64String(protectedBytes) + Environment.NewLine);
        string path = LocalWorkspacePublicationProgressPath(workspaceRoot);var info = new FileInfo(path);if (info.Exists && info.Length + line.LongLength > JournalLimit) throw new InvalidDataException("The local publication progress journal exceeds its safety limit.");
        using (var stream = OpenCompatibleFileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, Math.Max(4096, Math.Min(line.Length, 65536)))) { stream.Write(line, 0, line.Length);FlushCompatible(stream); }
    }

    private void RecordPublishedEvidence(string root, List<PublicationEvidence> staged)
    {
        if (staged == null || staged.Count == 0) return;
        string directory = SupportDirectory(root, PublicationDirectoryName);Dictionary<string, Dictionary<string, object>> shardReferences = EnsurePublishedEvidenceShards(root);
        foreach (var group in staged.GroupBy(item => PublicationOrganization(item.Relative), StringComparer.OrdinalIgnoreCase))
        {
            string organization = group.Key;var records = LoadPublishedEvidence(root, organization);
            foreach (PublicationEvidence item in group)
            {
                var info = new FileInfo(item.Destination);info.Refresh();if (!info.Exists) throw new FileNotFoundException("A published evidence file disappeared before its publication receipt was recorded.", item.Destination);
                string relative = item.Relative.Replace('\\', '/');records[relative] = new Dictionary<string, object> { { "path", relative }, { "size", info.Length }, { "lastModifiedUnixMs", new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds() }, { "sha256", item.Sha256 }, { "publishedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "publishedBy", actor } };
            }
            Dictionary<string, object> reference = WritePublishedEvidenceShard(directory, organization, records);shardReferences[organization] = reference;
        }
        WritePublishedEvidenceCatalog(directory, shardReferences);
    }

    private Dictionary<string, Dictionary<string, object>> LoadPublishedEvidence(string root, string organization = null)
    {
        var result = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);string directory = Path.Combine(root, SystemDirectoryName, PublicationDirectoryName), path = Path.Combine(directory, PublicationIndexFilename);Dictionary<string, Dictionary<string, object>> references;
        if (TryReadPublishedEvidenceCatalog(path, out references))
        {
            IEnumerable<Dictionary<string, object>> selected = String.IsNullOrWhiteSpace(organization) ? references.Values : references.Where(item => String.Equals(item.Key, organization, StringComparison.OrdinalIgnoreCase)).Select(item => item.Value);
            foreach (Dictionary<string, object> reference in selected) LoadPublishedEvidenceShard(directory, reference, result);
            return result;
        }
        return LoadLegacyPublishedEvidence(path, organization);
    }

    private Dictionary<string, Dictionary<string, object>> EnsurePublishedEvidenceShards(string root)
    {
        string directory = SupportDirectory(root, PublicationDirectoryName), catalogPath = Path.Combine(directory, PublicationIndexFilename);Dictionary<string, Dictionary<string, object>> references;
        if (TryReadPublishedEvidenceCatalog(catalogPath, out references)) return references;
        references = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
        Dictionary<string, Dictionary<string, object>> legacy = LoadLegacyPublishedEvidence(catalogPath, null);
        foreach (var group in legacy.Values.GroupBy(item => PublicationOrganization(Convert.ToString(item["path"], CultureInfo.InvariantCulture)), StringComparer.OrdinalIgnoreCase)) references[group.Key] = WritePublishedEvidenceShard(directory, group.Key, group.ToDictionary(item => Convert.ToString(item["path"], CultureInfo.InvariantCulture), item => item, StringComparer.OrdinalIgnoreCase));
        WritePublishedEvidenceCatalog(directory, references);return references;
    }

    private bool TryReadPublishedEvidenceCatalog(string path, out Dictionary<string, Dictionary<string, object>> references)
    {
        references = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
        try
        {
            if (!File.Exists(path) || !File.Exists(path + ".sha256")) return false;byte[] bytes = ReadAllBytesWithRetry(path, SyncIndexLimit);if (!VerifySidecarChecksum(path, bytes)) return false;
            Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(new UTF8Encoding(false, true).GetString(bytes)));if (!envelope.ContainsKey("storageFormat") || !String.Equals(Convert.ToString(envelope["storageFormat"], CultureInfo.InvariantCulture), PublicationIndexStorageFormat, StringComparison.Ordinal)) return false;
            object[] shards = ObjectArray(envelope["shards"]);if (shards.Length > 1000) return false;
            foreach (object value in shards) { Dictionary<string, object> reference = ObjectDictionary(value);string organization = ValidOrganizationName(Convert.ToString(reference["organization"], CultureInfo.InvariantCulture)), file = Convert.ToString(reference["file"], CultureInfo.InvariantCulture), hash = Convert.ToString(reference["sha256"], CultureInfo.InvariantCulture);if (!String.Equals(file, Path.GetFileName(file), StringComparison.Ordinal) || !file.StartsWith("published-", StringComparison.Ordinal) || !file.EndsWith(".json", StringComparison.Ordinal) || !IsSha256(hash)) return false;references[organization] = reference; }
            return true;
        }
        catch { references.Clear();return false; }
    }

    private Dictionary<string, Dictionary<string, object>> LoadLegacyPublishedEvidence(string path, string organization)
    {
        var result = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
        try
        {
            if (!File.Exists(path) || !File.Exists(path + ".sha256")) return result;byte[] bytes = ReadAllBytesWithRetry(path, SyncIndexLimit);if (!VerifySidecarChecksum(path, bytes)) return result;
            Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(new UTF8Encoding(false, true).GetString(bytes)));if (!envelope.ContainsKey("items") || Convert.ToInt32(envelope["version"], CultureInfo.InvariantCulture) != PublicationIndexVersion) return result;LoadPublishedEvidenceItems(ObjectArray(envelope["items"]), organization, result);
        }
        catch { result.Clear(); }
        return result;
    }

    private void LoadPublishedEvidenceShard(string directory, Dictionary<string, object> reference, Dictionary<string, Dictionary<string, object>> result)
    {
        string file = Convert.ToString(reference["file"], CultureInfo.InvariantCulture), expected = Convert.ToString(reference["sha256"], CultureInfo.InvariantCulture), path = Path.Combine(directory, PublicationIndexShardDirectoryName, file);byte[] bytes = ReadAllBytesWithRetry(path, SyncIndexLimit);
        if (!String.Equals(Sha256Bytes(bytes), expected, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A published-evidence organization shard failed its SHA-256 check.");
        Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(new UTF8Encoding(false, true).GetString(bytes)));if (Convert.ToInt32(envelope["version"], CultureInfo.InvariantCulture) != PublicationIndexShardVersion) throw new InvalidDataException("A published-evidence organization shard uses an unsupported version.");LoadPublishedEvidenceItems(ObjectArray(envelope["items"]), Convert.ToString(envelope["organization"], CultureInfo.InvariantCulture), result);
    }

    private static void LoadPublishedEvidenceItems(object[] items, string organization, Dictionary<string, Dictionary<string, object>> result)
    {
        if (items.Length > 100000) throw new InvalidDataException("The published-evidence provenance index exceeds its safety limit.");
        foreach (object value in items)
        {
            Dictionary<string, object> item = ObjectDictionary(value);string relative = Convert.ToString(item["path"], CultureInfo.InvariantCulture);long size = Convert.ToInt64(item["size"], CultureInfo.InvariantCulture), modified = Convert.ToInt64(item["lastModifiedUnixMs"], CultureInfo.InvariantCulture);string hash = Convert.ToString(item["sha256"], CultureInfo.InvariantCulture);
            if (String.IsNullOrWhiteSpace(relative) || size < 0 || modified < 0 || !IsSha256(hash) || !String.IsNullOrWhiteSpace(organization) && !String.Equals(PublicationOrganization(relative), organization, StringComparison.OrdinalIgnoreCase)) continue;result[relative] = item;
        }
    }

    private Dictionary<string, object> WritePublishedEvidenceShard(string directory, string organization, Dictionary<string, Dictionary<string, object>> records)
    {
        if (records.Count > 100000) throw new InvalidDataException("A published-evidence organization shard exceeds its safety limit.");
        string cleanOrganization = ValidOrganizationName(organization), filename = "published-" + Sha256(cleanOrganization.ToUpperInvariant()).Substring(0, 20) + ".json", shardDirectory = Path.Combine(directory, PublicationIndexShardDirectoryName), path = Path.Combine(shardDirectory, filename);Directory.CreateDirectory(shardDirectory);
        var envelope = new Dictionary<string, object> { { "version", PublicationIndexShardVersion }, { "organization", cleanOrganization }, { "updatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "items", records.Values.OrderBy(value => Convert.ToString(value["path"], CultureInfo.InvariantCulture), StringComparer.OrdinalIgnoreCase).Cast<object>().ToArray() } };
        byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(envelope));if (bytes.LongLength > SyncIndexLimit) throw new InvalidDataException("A published-evidence organization shard exceeds its size limit.");AtomicWrite(path, bytes);return new Dictionary<string, object> { { "organization", cleanOrganization }, { "file", filename }, { "sha256", Sha256Bytes(bytes) }, { "count", records.Count } };
    }

    private void WritePublishedEvidenceCatalog(string directory, Dictionary<string, Dictionary<string, object>> references)
    {
        string path = Path.Combine(directory, PublicationIndexFilename);var envelope = new Dictionary<string, object> { { "version", PublicationIndexVersion }, { "storageFormat", PublicationIndexStorageFormat }, { "updatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "shards", references.Values.OrderBy(value => Convert.ToString(value["organization"], CultureInfo.InvariantCulture), StringComparer.OrdinalIgnoreCase).Cast<object>().ToArray() } };
        byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(envelope));if (bytes.LongLength > SyncIndexLimit) throw new InvalidDataException("The published-evidence catalog exceeds its size limit.");AtomicWrite(path, bytes);AtomicWrite(path + ".sha256", Encoding.ASCII.GetBytes(Sha256Bytes(bytes) + "  " + PublicationIndexFilename + Environment.NewLine));
    }

    private static bool VerifySidecarChecksum(string path, byte[] bytes)
    {
        string[] checksumParts = File.ReadAllText(path + ".sha256", Encoding.ASCII).Trim().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);return checksumParts.Length == 2 && String.Equals(checksumParts[1], Path.GetFileName(path), StringComparison.Ordinal) && String.Equals(checksumParts[0], Sha256Bytes(bytes), StringComparison.OrdinalIgnoreCase);
    }

    private static string PublicationOrganization(string relative)
    {
        string[] parts = (relative ?? "").Replace('\\', '/').Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);if (parts.Length < 3 || !String.Equals(parts[0], "Organizations", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A published-evidence receipt has an invalid organization path.");return ValidOrganizationName(parts[1]);
    }

    private static bool PublishedEvidenceMatches(Dictionary<string, Dictionary<string, object>> published, string relative, long size, long modified)
    {
        Dictionary<string, object> item;if (published == null || !published.TryGetValue(relative, out item)) return false;
        try { return Convert.ToInt64(item["size"], CultureInfo.InvariantCulture) == size && Convert.ToInt64(item["lastModifiedUnixMs"], CultureInfo.InvariantCulture) == modified; }
        catch { return false; }
    }

    private static void DeletePublicationJournal(string workspaceRoot)
    {
        TryDelete(LocalWorkspacePublicationPath(workspaceRoot));TryDelete(LocalWorkspacePublicationProgressPath(workspaceRoot));
    }

    private LocalWorkspaceState ReadLocalWorkspaceState(string workspaceRoot)
    {
        try
        {
            string path = LocalWorkspaceStatePath(workspaceRoot);if (!File.Exists(path)) return null;
            Dictionary<string, object> value = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "workspace-state", 1024 * 1024)));
            if (!value.ContainsKey("version") || Convert.ToInt32(value["version"], CultureInfo.InvariantCulture) != LocalWorkspaceVersion) return null;
            string baseHash = Convert.ToString(value["baseSharedSha256"], CultureInfo.InvariantCulture);
            if (!IsSha256(baseHash)) return null;
            return new LocalWorkspaceState { BaseSharedSha256 = baseHash.ToLowerInvariant(), Dirty = value.ContainsKey("dirty") && Convert.ToBoolean(value["dirty"], CultureInfo.InvariantCulture), PulledAtUtc = value.ContainsKey("pulledAtUtc") ? Convert.ToString(value["pulledAtUtc"], CultureInfo.InvariantCulture) : "", SavedAtUtc = value.ContainsKey("savedAtUtc") ? Convert.ToString(value["savedAtUtc"], CultureInfo.InvariantCulture) : "" };
        }
        catch { return null; }
    }

    private void WriteLocalWorkspaceState(string workspaceRoot, LocalWorkspaceState state)
    {
        var value = new Dictionary<string, object> { { "version", LocalWorkspaceVersion }, { "baseSharedSha256", state.BaseSharedSha256 }, { "dirty", state.Dirty }, { "pulledAtUtc", state.PulledAtUtc ?? "" }, { "savedAtUtc", state.SavedAtUtc ?? "" } };
        WriteProtectedLocalJson(LocalWorkspaceStatePath(workspaceRoot), "workspace-state", json.Serialize(value));
    }

    private Dictionary<string, object> ReadLocalWorkspaceDatabase(string workspaceRoot)
    {
        string path = LocalWorkspaceManifestPath(workspaceRoot), checksumPath = path + ".sha256";
        if (!File.Exists(path) || !File.Exists(checksumPath)) throw new FileNotFoundException("The local working database is missing or incomplete.");
        byte[] bytes = File.ReadAllBytes(path);if (bytes.LongLength <= 0 || bytes.LongLength > ManifestLimit * 2) throw new InvalidDataException("The protected local working database is empty or exceeds the safety limit.");
        string expected = ReadText(checksumPath, 1024).Trim(), actual = Sha256Bytes(bytes);
        if (!IsSha256(expected) || !String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The local working database failed its SHA-256 integrity check.");
        string text = ReadProtectedLocalJson(path, "workspace-database", ManifestLimit);
        return ValidateDatabase(text);
    }

    private string WriteLocalWorkspaceDatabase(string workspaceRoot, Dictionary<string, object> database, string baseSharedSha256, bool dirty)
    {
        ValidateDatabaseObject(database);string now = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);database["updated"] = now;
        string clear = json.Serialize(database);if (Encoding.UTF8.GetByteCount(clear) > ManifestLimit) throw new InvalidDataException("The local working database exceeds the 50 MB safety limit.");
        string path = LocalWorkspaceManifestPath(workspaceRoot);WriteProtectedLocalJson(path, "workspace-database", clear);byte[] protectedBytes = File.ReadAllBytes(path);string hash = Sha256Bytes(protectedBytes);AtomicWrite(path + ".sha256", Encoding.ASCII.GetBytes(hash + Environment.NewLine));
        LocalWorkspaceState previous = ReadLocalWorkspaceState(workspaceRoot);WriteLocalWorkspaceState(workspaceRoot, new LocalWorkspaceState { BaseSharedSha256 = baseSharedSha256.ToLowerInvariant(), Dirty = dirty, PulledAtUtc = previous == null || String.IsNullOrWhiteSpace(previous.PulledAtUtc) ? now : previous.PulledAtUtc, SavedAtUtc = now });
        EnsureLocalWorkspaceOrganizationFolders(workspaceRoot, database);
        return now;
    }

    private static byte[] LocalWorkspaceEntropy(string purpose) { return Encoding.UTF8.GetBytes("RAPTOR protected local workspace v1\n" + purpose); }

    private void WriteProtectedLocalJson(string path, string purpose, string clearJson)
    {
        byte[] clear = Encoding.UTF8.GetBytes(clearJson), protectedBytes = ProtectedData.Protect(clear, LocalWorkspaceEntropy(purpose), DataProtectionScope.CurrentUser);
        var envelope = new Dictionary<string, object> { { "version", LocalWorkspaceProtectionVersion }, { "protection", "DPAPI-CurrentUser" }, { "purpose", purpose }, { "payload", Convert.ToBase64String(protectedBytes) } };
        AtomicWrite(path, Encoding.UTF8.GetBytes(json.Serialize(envelope)));
    }

    private string ReadProtectedLocalJson(string path, string purpose, long clearLimit)
    {
        string envelopeText = ReadText(path, Math.Min(Int32.MaxValue, checked((int)Math.Min(clearLimit * 2L, 100L * 1024 * 1024))));Dictionary<string, object> envelope;
        try { envelope = ObjectDictionary(json.DeserializeObject(envelopeText)); }
        catch (Exception) { throw new InvalidDataException("A protected local workspace record has an invalid envelope."); }
        if (!envelope.ContainsKey("version") || Convert.ToInt32(envelope["version"], CultureInfo.InvariantCulture) != LocalWorkspaceProtectionVersion || !String.Equals(Convert.ToString(envelope["protection"], CultureInfo.InvariantCulture), "DPAPI-CurrentUser", StringComparison.Ordinal) || !String.Equals(Convert.ToString(envelope["purpose"], CultureInfo.InvariantCulture), purpose, StringComparison.Ordinal)) throw new InvalidDataException("A protected local workspace record uses an invalid protection context.");
        byte[] protectedBytes, clear;
        try { protectedBytes = Convert.FromBase64String(Convert.ToString(envelope["payload"], CultureInfo.InvariantCulture));clear = ProtectedData.Unprotect(protectedBytes, LocalWorkspaceEntropy(purpose), DataProtectionScope.CurrentUser); }
        catch (Exception error) { throw new InvalidDataException("The protected local workspace record could not be decrypted for the current Windows user. " + CleanLine(error.Message, 200)); }
        if (clear.LongLength <= 0 || clear.LongLength > clearLimit) throw new InvalidDataException("The protected local workspace record is empty or exceeds its safety limit.");
        try { return new UTF8Encoding(false, true).GetString(clear).TrimStart('\uFEFF'); }
        catch (DecoderFallbackException) { throw new InvalidDataException("The protected local workspace record is not valid UTF-8 JSON."); }
    }

    private static void HardenLocalWorkspaceAcl(string workspace)
    {
        SecurityIdentifier current = WindowsIdentity.GetCurrent().User;if (current == null) throw new UnauthorizedAccessException("The active Windows identity has no security identifier for local workspace protection.");
        var security = new DirectorySecurity();security.SetAccessRuleProtection(true, false);
        const InheritanceFlags inheritance = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
        security.AddAccessRule(new FileSystemAccessRule(current, FileSystemRights.FullControl, inheritance, PropagationFlags.None, AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, inheritance, PropagationFlags.None, AccessControlType.Allow));
        Directory.SetAccessControl(workspace, security);
    }

    private static void EnsureLocalWorkspaceOrganizationFolders(string workspaceRoot, Dictionary<string, object> database)
    {
        string organizationsRoot = Path.Combine(workspaceRoot, "Organizations");Directory.CreateDirectory(organizationsRoot);
        var organizations = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (object value in ObjectArray(database["users"])) { Dictionary<string, object> user = ObjectDictionary(value);string organization = user.ContainsKey("organization") ? Convert.ToString(user["organization"], CultureInfo.InvariantCulture) : "";if (!String.IsNullOrWhiteSpace(organization)) organizations.Add(ValidOrganizationName(organization)); }
        foreach (string organization in organizations)
        {
            string directory = Path.Combine(organizationsRoot, organization);Directory.CreateDirectory(directory);
            Directory.CreateDirectory(Path.Combine(directory, SafePart(organization, 80) + " Incoming"));
            Directory.CreateDirectory(Path.Combine(directory, SafePart(organization, 80) + " Rework"));
            Directory.CreateDirectory(Path.Combine(directory, SafePart(organization, 80) + " Complete"));
        }
    }

    private Dictionary<string, string> PrepareLocalPublicationEvidence(string systemId, Dictionary<string, object> database, PublicationHashCache hashCache, List<string> warnings, HashSet<string> isolatedEvidenceFilenames, out int compressed)
    {
        compressed = 0;var renamed = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        lock (RootLock(systemId))
        {
            string root = LocalWorkspaceRoot(systemId);var records = ReadLocalEvidenceMap(systemId);ReconcileMissingPendingLocalEvidence(systemId, database, records, root, hashCache, warnings, isolatedEvidenceFilenames);bool recordsChanged = false;
            foreach (object userValue in ObjectArray(database["users"]))
            {
                Dictionary<string, object> user = ObjectDictionary(userValue);string organization = ValidOrganizationName(Convert.ToString(user["organization"], CultureInfo.InvariantCulture));
                foreach (object artifactValue in ObjectArray(user["artifacts"]))
                {
                    Dictionary<string, object> artifact = ObjectDictionary(artifactValue);string filename = Convert.ToString(artifact["filename"], CultureInfo.InvariantCulture);bool recordedPdf = filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase), recordedZip = filename.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
                    if (!recordedPdf && !recordedZip) continue;
                    string previous = artifact.ContainsKey("path") ? Convert.ToString(artifact["path"], CultureInfo.InvariantCulture).Replace('\\', '/') : "", canonical = previous, expected = artifact.ContainsKey("sha256") ? Convert.ToString(artifact["sha256"], CultureInfo.InvariantCulture) : "";
                    if (String.IsNullOrWhiteSpace(canonical) || IsOrganizationIncomingEvidencePath(canonical) || IsOrganizationReworkEvidencePath(canonical) || canonical.Split('/').Any(IsCompleteStorageDirectory) || !canonical.StartsWith("Organizations/", StringComparison.OrdinalIgnoreCase)) canonical = Path.Combine("Organizations", organization, OrganizationArtifactStorageFolder(ArtifactStorageFolder(Convert.ToString(artifact["kind"], CultureInfo.InvariantCulture)), organization), filename).Replace(Path.DirectorySeparatorChar, '/');
                    string zipCanonical = canonical.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ? canonical : canonical + ".zip", lookup = String.IsNullOrWhiteSpace(previous) ? canonical : previous, source = FindLocalPublicationSource(root, organization, filename, expected);Dictionary<string, object> mapped;
                    // Prefer a newly staged Incoming copy over an older Published Evidence
                    // receipt. This lets an idempotent Session Commit verify and drain a
                    // duplicate that was added after the original evidence was published.
                    if (String.IsNullOrWhiteSpace(source) && records.TryGetValue(zipCanonical, out mapped)) source = SafeRelativePath(root, Convert.ToString(mapped["localPath"], CultureInfo.InvariantCulture));
                    else if (String.IsNullOrWhiteSpace(source) && records.TryGetValue(lookup, out mapped)) source = SafeRelativePath(root, Convert.ToString(mapped["localPath"], CultureInfo.InvariantCulture));
                    else if (String.IsNullOrWhiteSpace(source)) source = SafeRelativePath(root, lookup);
                    if (String.IsNullOrWhiteSpace(source) || !File.Exists(source)) continue;
                    string sourceExpectedHash = source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) && recordedZip ? hashCache.Container(source) : source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ? hashCache.Pdf(source) : hashCache.Container(source);bool expectedMatches = !IsSha256(expected) || String.Equals(expected, sourceExpectedHash, StringComparison.OrdinalIgnoreCase);
                    if (!expectedMatches && recordedZip && source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    {
                        Dictionary<string, object> receipt;string incomingPdfHash = hashCache.Pdf(source);
                        expectedMatches = records.TryGetValue(zipCanonical, out receipt) && !Convert.ToBoolean(receipt["pending"], CultureInfo.InvariantCulture) && receipt.ContainsKey("pdfSha256") && String.Equals(incomingPdfHash, Convert.ToString(receipt["pdfSha256"], CultureInfo.InvariantCulture), StringComparison.OrdinalIgnoreCase);
                    }
                    if (!expectedMatches) throw new InvalidDataException("A recorded local evidence file changed before publication: " + filename);
                    string zip = source;bool compressedSource = source.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase);
                    if (compressedSource) { zip = CompressEvidenceFile(systemId, root, source, true);compressed++; }
                    string validationError;if (!TryValidateEvidenceFile(zip, out validationError)) throw new InvalidDataException("The prepared publication ZIP failed validation: " + validationError);
                    string zipFilename = Path.GetFileName(zipCanonical);hashCache.Invalidate(zip);string zipHash = hashCache.Container(zip);RegisterLocalEvidenceInMap(records, root, zip, zipCanonical, lookup, zipHash);recordsChanged = true;if (compressedSource) { WriteLocalEvidenceMap(systemId, records);recordsChanged = false; }artifact["filename"] = zipFilename;artifact["path"] = zipCanonical;artifact["sha256"] = zipHash;renamed[filename] = zipFilename;
                }
            }
            if (recordsChanged) WriteLocalEvidenceMap(systemId, records);
        }
        lock (RootLock(systemId))
        {
            string root = LocalWorkspaceRoot(systemId);var records = ReadLocalEvidenceMap(systemId);bool recordsChanged = false;
            foreach (Dictionary<string, object> item in records.Values.Where(item => Convert.ToBoolean(item["pending"], CultureInfo.InvariantCulture)).ToArray())
            {
                string destination = Convert.ToString(item["destination"], CultureInfo.InvariantCulture);
                if (!destination.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) || !ContainsManagedStorageDirectory(destination)) continue;
                string source = SafeRelativePath(root, Convert.ToString(item["localPath"], CultureInfo.InvariantCulture)), expected = Convert.ToString(item["sha256"], CultureInfo.InvariantCulture);
                string actual = File.Exists(source) ? hashCache.Container(source) : File.Exists(source + ".zip") ? hashCache.Pdf(source + ".zip") : "";
                if (!String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A retained local PDF changed before publication: " + Path.GetFileName(source));
                bool alreadyCompleted;string zip = CompressEvidenceFile(systemId, root, source, true, out alreadyCompleted);hashCache.Invalidate(zip);if (!alreadyCompleted) compressed++;
                RegisterLocalEvidenceInMap(records, root, zip, destination + ".zip", destination, hashCache.Container(zip));recordsChanged = true;WriteLocalEvidenceMap(systemId, records);recordsChanged = false;renamed[Path.GetFileName(destination)] = Path.GetFileName(destination) + ".zip";
            }
            if (recordsChanged) WriteLocalEvidenceMap(systemId, records);
        }
        return renamed;
    }

    private string FindLocalPublicationSource(string workspaceRoot, string organization, string filename, string expectedHash)
    {
        string organizationRoot = Path.Combine(workspaceRoot, "Organizations", organization), incoming = Path.Combine(organizationRoot, SafePart(organization, 80) + " Incoming", filename), loose = Path.Combine(organizationRoot, filename);
        var candidates = new List<string>();
        foreach (string candidate in new[] { incoming, loose }) if (File.Exists(candidate) && !candidates.Contains(candidate, StringComparer.OrdinalIgnoreCase)) candidates.Add(candidate);
        if (Directory.Exists(organizationRoot))
        {
            foreach (string directory in Directory.EnumerateDirectories(organizationRoot, "*", SearchOption.TopDirectoryOnly))
            {
                string name = Path.GetFileName(directory);if (IsReworkStorageDirectory(name) || IsCompleteStorageDirectory(name)) continue;
                string candidate = Path.Combine(directory, filename);if (File.Exists(candidate) && !candidates.Contains(candidate, StringComparer.OrdinalIgnoreCase)) candidates.Add(candidate);
            }
        }
        if (candidates.Count == 1) return candidates[0];
        if (IsSha256(expectedHash))
        {
            string[] verified = candidates.Where(candidate => String.Equals(expectedHash, candidate.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ? EvidencePdfSha256(candidate) : TryFileHash(candidate), StringComparison.OrdinalIgnoreCase)).ToArray();
            if (verified.Length == 1) return verified[0];
        }
        return null;
    }

    private static string PublicationCsvFilenames(string csv, Dictionary<string, string> renamed, HashSet<string> isolatedEvidenceFilenames = null)
    {
        if (renamed.Count == 0 && (isolatedEvidenceFilenames == null || isolatedEvidenceFilenames.Count == 0)) return csv;
        var output = new StringBuilder(csv.Length);var cells = new List<string>();int start = 0;bool quoted = false;
        for (int index = 0; index <= csv.Length; index++)
        {
            if (index < csv.Length && csv[index] == '"') { if (quoted && index + 1 < csv.Length && csv[index + 1] == '"') { index++;continue; }quoted = !quoted; }
            if (index < csv.Length && (quoted || csv[index] != ',' && csv[index] != '\r' && csv[index] != '\n')) continue;
            cells.Add(csv.Substring(start, index - start));
            if (index < csv.Length && csv[index] == ',') { start = index + 1;continue; }
            if (cells.Count > 12)
            {
                string organization = CsvCellValue(cells[3]), filename = CsvCellValue(cells[12]), replacement;
                if (isolatedEvidenceFilenames != null && isolatedEvidenceFilenames.Contains(organization + "\0" + filename)) { cells[11] = CsvCell("Missing");cells[12] = CsvCell(""); }
                else if (renamed.TryGetValue(filename, out replacement)) cells[12] = CsvCell(replacement);
            }
            output.Append(String.Join(",", cells));cells.Clear();
            if (index < csv.Length)
            {
                if (csv[index] == '\r' && index + 1 < csv.Length && csv[index + 1] == '\n') { output.Append("\r\n");index++; }
                else output.Append(csv[index]);
            }
            start = index + 1;
        }
        return output.ToString();
    }

    private static string CsvCellValue(string cell)
    {
        return cell.Length >= 2 && cell[0] == '"' && cell[cell.Length - 1] == '"' ? cell.Substring(1, cell.Length - 2).Replace("\"\"", "\"") : cell;
    }

    private static string CsvCell(string value) { return "\"" + (value ?? "").Replace("\"", "\"\"") + "\""; }

    private Dictionary<string, Dictionary<string, object>> ReadLocalEvidenceMap(string systemId)
    {
        string root = LocalWorkspaceRoot(systemId), path = SystemFile(root, LocalWorkspaceEvidenceFilename);
        var records = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path)) return records;
        Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "workspace-evidence", ManifestLimit)));
        if (Convert.ToInt32(envelope["version"], CultureInfo.InvariantCulture) != 1) throw new InvalidDataException("The local evidence map version is unsupported.");
        foreach (object value in ObjectArray(envelope["items"]))
        {
            if (records.Count >= 100000) throw new InvalidDataException("The local evidence map exceeds its safety limit.");
            Dictionary<string, object> item = ObjectDictionary(value);
            string destination = Convert.ToString(item["destination"], CultureInfo.InvariantCulture).Replace('\\', '/'), localPath = Convert.ToString(item["localPath"], CultureInfo.InvariantCulture).Replace('\\', '/');
            if (!destination.StartsWith("Organizations/", StringComparison.OrdinalIgnoreCase) || !localPath.StartsWith("Organizations/", StringComparison.OrdinalIgnoreCase) || !IsSha256(Convert.ToString(item["sha256"], CultureInfo.InvariantCulture))) throw new InvalidDataException("A local evidence-map entry is invalid.");
            SafeRelativePath(root, destination);SafeRelativePath(root, localPath);
            if (item.ContainsKey("publishedSha256"))
            {
                if (!IsSha256(Convert.ToString(item["publishedSha256"], CultureInfo.InvariantCulture)) || !item.ContainsKey("pdfSha256") || !IsSha256(Convert.ToString(item["pdfSha256"], CultureInfo.InvariantCulture)) || !item.ContainsKey("publicationSourceDestination")) throw new InvalidDataException("A local publication receipt is invalid.");
                string previous = Convert.ToString(item["publicationSourceDestination"], CultureInfo.InvariantCulture).Replace('\\', '/');if (!previous.StartsWith("Organizations/", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A local publication receipt has an invalid source path.");SafeRelativePath(root, previous);item["publicationSourceDestination"] = previous;
            }
            if (item.ContainsKey("aliases"))
            {
                var aliases = new List<string>();
                foreach (object aliasValue in ObjectArray(item["aliases"]))
                {
                    string alias = Convert.ToString(aliasValue, CultureInfo.InvariantCulture).Replace('\\', '/');
                    if (!alias.StartsWith("Organizations/", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A local evidence-map alias is invalid.");
                    SafeRelativePath(root, alias);if (!aliases.Contains(alias, StringComparer.OrdinalIgnoreCase)) aliases.Add(alias);
                }
                item["aliases"] = aliases.ToArray();
            }
            item["destination"] = destination;item["localPath"] = localPath;item["pending"] = Convert.ToBoolean(item["pending"], CultureInfo.InvariantCulture);records.Add(destination, item);
        }
        return records;
    }

    private void WriteLocalEvidenceMap(string systemId, Dictionary<string, Dictionary<string, object>> records)
    {
        string text = json.Serialize(new Dictionary<string, object> { { "version", 1 }, { "items", records.Values.OrderBy(item => Convert.ToString(item["destination"], CultureInfo.InvariantCulture), StringComparer.OrdinalIgnoreCase).Cast<object>().ToArray() } });
        if (Encoding.UTF8.GetByteCount(text) > ManifestLimit || records.Count > 100000) throw new InvalidDataException("The local evidence map exceeds its safety limit.");
        WriteProtectedLocalJson(SystemFile(LocalWorkspaceRoot(systemId), LocalWorkspaceEvidenceFilename), "workspace-evidence", text);
    }

    private Dictionary<string, Dictionary<string, object>> LocalEvidenceAliases(string systemId)
    {
        return ReadLocalEvidenceMap(systemId).Values.ToDictionary(item => Convert.ToString(item["localPath"], CultureInfo.InvariantCulture), item => item, StringComparer.OrdinalIgnoreCase);
    }

    private string LocalPublicEvidencePath(string systemId, string physicalPath)
    {
        string relative = Relative(LocalWorkspaceRoot(systemId), physicalPath).Replace(Path.DirectorySeparatorChar, '/');
        Dictionary<string, object> item;return LocalEvidenceAliases(systemId).TryGetValue(relative, out item) ? Convert.ToString(item["destination"], CultureInfo.InvariantCulture) : relative;
    }

    private void RegisterLocalEvidence(string systemId, string physicalPath, string destination, string previousDestination = null)
    {
        string root = LocalWorkspaceRoot(systemId), relative = Relative(root, physicalPath).Replace(Path.DirectorySeparatorChar, '/'), hash = TryFileHash(physicalPath);
        if (!IsSha256(hash)) throw new IOException("The locally prepared evidence failed SHA-256 verification.");
        var records = ReadLocalEvidenceMap(systemId);RegisterLocalEvidenceInMap(records, root, physicalPath, destination, previousDestination, hash);WriteLocalEvidenceMap(systemId, records);
    }

    private static void RegisterLocalEvidenceInMap(Dictionary<string, Dictionary<string, object>> records, string root, string physicalPath, string destination, string previousDestination, string hash)
    {
        string relative = Relative(root, physicalPath).Replace(Path.DirectorySeparatorChar, '/');destination = destination.Replace('\\', '/');SafeRelativePath(root, destination);
        if (!IsSha256(hash)) throw new IOException("The locally prepared evidence failed SHA-256 verification.");
        var aliases = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!String.IsNullOrWhiteSpace(previousDestination))
        {
            previousDestination = previousDestination.Replace('\\', '/');Dictionary<string, object> previous;
            aliases.Add(previousDestination);
            if (records.TryGetValue(previousDestination, out previous) && previous.ContainsKey("aliases")) foreach (object value in ObjectArray(previous["aliases"])) aliases.Add(Convert.ToString(value, CultureInfo.InvariantCulture).Replace('\\', '/'));
        }
        foreach (string key in records.Where(pair => String.Equals(Convert.ToString(pair.Value["localPath"], CultureInfo.InvariantCulture), relative, StringComparison.OrdinalIgnoreCase)).Select(pair => pair.Key).ToArray()) records.Remove(key);
        if (!String.IsNullOrWhiteSpace(previousDestination)) records.Remove(previousDestination);
        var record = new Dictionary<string, object> { { "destination", destination }, { "localPath", relative }, { "sha256", hash }, { "pending", true } };
        if (aliases.Count > 0) record["aliases"] = aliases.Where(alias => !String.Equals(alias, destination, StringComparison.OrdinalIgnoreCase)).OrderBy(alias => alias, StringComparer.OrdinalIgnoreCase).Cast<object>().ToArray();
        records[destination] = record;
    }

    private void ForgetLocalEvidence(string systemId, string physicalPath)
    {
        string relative = Relative(LocalWorkspaceRoot(systemId), physicalPath).Replace(Path.DirectorySeparatorChar, '/');var records = ReadLocalEvidenceMap(systemId);
        foreach (string key in records.Where(pair => String.Equals(Convert.ToString(pair.Value["localPath"], CultureInfo.InvariantCulture), relative, StringComparison.OrdinalIgnoreCase)).Select(pair => pair.Key).ToArray()) records.Remove(key);
        WriteLocalEvidenceMap(systemId, records);
    }

    private string LocalIncomingDirectory(string systemId, string organization)
    {
        string clean = ValidOrganizationName(organization), organizationRoot = Path.Combine(LocalEvidenceRoot(systemId), "Organizations", clean), directory = Path.Combine(organizationRoot, SafePart(clean, 80) + " Incoming");foreach (string suffix in new[] { " Incoming", " Rework", " Complete" }) Directory.CreateDirectory(Path.Combine(organizationRoot, SafePart(clean, 80) + suffix));return directory;
    }

    private string StageLocalArchive(string systemId, string source, string requestedFilename)
    {
        string root = LocalWorkspaceRoot(systemId), previous = LocalPublicEvidencePath(systemId, source);Tuple<string, string> organization = OrganizationStorageLocation(root, source);
        string filename = String.IsNullOrWhiteSpace(requestedFilename) ? Path.GetFileName(source) : SafePart(requestedFilename, 180);
        string sourceExtension = source.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase) ? ".pdf.zip" : Path.GetExtension(source);
        if (!filename.EndsWith(sourceExtension, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The archive filename must preserve the PDF or ZIP evidence extension.");
        string directory = Path.Combine(organization.Item1, SafePart(organization.Item2, 80) + " Complete", PendingUploadDirectoryName);Directory.CreateDirectory(directory);
        filename = FitFilenameForDirectory(directory, filename, sourceExtension);string destination = UniqueDestination(directory, filename), hash = TryFileHash(source);
        string archiveFolder = IsSaarFilename(filename) ? SafePart(organization.Item2, 60) + " SAAR Archive" : Path.Combine(SafePart(organization.Item2, 60) + " Archive", EvidenceOlderThanYears(filename, 5) ? "Superseded" : DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        string sharedRelative = Path.Combine("Organizations", organization.Item2, archiveFolder, Path.GetFileName(destination)).Replace(Path.DirectorySeparatorChar, '/');
        string transaction = BeginTransaction(root, "archive", source, destination, hash, "");File.Move(source, destination);FailAfter("archive-move");
        if (!String.Equals(TryFileHash(destination), hash, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The retained local evidence failed SHA-256 verification.");
        RegisterLocalEvidence(systemId, destination, sharedRelative, previous);CompleteTransaction(transaction);return sharedRelative;
    }

    private void MigrateLegacyRetainedEvidence(string systemId, string workspaceRoot)
    {
        string organizationsRoot = Path.Combine(workspaceRoot, "Organizations");
        if (!Directory.Exists(organizationsRoot)) return;
        Dictionary<string, Dictionary<string, object>> records = ReadLocalEvidenceMap(systemId);bool changed = false;
        foreach (Dictionary<string, object> item in records.Values)
        {
            string localPath = Convert.ToString(item["localPath"], CultureInfo.InvariantCulture).Replace('/', Path.DirectorySeparatorChar), source;
            try { source = SafeRelativePath(workspaceRoot, localPath); }
            catch { continue; }
            string[] parts = localPath.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 5 || !String.Equals(parts[0], "Organizations", StringComparison.OrdinalIgnoreCase) || !IsCompleteStorageDirectory(parts[2]) || !String.Equals(parts[3], LegacyRetainedEvidenceDirectoryName, StringComparison.OrdinalIgnoreCase) || !File.Exists(source)) continue;
            string targetName = Convert.ToBoolean(item["pending"], CultureInfo.InvariantCulture) ? PendingUploadDirectoryName : PublishedEvidenceDirectoryName;
            string targetDirectory = Path.Combine(workspaceRoot, "Organizations", parts[1], parts[2], targetName);Directory.CreateDirectory(targetDirectory);
            string destination = UniqueDestination(targetDirectory, Path.GetFileName(source)), priorPath = Convert.ToString(item["localPath"], CultureInfo.InvariantCulture);
            File.Move(source, destination);item["localPath"] = Relative(workspaceRoot, destination).Replace(Path.DirectorySeparatorChar, '/');
            try { WriteLocalEvidenceMap(systemId, records);changed = true; }
            catch { item["localPath"] = priorPath;if (File.Exists(destination) && !File.Exists(source)) File.Move(destination, source);throw; }
        }
        foreach (string organizationRoot in Directory.EnumerateDirectories(organizationsRoot, "*", SearchOption.TopDirectoryOnly))
        {
            string organization = Path.GetFileName(organizationRoot), legacy = Path.Combine(organizationRoot, SafePart(organization, 80) + " Complete", LegacyRetainedEvidenceDirectoryName);
            try { if (Directory.Exists(legacy) && !Directory.EnumerateFileSystemEntries(legacy).Any()) Directory.Delete(legacy); } catch { }
        }
        if (changed) WriteLocalEvidenceMap(systemId, records);
    }

    private string LocalEvidenceRoot(string systemId)
    {
        string workspace = LocalWorkspaceRoot(systemId);Directory.CreateDirectory(Path.Combine(workspace, "Organizations"));return workspace;
    }

    private string SyncOperationRoot(string systemId, bool fullRescan, bool legacyImport)
    {
        // Legacy filename recovery does not grant permission to enumerate the share.
        // Only an explicitly requested Full Rescan selects shared evidence storage.
        return fullRescan ? Root(systemId) : LocalEvidenceRoot(systemId);
    }

    private static string SupportDirectory(string root, string name)
    {
        string system = Path.Combine(root, SystemDirectoryName), directory = Path.Combine(system, name);
        Directory.CreateDirectory(directory);
        return directory;
    }

    private static string SystemFile(string root, string name)
    {
        string system = Path.Combine(root, SystemDirectoryName);Directory.CreateDirectory(system);
        return Path.Combine(system, name);
    }

    private static void MigrateSupportDirectories(string root)
    {
        string system = Path.Combine(root, SystemDirectoryName);Directory.CreateDirectory(system);
        foreach (string name in SupportDirectoryNames)
        {
            string legacy = Path.Combine(root, name);if (!Directory.Exists(legacy)) continue;
            string destination = Path.Combine(system, name);Directory.CreateDirectory(destination);
            MergeSupportDirectory(legacy, destination);
            try { if (!Directory.EnumerateFileSystemEntries(legacy).Any()) Directory.Delete(legacy); } catch { }
        }
        foreach (string name in OperationalRootFiles) MigrateOperationalRootFile(root, system, name);
    }

    private static void MigrateOperationalRootFile(string root, string system, string name)
    {
        string source = Path.Combine(root, name);if (!File.Exists(source)) return;
        string destination = Path.Combine(system, name);
        if (File.Exists(destination))
        {
            if (String.Equals(Sha256Bytes(File.ReadAllBytes(source)), Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) { File.Delete(source);return; }
            string stem = Path.GetFileNameWithoutExtension(name), extension = Path.GetExtension(name);
            destination = Path.Combine(system, stem + "_Legacy_" + Guid.NewGuid().ToString("N").Substring(0, 8) + extension);
        }
        File.Copy(source, destination, false);
        if (!String.Equals(Sha256Bytes(File.ReadAllBytes(source)), Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) { TryDelete(destination);throw new IOException("An operational-file migration copy failed its SHA-256 verification."); }
        File.Delete(source);
    }

    private static void MergeSupportDirectory(string source, string destination)
    {
        foreach (string directory in Directory.EnumerateDirectories(source))
        {
            string target = Path.Combine(destination, Path.GetFileName(directory));Directory.CreateDirectory(target);MergeSupportDirectory(directory, target);
            try { if (!Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory); } catch { }
        }
        foreach (string file in Directory.EnumerateFiles(source))
        {
            string target = Path.Combine(destination, Path.GetFileName(file));
            if (File.Exists(target))
            {
                if (String.Equals(Sha256Bytes(File.ReadAllBytes(file)), Sha256Bytes(File.ReadAllBytes(target)), StringComparison.OrdinalIgnoreCase)) { File.Delete(file);continue; }
                string stem = Path.GetFileNameWithoutExtension(file), extension = Path.GetExtension(file);target = Path.Combine(destination, stem + "_Legacy_" + Guid.NewGuid().ToString("N").Substring(0, 8) + extension);
            }
            File.Copy(file, target, false);
            if (!String.Equals(Sha256Bytes(File.ReadAllBytes(file)), Sha256Bytes(File.ReadAllBytes(target)), StringComparison.OrdinalIgnoreCase)) { TryDelete(target);throw new IOException("A support-folder migration copy failed its SHA-256 verification."); }
            File.Delete(file);
        }
    }

    private string BeginTransaction(string root, string operation, string source, string destination, string sourceHash, string destinationHash)
    {
        string directory = SupportDirectory(root, "Storage Transactions");
        string transactionGuid = Guid.NewGuid().ToString("N");
        string id = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffffffZ", CultureInfo.InvariantCulture) + "-" + transactionGuid;
        // Keep the timestamped identifier in the journal payload, but use the shorter
        // GUID-only leaf name so transaction recovery also works from long CI, VPN,
        // OneDrive, and organization paths on legacy Windows filesystem APIs.
        string path = Path.Combine(directory, "transaction-" + transactionGuid + ".json");
        var value = new Dictionary<string, object> { { "version", StorageTransactionVersion }, { "id", id }, { "operation", operation }, { "createdAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "source", RelativeOrSelf(root, source) }, { "destination", RelativeOrSelf(root, destination) }, { "sourceHash", sourceHash ?? "" }, { "destinationHash", destinationHash ?? "" }, { "state", "prepared" } };
        AtomicWrite(path, Encoding.UTF8.GetBytes(json.Serialize(value)));return path;
    }

    private void RecoverTransactions(string root)
    {
        string directory = SupportDirectory(root, "Storage Transactions");
        string[] paths = Directory.EnumerateFiles(directory, "transaction-*.json", SearchOption.TopDirectoryOnly).OrderBy(path => path, StringComparer.Ordinal).Take(1001).ToArray();
        if (paths.Length > 1000) throw new InvalidDataException("The recoverable storage transaction count exceeds the safety limit.");
        foreach (string path in paths)
        {
            Dictionary<string, object> item;
            try { item = ObjectDictionary(json.DeserializeObject(ReadText(path, 1024 * 1024))); }
            catch (Exception error) { throw new InvalidDataException("A storage transaction journal is unreadable: " + Path.GetFileName(path) + ". " + CleanLine(error.Message, 200)); }
            if (Convert.ToInt32(item["version"], CultureInfo.InvariantCulture) != StorageTransactionVersion) throw new InvalidDataException("A storage transaction uses an unsupported version.");
            string operation = Convert.ToString(item["operation"], CultureInfo.InvariantCulture), source = SafeRelativeOrSelf(root, Convert.ToString(item["source"], CultureInfo.InvariantCulture)), destination = SafeRelativeOrSelf(root, Convert.ToString(item["destination"], CultureInfo.InvariantCulture)), sourceHash = Convert.ToString(item["sourceHash"], CultureInfo.InvariantCulture), destinationHash = Convert.ToString(item["destinationHash"], CultureInfo.InvariantCulture);
            if (operation == "compression" || operation == "compression-delete-source")
            {
                bool removeVerifiedSource = operation == "compression-delete-source";
                if (File.Exists(destination))
                {
                    string validationError;if (!TryValidateEvidenceFile(destination, out validationError)) { if (File.Exists(source)) { TryDelete(destination);CompleteTransaction(path);continue; } throw new InvalidDataException("An interrupted evidence compression left an invalid ZIP without its source PDF."); }
                    if (!String.IsNullOrEmpty(sourceHash) && !String.Equals(sourceHash, EvidencePdfSha256(destination), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("An interrupted evidence compression found different PDF content at the ZIP destination. Both files were preserved for collision review.");
                    if (File.Exists(source))
                    {
                        if (!String.IsNullOrEmpty(sourceHash) && !String.Equals(sourceHash, EvidencePdfSha256(source), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("An interrupted evidence compression source changed after the transaction began. Both files were preserved for collision review.");
                        if (removeVerifiedSource && !String.IsNullOrEmpty(sourceHash)) { File.Delete(source);if (File.Exists(source)) throw new IOException("An interrupted evidence compression could not remove its verified source PDF."); }
                    }
                    CompleteTransaction(path);continue;
                }
                if (File.Exists(source)) { CompleteTransaction(path);continue; }
                throw new InvalidDataException("An interrupted evidence compression lost both source and destination files.");
            }
            if (operation == "rework-extract" || operation == "unarchive-extract")
            {
                string extractionLabel = operation == "rework-extract" ? "Rework" : "Unarchive";
                bool extractSourceExists = File.Exists(source), extractDestinationExists = File.Exists(destination);
                if (extractDestinationExists)
                {
                    string validationError;if (!TryValidateEvidenceFile(destination, out validationError) || !destination.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("An interrupted " + extractionLabel + " extraction left an invalid destination PDF.");
                    if (!String.IsNullOrEmpty(destinationHash) && !String.Equals(destinationHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("An interrupted " + extractionLabel + " extraction found different PDF content at the destination.");
                    if (extractSourceExists)
                    {
                        if (!String.IsNullOrEmpty(sourceHash) && !String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(source)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("An interrupted " + extractionLabel + " extraction source ZIP changed after the transaction began. Both files were preserved for review.");
                    }
                    CompleteTransaction(path);continue;
                }
                if (extractSourceExists) { CompleteTransaction(path);continue; }
                throw new InvalidDataException("An interrupted " + extractionLabel + " extraction lost both source and destination files.");
            }
            if (operation == "manifest-write")
            {
                if (!File.Exists(destination)) { CompleteTransaction(path);continue; }
                string currentHash = Sha256Bytes(File.ReadAllBytes(destination));
                if ((!String.IsNullOrEmpty(destinationHash) && String.Equals(currentHash, destinationHash, StringComparison.OrdinalIgnoreCase)) || (!String.IsNullOrEmpty(sourceHash) && String.Equals(currentHash, sourceHash, StringComparison.OrdinalIgnoreCase))) { WriteManifestChecksum(destination, currentHash);CompleteTransaction(path);continue; }
                throw new InvalidDataException("An interrupted manifest transaction could not be reconciled safely.");
            }
            bool sourceExists = File.Exists(source), destinationExists = File.Exists(destination);
            if (!sourceExists && destinationExists)
            {
                if (!String.IsNullOrEmpty(sourceHash) && !String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("A recovered file move failed its SHA-256 integrity check.");
                CompleteTransaction(path);continue;
            }
            if (sourceExists && !destinationExists) { CompleteTransaction(path);continue; }
            if (sourceExists && destinationExists && !String.IsNullOrEmpty(sourceHash) && String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) { TryDelete(destination);CompleteTransaction(path);continue; }
            throw new InvalidDataException("An interrupted file transaction requires manual review: " + Path.GetFileName(path) + ".");
        }
    }

    private static string RelativeOrSelf(string root, string path) { return String.Equals(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) ? "." : Relative(root, path).Replace(Path.DirectorySeparatorChar, '/'); }
    private static string SafeRelativeOrSelf(string root, string relative) { return relative == "." ? root : SafeRelativePath(root, relative); }
    private static void CompleteTransaction(string path) { if (File.Exists(path)) File.Delete(path); }
    private static void FailAfter(string stage) { if (String.Equals(FailAfterStageForTests, stage, StringComparison.Ordinal)) { FailAfterStageForTests = null;throw new IOException("Injected interruption after " + stage + "."); } }

    private void RememberLastSystem(string systemId)
    {
        lock (mapGate) lastSystemId = systemId;
        SaveMappingCache();
    }

    private void LoadMappingCache()
    {
        try
        {
            if (!File.Exists(mappingCachePath) || new FileInfo(mappingCachePath).Length > 1024 * 1024) return;
            Dictionary<string, object> value = ObjectDictionary(json.DeserializeObject(File.ReadAllText(mappingCachePath, Encoding.UTF8)));
            if (Convert.ToInt32(value["version"], CultureInfo.InvariantCulture) != MappingCacheVersion) return;
            object[] mappings = ObjectArray(value["mappings"]);
            if (mappings.Length > 1000) return;
            foreach (object item in mappings)
            {
                Dictionary<string, object> mapping = ObjectDictionary(item);
                string systemId = Convert.ToString(mapping["systemId"], CultureInfo.InvariantCulture), path = Convert.ToString(mapping["path"], CultureInfo.InvariantCulture);
                ValidateSystemId(systemId);
                if (String.IsNullOrWhiteSpace(path) || path.Length > 32767 || !Path.IsPathRooted(path)) continue;
                cachedRoots[systemId] = Path.GetFullPath(path);
            }
            string selected = value.ContainsKey("lastSystemId") ? Convert.ToString(value["lastSystemId"], CultureInfo.InvariantCulture) : "";
            if (!String.IsNullOrWhiteSpace(selected) && cachedRoots.ContainsKey(selected)) lastSystemId = selected;
        }
        catch { cachedRoots.Clear(); lastSystemId = null; }
    }

    private void SaveMappingCache()
    {
        try
        {
            KeyValuePair<string, string>[] mappings;
            string selected;
            lock (mapGate) { mappings = cachedRoots.ToArray(); selected = lastSystemId; }
            var items = mappings.Select(mapping => (object)new Dictionary<string, object> { { "systemId", mapping.Key }, { "path", mapping.Value } }).ToArray();
            var value = new Dictionary<string, object> { { "version", MappingCacheVersion }, { "lastSystemId", selected ?? "" }, { "mappings", items } };
            AtomicWrite(mappingCachePath, Encoding.UTF8.GetBytes(json.Serialize(value)));
        }
        catch { }
    }

    private object RootLock(string systemId) { lock (mapGate) { Root(systemId); return rootLocks[systemId]; } }
    private object LeaseLock(string systemId) { lock (mapGate) { Root(systemId); object gate;if (!leaseLocks.TryGetValue(systemId, out gate)) { gate = new object();leaseLocks[systemId] = gate; }return gate; } }

    private static string SafeBackupPath(string directory, string filename)
    {
        if (String.IsNullOrEmpty(filename) || filename != Path.GetFileName(filename) || !filename.StartsWith("user-tracker-", StringComparison.Ordinal) || !(filename.EndsWith(".json", StringComparison.OrdinalIgnoreCase) || filename.EndsWith(".json.gz", StringComparison.OrdinalIgnoreCase))) throw new InvalidDataException("The backup filename is invalid.");
        return SafeRelativePath(directory, filename);
    }

    private static string SafeRelativePath(string root, string relative)
    {
        if (String.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative)) throw new InvalidDataException("The requested file path is invalid.");
        string fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("The requested file is outside the mapped system folder.");
        EnsureReparseSafePath(fullRoot.TrimEnd(Path.DirectorySeparatorChar), full);
        return full;
    }

    internal static void EnsureReparseSafePath(string root, string candidate)
    {
        string fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), fullCandidate = Path.GetFullPath(candidate);
        if (!String.Equals(fullCandidate.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), fullRoot, StringComparison.OrdinalIgnoreCase) && !fullCandidate.StartsWith(fullRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("The requested file is outside the mapped system folder.");
        string relative = String.Equals(fullCandidate.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), fullRoot, StringComparison.OrdinalIgnoreCase) ? "" : fullCandidate.Substring(fullRoot.Length + 1);
        string current = fullRoot;
        CheckEscapingReparsePoint(current);
        foreach (string segment in relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            if (!File.Exists(current) && !Directory.Exists(current)) break;
            CheckEscapingReparsePoint(current);
        }
    }

    private static void CheckEscapingReparsePoint(string path)
    {
        uint? overridden = ReparseTagOverrideForTests == null ? (uint?)null : ReparseTagOverrideForTests(path);
        if (overridden.HasValue)
        {
            if (ReparseTagMayEscapeMappedTree(overridden.Value)) throw new UnauthorizedAccessException("The requested path crosses a symbolic link or junction and is not allowed.");
            return;
        }
        FileAttributes attributes;
        try { attributes = File.GetAttributes(path); }
        catch (FileNotFoundException) { return; }
        catch (DirectoryNotFoundException) { return; }
        if ((attributes & FileAttributes.ReparsePoint) == 0) return;
        NativeFindData data;IntPtr handle = FindFirstFileW(path, out data);
        if (handle == InvalidFindHandle) throw new UnauthorizedAccessException("The requested reparse point could not be verified safely.");
        try { if (ReparseTagMayEscapeMappedTree(data.Reserved0)) throw new UnauthorizedAccessException("The requested path crosses a symbolic link or junction and is not allowed."); }
        finally { FindClose(handle); }
    }

    private string ResolveEvidencePath(string systemId, string relative, out string evidenceRoot)
    {
        string localRoot = LocalEvidenceRoot(systemId), localPath = null, normalizedRelative = relative.Replace('\\', '/');Dictionary<string, object> staged;var records = ReadLocalEvidenceMap(systemId);
        if (records.TryGetValue(normalizedRelative, out staged) && Convert.ToBoolean(staged["pending"], CultureInfo.InvariantCulture))
        {
            localPath = SafeRelativePath(localRoot, Convert.ToString(staged["localPath"], CultureInfo.InvariantCulture));
            if (File.Exists(localPath)) { evidenceRoot = localRoot;return localPath; }
            if (Convert.ToBoolean(staged["pending"], CultureInfo.InvariantCulture)) throw new FileNotFoundException("The pending local evidence file no longer exists.");
        }
        try { localPath = SafeRelativePath(localRoot, relative); }
        catch (PathTooLongException) { }
        if (!String.IsNullOrEmpty(localPath) && (File.Exists(localPath) || Directory.Exists(localPath))) { evidenceRoot = localRoot;return localPath; }
        foreach (Dictionary<string, object> record in records.Values)
        {
            if (!record.ContainsKey("aliases") || !ObjectArray(record["aliases"]).Any(value => String.Equals(Convert.ToString(value, CultureInfo.InvariantCulture), normalizedRelative, StringComparison.OrdinalIgnoreCase))) continue;
            localPath = SafeRelativePath(localRoot, Convert.ToString(record["localPath"], CultureInfo.InvariantCulture));
            if (File.Exists(localPath)) { evidenceRoot = localRoot;return localPath; }
        }
        string sharedRoot = Root(systemId);evidenceRoot = sharedRoot;return SafeRelativePath(sharedRoot, relative);
    }

    private static bool IsArchiveEvidencePath(string relative)
    {
        string[] parts = (relative ?? "").Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);
        for (int index = 0; index < parts.Length - 1; index++) if (IsPermanentSaarArchiveDirectory(parts[index]) || String.Equals(parts[index], "Archive", StringComparison.OrdinalIgnoreCase) || parts[index].EndsWith(" Archive", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static string SafeSelectedPath(string root, string selected)
    {
        if (String.IsNullOrWhiteSpace(selected) || selected.StartsWith(@"\\?\", StringComparison.Ordinal) || selected.StartsWith(@"\\.\", StringComparison.Ordinal)) throw new InvalidDataException("The selected Unarchive path is invalid.");
        string full = Path.GetFullPath(selected), fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (String.Equals(full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), fullRoot, StringComparison.OrdinalIgnoreCase)) { EnsureReparseSafePath(fullRoot, fullRoot);return fullRoot; }
        Relative(root, full);
        EnsureReparseSafePath(fullRoot, full);
        return full;
    }

    private static string Relative(string root, string path)
    {
        string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, full = Path.GetFullPath(path);
        if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("A scanned file is outside the mapped folder.");
        return full.Substring(prefix.Length);
    }

    private static bool IsManagedStorageDirectory(string name)
    {
        string value = (name ?? "").Trim();
        return String.Equals(value, SystemDirectoryName, StringComparison.OrdinalIgnoreCase) || String.Equals(value, TemplateDirectoryName, StringComparison.OrdinalIgnoreCase) || String.Equals(value, ErrorReportsDirectoryName, StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Audit Logs", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "backup", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Archive Review", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Rework", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Reports", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Sync Journals", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Storage Transactions", StringComparison.OrdinalIgnoreCase) || value.EndsWith(" Rework", StringComparison.OrdinalIgnoreCase) || value.EndsWith(" Archive", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsArtifactStorageDirectory(string name)
    {
        string value = (name ?? "").Trim();
        return ArtifactDirectoryNames.Any(item => String.Equals(value, item, StringComparison.OrdinalIgnoreCase) || value.EndsWith(" " + item, StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsIncomingStorageDirectory(string name)
    {
        string value = (name ?? "").Trim();
        return String.Equals(value, "Incoming", StringComparison.OrdinalIgnoreCase) || value.EndsWith(" Incoming", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPermanentSaarArchiveDirectory(string name)
    {
        string value = (name ?? "").Trim();
        return String.Equals(value, "SAAR Archive", StringComparison.OrdinalIgnoreCase) || value.EndsWith(" SAAR Archive", StringComparison.OrdinalIgnoreCase);
    }

    private static bool LooksLikeSaarFilename(string filename)
    {
        string value = Path.GetFileName(filename ?? "");
        return value.IndexOf("SAAR", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static bool ContainsManagedStorageDirectory(string relative)
    {
        string[] parts = relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);
        for (int index = 0; index < parts.Length - 1; index++) if (IsManagedStorageDirectory(parts[index])) return true;
        return false;
    }

    private static bool IsOrganizationReworkEvidencePath(string relative)
    {
        string[] parts = relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);
        bool foundRework = false;
        for (int index = 0; index < parts.Length - 1; index++)
        {
            if (IsReworkStorageDirectory(parts[index])) { foundRework = true;continue; }
            if (IsManagedStorageDirectory(parts[index])) return false;
        }
        return foundRework;
    }

    private static bool IsOrganizationIncomingEvidencePath(string relative)
    {
        string[] parts = relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);
        bool foundIncoming = false;
        for (int index = 0; index < parts.Length - 1; index++)
        {
            if (IsIncomingStorageDirectory(parts[index])) { foundIncoming = true;continue; }
            if (IsManagedStorageDirectory(parts[index])) return false;
        }
        return foundIncoming;
    }

    private static string ComparableStorageName(string value)
    {
        var result = new StringBuilder();
        foreach (char character in value ?? "") if (Char.IsLetterOrDigit(character)) result.Append(Char.ToUpperInvariant(character));
        return result.ToString();
    }

    private static bool ReservedOrganizationName(string value)
    {
        string comparable = ComparableStorageName(value), upper = (value ?? "").Trim().ToUpperInvariant();
        string[] reserved = { "ORGANIZATIONS", "USEREVIDENCE", "ACTIVE", "ACTIVEEVIDENCE", "EVIDENCE", "GENERAL", "GENERALUSERS", "PRIVILEGED", "PRIVILEGEDUSERS", "USERS", "USERRECORDS", "USERACCOUNTS", "SAAR", "DODCYBERCERT", "USERAGREEMENT", "8140CERTIFICATIONMEMO", "PRIVILEGEDUSERTRAINING", "DTATRAINING", "INCOMING", "SYSTEM", "ERRORREPORTS", "AUDITLOGS", "BACKUP", "ARCHIVEREVIEW", "REPORTS", "SYNCJOURNALS", "STORAGETRANSACTIONS" };
        return reserved.Contains(comparable, StringComparer.OrdinalIgnoreCase) || Regex.IsMatch(value ?? "", @"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) || upper.EndsWith(" REWORK", StringComparison.OrdinalIgnoreCase) || upper.EndsWith(" ARCHIVE", StringComparison.OrdinalIgnoreCase) || upper.EndsWith(" INCOMING", StringComparison.OrdinalIgnoreCase);
    }

    private static string ValidOrganizationName(string value)
    {
        string raw = (value ?? "").Trim(), safe = SafePart(raw, 80);
        if (String.IsNullOrWhiteSpace(raw) || raw.Length > 80 || !String.Equals(raw, safe, StringComparison.Ordinal) || ReservedOrganizationName(raw)) throw new InvalidDataException("The organization name is invalid or reserved for application storage.");
        return raw;
    }

    public string RestoreActiveEvidence(string systemId, byte[] requestBytes)
    {
        lock (RootLock(systemId))
        {
            string root = Root(systemId);RecoverTransactions(root);
            if (requestBytes == null || requestBytes.LongLength == 0 || requestBytes.LongLength > 20L * 1024 * 1024) throw new InvalidDataException("The active-evidence recovery request is empty or too large.");
            Dictionary<string, object> request = ObjectDictionary(json.DeserializeObject(new UTF8Encoding(false, true).GetString(requestBytes)));
            object rawItems;if (!request.TryGetValue("items", out rawItems)) throw new InvalidDataException("The active-evidence recovery request is missing its item list.");
            object[] items = ObjectArray(rawItems);if (items.Length > 100000) throw new InvalidDataException("The active-evidence recovery request exceeds the item limit.");
            var restored = new List<Dictionary<string, object>>();var errors = new List<Dictionary<string, object>>();
            var archivesByOrganization = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            foreach (object raw in items)
            {
                string userId = "", filename = "";
                try
                {
                    Dictionary<string, object> item = ObjectDictionary(raw);userId = CleanLine(Convert.ToString(item["userId"], CultureInfo.InvariantCulture), 200);string organization = ValidOrganizationName(Convert.ToString(item["organization"], CultureInfo.InvariantCulture)), kind = CleanLine(Convert.ToString(item["kind"], CultureInfo.InvariantCulture), 100), folder = ArtifactStorageFolder(kind);filename = CleanLine(Convert.ToString(item["filename"], CultureInfo.InvariantCulture), 180);string expectedHash = item.ContainsKey("sha256") ? CleanLine(Convert.ToString(item["sha256"], CultureInfo.InvariantCulture), 64).ToLowerInvariant() : "", recordedPath = item.ContainsKey("path") ? CleanLine(Convert.ToString(item["path"], CultureInfo.InvariantCulture), 32767) : "";
                    if (String.IsNullOrWhiteSpace(userId) || String.IsNullOrWhiteSpace(filename) || !String.Equals(filename, SafePart(Path.GetFileName(filename), 180), StringComparison.Ordinal) || (!filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && !filename.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))) throw new InvalidDataException("The associated evidence identity, filename, or extension is invalid.");
                    if (!String.IsNullOrWhiteSpace(expectedHash) && !IsSha256(expectedHash)) throw new InvalidDataException("The associated evidence SHA-256 value is invalid.");
                    if (!String.IsNullOrWhiteSpace(recordedPath))
                    {
                        string recorded = SafeRelativePath(root, recordedPath), normalizedRecorded = Relative(root, recorded);
                        if (File.Exists(recorded) && !ContainsManagedStorageDirectory(normalizedRecorded)) continue;
                    }
                    List<string> archivedFiles;
                    if (!archivesByOrganization.TryGetValue(organization, out archivedFiles)) { archivedFiles = EnumerateOrganizationArchiveFiles(root, organization);archivesByOrganization[organization] = archivedFiles; }
                    List<string> nameMatches = archivedFiles.Where(path => ArchivedNameMatches(filename, Path.GetFileName(path), !String.IsNullOrWhiteSpace(expectedHash))).ToList(), verified = new List<string>();
                    foreach (string path in nameMatches)
                    {
                        if (String.IsNullOrWhiteSpace(expectedHash)) verified.Add(path);
                        else { try { if (String.Equals(expectedHash, Sha256Bytes(File.ReadAllBytes(path)), StringComparison.OrdinalIgnoreCase)) verified.Add(path); } catch (Exception hashError) { errors.Add(ActiveRecoveryError(userId, filename, "An Archive candidate could not be hashed: " + CleanLine(hashError.Message, 220))); } }
                    }
                    if (verified.Count == 0) continue;
                    if (verified.Count > 1) throw new InvalidDataException("More than one archived file matches this active evidence association. Resolve the duplicate in Clean Up before recovery.");
                    string source = verified[0], organizationRoot = OrganizationScopeRoot(root, organization), destinationDirectory = Path.Combine(organizationRoot, OrganizationArtifactStorageFolder(folder, organization)), destination = Path.Combine(destinationDirectory, filename);Directory.CreateDirectory(destinationDirectory);
                    string sourceHash = Sha256Bytes(File.ReadAllBytes(source));
                    if (File.Exists(destination))
                    {
                        if (!String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The active document-type folder already contains a different file with this associated filename.");
                        restored.Add(ActiveRecoveryResult(userId, kind, filename, Relative(root, source), Relative(root, destination), true));continue;
                    }
                    string transaction = BeginTransaction(root, "restore-active", source, destination, sourceHash, "");File.Move(source, destination);FailAfter("restore-active-move");
                    try { if (!String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The restored active evidence failed its SHA-256 integrity check."); }
                    catch { if (!File.Exists(source) && File.Exists(destination)) File.Move(destination, source);throw; }
                    CompleteTransaction(transaction);string sourceRelative = Relative(root, source).Replace(Path.DirectorySeparatorChar, '/'), destinationRelative = Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/');restored.Add(ActiveRecoveryResult(userId, kind, filename, sourceRelative, destinationRelative, false));
                }
                catch (Exception error) { errors.Add(ActiveRecoveryError(userId, filename, CleanLine(error.Message, 300))); }
            }
            return json.Serialize(new Dictionary<string, object> { { "restored", restored.ToArray() }, { "errors", errors.ToArray() }, { "checked", items.Length } });
        }
    }

    private static Dictionary<string, object> ActiveRecoveryResult(string userId, string kind, string filename, string source, string path, bool alreadyActive) { return new Dictionary<string, object> { { "userId", userId }, { "kind", kind }, { "filename", filename }, { "source", (source ?? "").Replace(Path.DirectorySeparatorChar, '/') }, { "path", (path ?? "").Replace(Path.DirectorySeparatorChar, '/') }, { "alreadyActive", alreadyActive } }; }
    private static Dictionary<string, object> ActiveRecoveryError(string userId, string filename, string message) { return new Dictionary<string, object> { { "userId", userId ?? "" }, { "filename", filename ?? "" }, { "message", message ?? "Active evidence recovery failed." } }; }
    private static string ArtifactStorageFolder(string kind)
    {
        string normalized = (kind ?? "").Trim().ToUpperInvariant();
        if (normalized == "SAAR") return "SAAR";if (normalized == "DOD CYBER CERT") return "DoD Cyber Cert";if (normalized == "USER AGREEMENT" || normalized == "GEN USER AGREEMENT" || normalized == "GEN AND PRIV AGREEMENT" || normalized == "DTA AGREEMENT") return "User Agreement";if (normalized == "8140 CERT MEMO") return "8140 Certification Memo";if (normalized == "PRIVILEGED USER TRAINING CERT") return "Privileged User Training";if (normalized == "DTA TRAINING" || normalized == "DTA TRAINING CERT") return "DTA Training";
        throw new InvalidDataException("The associated evidence document type is invalid.");
    }
    private static string OrganizationArtifactStorageFolder(string folder, string organization)
    {
        string canonical = ArtifactDirectoryNames.FirstOrDefault(item => String.Equals(item, folder, StringComparison.OrdinalIgnoreCase));
        if (canonical == null) throw new InvalidDataException("The evidence document-type folder is invalid.");
        return SafePart(ValidOrganizationName(organization), 80) + " " + canonical;
    }
    private static void EnsureOrganizationDocumentFolders(string root, bool includeIncoming = false)
    {
        string organizations = Path.Combine(root, "Organizations");if (!Directory.Exists(organizations)) return;
        foreach (string directory in EnumerateScanDirectories(root, organizations))
        {
            string organization = Path.GetFileName(directory);if (ReservedOrganizationName(organization)) continue;
            EnsureOrganizationDocumentFolders(directory, organization, includeIncoming);
        }
    }
    private static void EnsureOrganizationDocumentFolders(string directory, string organization, bool includeIncoming = false)
    {
        if (includeIncoming) Directory.CreateDirectory(Path.Combine(directory, SafePart(ValidOrganizationName(organization), 80) + " Incoming"));
        foreach (string folder in ArtifactDirectoryNames) Directory.CreateDirectory(Path.Combine(directory, OrganizationArtifactStorageFolder(folder, organization)));
    }
    private static List<string> EnumerateOrganizationArchiveFiles(string root, string organization)
    {
        string organizationRoot = OrganizationScopeRoot(root, organization);var result = new List<string>();var pending = new Stack<Tuple<string, int>>();
        foreach (string directory in EnumerateScanDirectories(root, organizationRoot)) if (Path.GetFileName(directory).EndsWith(" Archive", StringComparison.OrdinalIgnoreCase)) pending.Push(Tuple.Create(directory, 0));
        while (pending.Count > 0)
        {
            Tuple<string, int> current = pending.Pop();if (current.Item2 > 25) throw new InvalidDataException("An organization Archive exceeds the folder nesting limit.");
            foreach (string file in EnumerateScanFiles(root, current.Item1)) { if (result.Count >= 100000) throw new InvalidDataException("An organization Archive exceeds the file recovery limit.");if (file.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) || file.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) result.Add(file); }
            foreach (string directory in EnumerateScanDirectories(root, current.Item1)) if (!IsScanReparsePoint(root, directory)) pending.Push(Tuple.Create(directory, current.Item2 + 1));
        }
        return result;
    }
    private static bool ArchivedNameMatches(string expected, string actual, bool allowCollisionSuffix)
    {
        if (String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase)) return true;if (!allowCollisionSuffix) return false;
        string extension = expected.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase) ? expected.Substring(expected.Length - 8) : Path.GetExtension(expected), stem = expected.Substring(0, expected.Length - extension.Length);if (!actual.EndsWith(extension, StringComparison.OrdinalIgnoreCase)) return false;
        string actualStem = actual.Substring(0, actual.Length - extension.Length);if (!actualStem.StartsWith(stem + "_", StringComparison.OrdinalIgnoreCase)) return false;int suffix;return Int32.TryParse(actualStem.Substring(stem.Length + 1), NumberStyles.None, CultureInfo.InvariantCulture, out suffix) && suffix > 0;
    }

    private static string OrganizationScopeRoot(string root, string organization)
    {
        if (String.IsNullOrWhiteSpace(organization)) return root;
        string organizations = Path.Combine(root, "Organizations"), scoped = Path.Combine(organizations, ValidOrganizationName(organization));
        if (!Directory.Exists(scoped)) throw new DirectoryNotFoundException("The selected organization folder no longer exists beneath Organizations.");
        if (IsScanReparsePoint(root, organizations) || IsScanReparsePoint(root, scoped)) throw new UnauthorizedAccessException("The selected organization scope redirects outside the mapped folder.");
        return scoped;
    }

    private static bool PathInOrganizationScope(string relative, string organization)
    {
        if (String.IsNullOrWhiteSpace(organization)) return true;
        string normalized = (relative ?? "").Replace(Path.DirectorySeparatorChar, '/').Replace(Path.AltDirectorySeparatorChar, '/'), prefix = "Organizations/" + organization.Trim() + "/";
        return normalized.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    private static Tuple<string, string> OrganizationStorageLocation(string root, string source)
    {
        string relative = Relative(root, source);
        string[] parts = relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);
        string rootOrganization = new DirectoryInfo(root).Name;
        if (parts.Length <= 1) return Tuple.Create(root, rootOrganization);
        int directoryCount = parts.Length - 1;
        for (int index = 0; index < directoryCount - 1; index++)
        {
            if (!String.Equals(parts[index], "User Evidence", StringComparison.OrdinalIgnoreCase) && !String.Equals(parts[index], "Organizations", StringComparison.OrdinalIgnoreCase)) continue;
            string organization = parts[index + 1], directory = root;
            if (ReservedOrganizationName(organization)) continue;
            for (int part = 0; part <= index + 1; part++) directory = Path.Combine(directory, parts[part]);
            return Tuple.Create(directory, organization);
        }
        string filenameIdentity = ComparableStorageName(Path.GetFileNameWithoutExtension(parts[parts.Length - 1])), topLevel = ComparableStorageName(parts[0]);
        if (ReservedOrganizationName(parts[0])) return Tuple.Create(root, rootOrganization);
        if (!String.IsNullOrEmpty(topLevel) && filenameIdentity.StartsWith(topLevel, StringComparison.OrdinalIgnoreCase)) return Tuple.Create(root, rootOrganization);
        return Tuple.Create(Path.Combine(root, parts[0]), parts[0]);
    }

    private static DirectoryScanEntry[] EnumerateDirectoryEntries(string root, string directory)
    {
        if (DirectoryEnumerationForTests != null) DirectoryEnumerationForTests(directory);
        string key = null;
        if (threadEnumerationSnapshotEnabled)
        {
            key = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).ToUpperInvariant();DirectoryScanEntry[] cached;
            if (threadEnumerationSnapshot != null && threadEnumerationSnapshot.TryGetValue(key, out cached)) { threadEnumerationSnapshotHits++;return cached; }
        }
        for (int attempt = 0; ; attempt++)
        {
            try { DirectoryScanEntry[] entries = EnumerateDirectoryEntriesOnce(root, directory);if (threadEnumerationSnapshotEnabled) { if (threadEnumerationSnapshot == null) threadEnumerationSnapshot = new Dictionary<string, DirectoryScanEntry[]>(StringComparer.OrdinalIgnoreCase);threadEnumerationSnapshot[key] = entries;threadEnumerationSnapshotMisses++; }return entries; }
            catch (IOException) { if (attempt + 1 >= NetworkReadAttempts) throw;Thread.Sleep(NetworkRetryDelay(attempt)); }
        }
    }

    private static void BeginEnumerationSnapshot()
    {
        threadEnumerationSnapshot = new Dictionary<string, DirectoryScanEntry[]>(StringComparer.OrdinalIgnoreCase);threadEnumerationSnapshotHits = 0;threadEnumerationSnapshotMisses = 0;threadEnumerationSnapshotEnabled = true;
    }

    private static void ResetEnumerationSnapshot()
    {
        if (threadEnumerationSnapshot != null) threadEnumerationSnapshot.Clear();threadEnumerationSnapshotHits = 0;threadEnumerationSnapshotMisses = 0;
    }

    private static void EndEnumerationSnapshot()
    {
        threadEnumerationSnapshotEnabled = false;threadEnumerationSnapshot = null;
    }

    private static DirectoryScanEntry[] EnumerateDirectoryEntriesOnce(string root, string directory)
    {
        if (ForceShellEnumerationForTests) return EnumerateShellDirectoryEntries(root, directory);
        if (ForceNativeEnumerationForTests) return EnumerateNativeDirectoryEntries(root, directory);
        try { return EnumerateManagedDirectoryEntries(root, directory, "*"); }
        catch (IOException error)
        {
            if ((error.HResult & 0xffff) != 87) throw ScanFailure(root, directory, "enumerating directory entries", error);
            try { return EnumerateManagedDirectoryEntries(root, directory, "*.*"); }
            catch (IOException fallback)
            {
                if ((fallback.HResult & 0xffff) == 87) return EnumerateNativeDirectoryEntries(root, directory);
                throw ScanFailure(root, directory, "enumerating directory entries with the compatible managed search pattern", fallback);
            }
            catch (UnauthorizedAccessException fallback) { throw ScanFailure(root, directory, "enumerating directory entries with the compatible managed search pattern", fallback); }
        }
        catch (UnauthorizedAccessException error) { throw ScanFailure(root, directory, "enumerating directory entries", error); }
    }

    private static DirectoryScanEntry[] EnumerateManagedDirectoryEntries(string root, string directory, string pattern)
    {
        FileSystemInfo[] items = new DirectoryInfo(directory).GetFileSystemInfos(pattern, SearchOption.TopDirectoryOnly);
        var result = new List<DirectoryScanEntry>(items.Length);
        foreach (FileSystemInfo item in items)
        {
            try
            {
                bool isDirectory = (item.Attributes & FileAttributes.Directory) != 0;
                result.Add(new DirectoryScanEntry { Path = item.FullName, IsDirectory = isDirectory, IsReparsePoint = (item.Attributes & FileAttributes.ReparsePoint) != 0, HasAttributes = true, HasMetadata = !isDirectory, Size = isDirectory ? 0L : ((FileInfo)item).Length, LastModifiedUnixMs = isDirectory ? 0L : new DateTimeOffset(item.LastWriteTimeUtc).ToUnixTimeMilliseconds() });
            }
            catch { result.Add(new DirectoryScanEntry { Path = item.FullName, IsDirectory = item is DirectoryInfo, IsReparsePoint = false, HasAttributes = false, HasMetadata = false }); }
        }
        return result.ToArray();
    }

    private static DirectoryScanEntry[] EnumerateNativeDirectoryEntries(string root, string directory)
    {
        int lastError = 87;
        foreach (string pattern in new[] { "*", "*.*" })
        {
            NativeFindData data;IntPtr handle = FindFirstFileW(Path.Combine(directory, pattern), out data);
            if (handle == InvalidFindHandle)
            {
                lastError = Marshal.GetLastWin32Error();
                if (lastError == 2 || lastError == 18) return new DirectoryScanEntry[0];
                if (lastError == 87) continue;
                throw ScanFailure(root, directory, "enumerating directory entries through the native Windows path", new IOException("Windows error " + lastError.ToString(CultureInfo.InvariantCulture) + "."));
            }
            var result = new List<DirectoryScanEntry>();
            try
            {
                while (true)
                {
                    string name = data.FileName;
                    if (!String.IsNullOrEmpty(name) && name != "." && name != "..")
                    {
                        bool isDirectory = (data.Attributes & FileAttributes.Directory) != 0;long modified = 0L;
                        if (!isDirectory)
                        {
                            try { long fileTime = ((long)data.LastWriteTime.dwHighDateTime << 32) | (uint)data.LastWriteTime.dwLowDateTime;modified = new DateTimeOffset(DateTime.FromFileTimeUtc(fileTime)).ToUnixTimeMilliseconds(); }
                            catch { modified = 0L; }
                        }
                        result.Add(new DirectoryScanEntry { Path = Path.Combine(directory, name), IsDirectory = isDirectory, IsReparsePoint = (data.Attributes & FileAttributes.ReparsePoint) != 0, HasAttributes = true, HasMetadata = !isDirectory && modified > 0L, Size = isDirectory ? 0L : (((long)data.FileSizeHigh << 32) | data.FileSizeLow), LastModifiedUnixMs = modified });
                    }
                    if (FindNextFileW(handle, out data)) continue;
                    lastError = Marshal.GetLastWin32Error();
                    if (lastError == 87) return EnumerateShellDirectoryEntries(root, directory);
                    if (lastError != 18) throw ScanFailure(root, directory, "enumerating directory entries through the native Windows path", new IOException("Windows error " + lastError.ToString(CultureInfo.InvariantCulture) + "."));
                    return result.ToArray();
                }
            }
            finally { FindClose(handle); }
        }
        return EnumerateShellDirectoryEntries(root, directory);
    }

    private static DirectoryScanEntry[] EnumerateShellDirectoryEntries(string root, string directory)
    {
        var result = new List<DirectoryScanEntry>();
        foreach (string path in EnumerateShellScanEntries(root, directory, false)) result.Add(new DirectoryScanEntry { Path = path, IsDirectory = false, HasMetadata = false });
        foreach (string path in EnumerateShellScanEntries(root, directory, true)) result.Add(new DirectoryScanEntry { Path = path, IsDirectory = true, IsReparsePoint = IsScanReparsePoint(root, path), HasMetadata = false });
        return result.ToArray();
    }

    private static string[] EnumerateScanFiles(string root, string directory)
    {
        for (int attempt = 0; ; attempt++)
        {
            try { return EnumerateScanFilesOnce(root, directory); }
            catch (IOException) { if (attempt + 1 >= NetworkReadAttempts) throw;Thread.Sleep(NetworkRetryDelay(attempt)); }
        }
    }

    private static string[] EnumerateScanFilesOnce(string root, string directory)
    {
        if (ForceShellEnumerationForTests) return EnumerateShellScanEntries(root, directory, false);
        if (ForceNativeEnumerationForTests) return EnumerateNativeScanEntries(root, directory, false);
        try { return Directory.GetFiles(directory, "*", SearchOption.TopDirectoryOnly); }
        catch (IOException error)
        {
            if ((error.HResult & 0xffff) != 87) throw ScanFailure(root, directory, "enumerating files", error);
            try { return Directory.GetFiles(directory, "*.*", SearchOption.TopDirectoryOnly); }
            catch (IOException fallback)
            {
                if ((fallback.HResult & 0xffff) == 87) return EnumerateNativeScanEntries(root, directory, false);
                throw ScanFailure(root, directory, "enumerating files with the compatible managed search pattern", fallback);
            }
            catch (UnauthorizedAccessException fallback) { throw ScanFailure(root, directory, "enumerating files with the compatible managed search pattern", fallback); }
        }
        catch (UnauthorizedAccessException error) { throw ScanFailure(root, directory, "enumerating files", error); }
    }

    private static string[] EnumerateScanDirectories(string root, string directory)
    {
        for (int attempt = 0; ; attempt++)
        {
            try { return EnumerateScanDirectoriesOnce(root, directory); }
            catch (IOException) { if (attempt + 1 >= NetworkReadAttempts) throw;Thread.Sleep(NetworkRetryDelay(attempt)); }
        }
    }

    private static string[] EnumerateScanDirectoriesOnce(string root, string directory)
    {
        if (ForceShellEnumerationForTests) return EnumerateShellScanEntries(root, directory, true);
        if (ForceNativeEnumerationForTests) return EnumerateNativeScanEntries(root, directory, true);
        try { return Directory.GetDirectories(directory, "*", SearchOption.TopDirectoryOnly); }
        catch (IOException error)
        {
            if ((error.HResult & 0xffff) != 87) throw ScanFailure(root, directory, "enumerating subfolders", error);
            try { return Directory.GetDirectories(directory, "*.*", SearchOption.TopDirectoryOnly); }
            catch (IOException fallback)
            {
                if ((fallback.HResult & 0xffff) == 87) return EnumerateNativeScanEntries(root, directory, true);
                throw ScanFailure(root, directory, "enumerating subfolders with the compatible managed search pattern", fallback);
            }
            catch (UnauthorizedAccessException fallback) { throw ScanFailure(root, directory, "enumerating subfolders with the compatible managed search pattern", fallback); }
        }
        catch (UnauthorizedAccessException error) { throw ScanFailure(root, directory, "enumerating subfolders", error); }
    }

    private static string[] EnumerateNativeScanEntries(string root, string directory, bool directories)
    {
        string kind = directories ? "subfolders" : "files";
        int lastError = 87;
        foreach (string pattern in new[] { "*", "*.*" })
        {
            NativeFindData data;
            IntPtr handle = FindFirstFileW(Path.Combine(directory, pattern), out data);
            if (handle == InvalidFindHandle)
            {
                lastError = Marshal.GetLastWin32Error();
                if (lastError == 2 || lastError == 18) return new string[0];
                if (lastError == 87) continue;
                throw ScanFailure(root, directory, "enumerating " + kind + " through the native Windows fallback", new IOException("Windows error " + lastError.ToString(CultureInfo.InvariantCulture) + "."));
            }

            var result = new List<string>();
            try
            {
                while (true)
                {
                    string name = data.FileName;
                    bool isDirectory = (data.Attributes & FileAttributes.Directory) != 0;
                    if (!String.IsNullOrEmpty(name) && name != "." && name != ".." && isDirectory == directories) result.Add(Path.Combine(directory, name));
                    if (FindNextFileW(handle, out data)) continue;
                    lastError = Marshal.GetLastWin32Error();
                    if (lastError == 87) return EnumerateShellScanEntries(root, directory, directories);
                    if (lastError != 18) throw ScanFailure(root, directory, "enumerating " + kind + " through the native Windows fallback", new IOException("Windows error " + lastError.ToString(CultureInfo.InvariantCulture) + "."));
                    return result.ToArray();
                }
            }
            finally { FindClose(handle); }
        }
        return EnumerateShellScanEntries(root, directory, directories);
    }

    private static string[] EnumerateShellScanEntries(string root, string directory, bool directories)
    {
        string kind = directories ? "subfolders" : "files";
        object shell = null, folder = null, items = null;
        try
        {
            Type shellType = Type.GetTypeFromProgID("Shell.Application");
            if (shellType == null) throw new NotSupportedException("The Windows Shell namespace is unavailable.");
            shell = Activator.CreateInstance(shellType);
            folder = shellType.InvokeMember("NameSpace", BindingFlags.InvokeMethod, null, shell, new object[] { directory });
            if (folder == null) throw new DirectoryNotFoundException("Windows Explorer could not open the folder.");
            Type folderType = folder.GetType();
            items = folderType.InvokeMember("Items", BindingFlags.InvokeMethod, null, folder, null);
            if (items == null) throw new IOException("Windows Explorer did not return the folder contents.");
            Type itemsType = items.GetType();
            int count = Convert.ToInt32(itemsType.InvokeMember("Count", BindingFlags.GetProperty, null, items, null), CultureInfo.InvariantCulture);
            if (count < 0 || count > 100000) throw new InvalidDataException("The Windows Explorer folder item count exceeds the scan limit.");
            string fullDirectory = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var result = new List<string>(Math.Min(count, 4096));
            for (int index = 0; index < count; index++)
            {
                object item = null;
                try
                {
                    item = itemsType.InvokeMember("Item", BindingFlags.InvokeMethod, null, items, new object[] { index });
                    if (item == null) continue;
                    Type itemType = item.GetType();
                    bool isFolder = Convert.ToBoolean(itemType.InvokeMember("IsFolder", BindingFlags.GetProperty, null, item, null), CultureInfo.InvariantCulture);
                    bool isLink = Convert.ToBoolean(itemType.InvokeMember("IsLink", BindingFlags.GetProperty, null, item, null), CultureInfo.InvariantCulture);
                    string path = Convert.ToString(itemType.InvokeMember("Path", BindingFlags.GetProperty, null, item, null), CultureInfo.InvariantCulture);
                    if (String.IsNullOrWhiteSpace(path) || isLink) continue;
                    // Explorer exposes ZIP archives as namespace folders. They remain evidence files for Sync.
                    if (path.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) isFolder = false;
                    if (isFolder != directories) continue;
                    string full = Path.GetFullPath(path);
                    if (!full.StartsWith(fullDirectory, StringComparison.OrdinalIgnoreCase) || !String.Equals(Path.GetDirectoryName(full), fullDirectory.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) continue;
                    result.Add(full);
                }
                finally { ReleaseComObject(item); }
            }
            return result.ToArray();
        }
        catch (Exception error)
        {
            Exception detail = error is TargetInvocationException && error.InnerException != null ? error.InnerException : error;
            throw ScanFailure(root, directory, "enumerating " + kind + " through the Windows Explorer namespace fallback", detail);
        }
        finally
        {
            ReleaseComObject(items);
            ReleaseComObject(folder);
            ReleaseComObject(shell);
        }
    }

    private static void ReleaseComObject(object value)
    {
        if (value == null || !Marshal.IsComObject(value)) return;
        try { Marshal.ReleaseComObject(value); }
        catch { }
    }

    private static bool IsScanReparsePoint(string root, string directory)
    {
        try
        {
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) == 0) return false;
            NativeFindData data;IntPtr handle = FindFirstFileW(directory, out data);
            if (handle == InvalidFindHandle) return true;
            try { return ReparseTagMayEscapeMappedTree(data.Reserved0); }
            finally { FindClose(handle); }
        }
        catch (IOException error)
        {
            if ((error.HResult & 0xffff) != 87) throw ScanFailure(root, directory, "checking folder attributes", error);
            uint attributes = GetFileAttributesW(directory);
            if (attributes == InvalidFileAttributes)
            {
                int code = Marshal.GetLastWin32Error();
                throw ScanFailure(root, directory, "checking folder attributes through the native Windows fallback", new IOException("Windows error " + code.ToString(CultureInfo.InvariantCulture) + "."));
            }
            return (((FileAttributes)attributes) & FileAttributes.ReparsePoint) != 0;
        }
        catch (UnauthorizedAccessException error) { throw ScanFailure(root, directory, "checking folder attributes", error); }
    }

    internal static bool ReparseTagMayEscapeMappedTree(uint tag)
    {
        // Name-surrogate reparse points (junctions and symbolic links) can leave the
        // mapped tree. Cloud placeholder tags, including OneDrive, do not redirect
        // the namespace and must remain traversable during a full-system scan.
        return tag == 0 || (tag & ReparseTagNameSurrogate) != 0;
    }

    private static IOException ScanFailure(string root, string path, string stage, Exception error)
    {
        string location;
        try { location = String.Equals(Path.GetFullPath(root), Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase) ? "." : Relative(root, path).Replace(Path.DirectorySeparatorChar, '/'); }
        catch { location = CleanLine(path, 300); }
        return new IOException("Scan failed while " + stage + " at " + location + ". " + CleanLine(error.Message, 300), error);
    }

    private static int NetworkRetryDelay(int attempt)
    {
        return Math.Min(8000, 500 * (1 << Math.Min(attempt, 4)));
    }

    private static bool DirectoryExistsWithRetry(string path)
    {
        for (int attempt = 0; attempt < NetworkReadAttempts; attempt++)
        {
            if (Directory.Exists(path)) return true;
            if (attempt + 1 < NetworkReadAttempts) Thread.Sleep(NetworkRetryDelay(attempt));
        }
        return false;
    }

    private static string NormalizeRootPath(string path)
    {
        if (String.IsNullOrWhiteSpace(path) || path.StartsWith(@"\\?\", StringComparison.Ordinal) || path.StartsWith(@"\\.\", StringComparison.Ordinal)) throw new InvalidDataException("The selected system folder path is invalid.");
        string full = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (Directory.Exists(full)) EnsureReparseSafePath(full, full);
        return full;
    }

    private static string SafePart(string value, int max)
    {
        string clean = CleanLine(value, max);
        foreach (char c in Path.GetInvalidFileNameChars()) clean = clean.Replace(c, '_');
        clean = clean.TrimEnd('.', ' ');
        return String.IsNullOrWhiteSpace(clean) ? "Unknown" : clean;
    }

    private static bool TryValidateEvidenceFile(string path, out string error)
    {
        bool cacheable;
        bool encryptedPdf;
        return TryValidateEvidenceFile(path, out error, out cacheable, out encryptedPdf);
    }

    private static bool TryValidateEvidenceFile(string path, out string error, out bool cacheable)
    {
        bool encryptedPdf;
        return TryValidateEvidenceFile(path, out error, out cacheable, out encryptedPdf);
    }

    private static bool TryValidateEvidenceFile(string path, out string error, out bool cacheable, out bool encryptedPdf)
    {
        error = "";
        cacheable = true;
        encryptedPdf = false;
        for (int attempt = 0; attempt < NetworkReadAttempts; attempt++)
        {
            try
            {
                var info = new FileInfo(path);
                if (!info.Exists) throw new FileNotFoundException("The evidence file is missing.");
                if (info.Length > EvidenceLimit) throw new InvalidDataException("The file exceeds the 100 MB evidence limit.");
                if (path.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                {
                    using (var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) encryptedPdf = ValidatePdfStream(stream, Path.GetFileName(path), info.Length);
                    return true;
                }
                if (path.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                {
                    using (var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) encryptedPdf = ValidateEvidenceZip(stream, Path.GetFileName(path));
                    return true;
                }
                error = "Only PDF evidence or a ZIP containing one PDF is accepted.";
                return false;
            }
            catch (InvalidDataException ex) { error = CleanLine(ex.Message, 300); return false; }
            catch (IOException ex)
            {
                cacheable = false;error = CleanLine(ex.Message, 300);
                if (attempt + 1 >= NetworkReadAttempts) return false;
                Thread.Sleep(NetworkRetryDelay(attempt));
            }
            catch (UnauthorizedAccessException ex) { cacheable = false;error = CleanLine(ex.Message, 300);return false; }
            catch (Exception ex) { cacheable = false;error = CleanLine(ex.Message, 300);return false; }
        }
        return false;
    }

    private static bool ValidateEvidenceZip(Stream stream, string label)
    {
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Read, true))
        {
            if (archive.Entries.Count == 0 || archive.Entries.Count > 8) throw new InvalidDataException("The ZIP must contain one PDF and no more than eight entries.");
            var files = new List<ZipArchiveEntry>();
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                ValidateZipEntryName(entry.FullName);
                bool directory = entry.FullName.EndsWith("/", StringComparison.Ordinal);
                if (directory) continue;
                files.Add(entry);
                if (!entry.FullName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The ZIP may contain PDF evidence only.");
                if (entry.Length > EvidenceLimit || entry.CompressedLength > EvidenceLimit) throw new InvalidDataException("A ZIP entry exceeds the 100 MB evidence limit.");
                if (entry.Length > 1024L * 1024 && entry.Length / Math.Max(1D, entry.CompressedLength) > 200D) throw new InvalidDataException("The ZIP expansion ratio exceeds the safety limit.");
            }
            if (files.Count != 1) throw new InvalidDataException("The ZIP must contain exactly one PDF and no other files.");
            try { using (Stream pdf = files[0].Open()) return ValidatePdfStream(pdf, files[0].FullName, files[0].Length); }
            catch (InvalidDataException) { throw; }
            catch (Exception) { throw new InvalidDataException(label + " contains an unsupported or unreadable PDF entry."); }
        }
    }

    private static void ValidateZipEntryName(string name)
    {
        if (String.IsNullOrWhiteSpace(name) || name.IndexOf('\0') >= 0 || name.IndexOf('\\') >= 0 || name.StartsWith("/", StringComparison.Ordinal) || (name.Length > 1 && Char.IsLetter(name[0]) && name[1] == ':')) throw new InvalidDataException("The ZIP contains an unsafe entry path.");
        foreach (string segment in name.Split('/')) if (segment == "." || segment == "..") throw new InvalidDataException("The ZIP contains an unsafe entry path.");
    }

    private static bool ValidatePdfStream(Stream stream, string label, long expectedLength)
    {
        byte[] buffer = new byte[8192], head = new byte[1024], tail = new byte[4096], encryptionMarker = Encoding.ASCII.GetBytes("/Encrypt");
        int headCount = 0, tailCount = 0, tailPosition = 0, encryptionMatched = 0, read;
        bool encryptedPdf = false;
        long total = 0;
        while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
        {
            total += read;
            if (total > EvidenceLimit) throw new InvalidDataException(label + " exceeds the 100 MB evidence limit.");
            if (headCount < head.Length)
            {
                int copy = Math.Min(read, head.Length - headCount);
                Buffer.BlockCopy(buffer, 0, head, headCount, copy);
                headCount += copy;
            }
            for (int index = 0; index < read; index++)
            {
                byte value = buffer[index];
                if (!encryptedPdf)
                {
                    if (value == encryptionMarker[encryptionMatched]) { encryptionMatched++;if (encryptionMatched == encryptionMarker.Length) encryptedPdf = true; }
                    else encryptionMatched = value == encryptionMarker[0] ? 1 : 0;
                }
                tail[tailPosition] = buffer[index];
                tailPosition = (tailPosition + 1) % tail.Length;
                if (tailCount < tail.Length) tailCount++;
            }
        }
        if (total < 16 || (expectedLength >= 0 && total != expectedLength)) throw new InvalidDataException(label + " is empty or truncated.");
        byte[] pdfHeader = Encoding.ASCII.GetBytes("%PDF-"), pdfEnd = Encoding.ASCII.GetBytes("%%EOF"), orderedTail = new byte[tailCount];
        int tailStart = tailCount == tail.Length ? tailPosition : 0;
        for (int index = 0; index < tailCount; index++) orderedTail[index] = tail[(tailStart + index) % tail.Length];
        if (!ContainsBytes(head, headCount, pdfHeader)) throw new InvalidDataException(label + " does not contain a valid PDF header.");
        if (!ContainsBytes(orderedTail, orderedTail.Length, pdfEnd)) throw new InvalidDataException(label + " does not contain a valid PDF end marker.");
        return encryptedPdf;
    }

    private static bool ContainsBytes(byte[] bytes, int length, byte[] sequence)
    {
        for (int offset = 0; offset <= length - sequence.Length; offset++)
        {
            bool matches = true;
            for (int index = 0; index < sequence.Length; index++) if (bytes[offset + index] != sequence[index]) { matches = false; break; }
            if (matches) return true;
        }
        return false;
    }

    private static void ValidateSystemId(string value) { if (String.IsNullOrWhiteSpace(value) || value.Length > 100 || value.IndexOfAny(new[] { '/', '\\', '\r', '\n', '\0' }) >= 0) throw new InvalidDataException("The information-system identifier is invalid."); }
    private static void ValidateSessionId(string value) { if (String.IsNullOrWhiteSpace(value) || value.Length > 100 || value.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) throw new InvalidDataException("The session identifier is invalid."); }
    private static Dictionary<string, object> ObjectDictionary(object value) { var result = value as Dictionary<string, object>; if (result == null) throw new InvalidDataException("The JSON object is invalid."); return result; }
    private static object[] ObjectArray(object value) { var result = value as object[]; if (result == null) throw new InvalidDataException("The JSON array is invalid."); return result; }
    private static string CleanLine(string value, int max) { if (value == null) return ""; var builder = new StringBuilder(); foreach (char c in value) builder.Append(Char.IsControl(c) ? ' ' : c); string clean = builder.ToString().Trim(); return clean.Length > max ? clean.Substring(0, max) : clean; }
    private static bool TryReadFileMetadata(string path, out long size, out long modifiedUnixMilliseconds, out string error)
    {
        size = 0L;modifiedUnixMilliseconds = 0L;error = "";
        for (int attempt = 0; attempt < NetworkReadAttempts; attempt++)
        {
            try
            {
                var info = new FileInfo(path);info.Refresh();
                if (!info.Exists) throw new FileNotFoundException("The evidence file no longer exists.", path);
                size = info.Length;modifiedUnixMilliseconds = new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds();
                return true;
            }
            catch (IOException ex)
            {
                error = CleanLine(ex.Message, 300);
                if (attempt + 1 >= NetworkReadAttempts) return false;
                Thread.Sleep(NetworkRetryDelay(attempt));
            }
            catch (UnauthorizedAccessException ex) { error = CleanLine(ex.Message, 300);return false; }
        }
        return false;
    }
    private static string ReadText(string path, long limit)
    {
        for (int attempt = 0; ; attempt++)
        {
            try { var info = new FileInfo(path);if (!info.Exists) throw new FileNotFoundException("The requested file is missing.");if (info.Length > limit) throw new InvalidDataException("The requested file exceeds its size limit.");return File.ReadAllText(path, Encoding.UTF8); }
            catch (IOException) { if (attempt + 1 >= NetworkReadAttempts) throw;Thread.Sleep(NetworkRetryDelay(attempt)); }
        }
    }
    private static string EvidencePdfSha256(string path)
    {
        for (int attempt = 0; attempt < NetworkReadAttempts; attempt++)
        {
            try
            {
                if (path.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) using (Stream input = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) return Sha256Stream(input);
                if (path.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                {
                    using (Stream input = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                    using (var archive = new ZipArchive(input, ZipArchiveMode.Read, false))
                    {
                        ZipArchiveEntry entry = archive.Entries.Single(item => !item.FullName.EndsWith("/", StringComparison.Ordinal) && item.FullName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase));
                        using (Stream pdf = entry.Open()) return Sha256Stream(pdf);
                    }
                }
                throw new InvalidDataException("Evidence content hashing accepts only PDF or ZIP evidence.");
            }
            catch (IOException) { if (attempt + 1 >= NetworkReadAttempts) throw;Thread.Sleep(NetworkRetryDelay(attempt)); }
        }
        throw new IOException("Evidence content hashing did not complete within the network retry budget.");
    }

    private static string Sha256Stream(Stream value) { using (var sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(value)).Replace("-", "").ToLowerInvariant(); } }
    private static string Sha256(string value) { using (var sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant(); } }
    private static string Sha256Bytes(byte[] value) { using (var sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(value)).Replace("-", "").ToLowerInvariant(); } }
    private static byte[] ReadAllBytesWithRetry(string path, long limit)
    {
        for (int attempt = 0; attempt < NetworkReadAttempts; attempt++)
        {
            try { var info = new FileInfo(path);info.Refresh();if (!info.Exists) throw new FileNotFoundException("The requested file is missing.", path);if (info.Length > limit) throw new InvalidDataException("The requested file exceeds its size limit.");return File.ReadAllBytes(path); }
            catch (IOException) { if (attempt + 1 >= NetworkReadAttempts) throw;Thread.Sleep(NetworkRetryDelay(attempt)); }
        }
        throw new IOException("The requested file could not be read within the network retry budget.");
    }
    private static string FileHashWithRetry(string path, long limit)
    {
        for (int attempt = 0; attempt < NetworkReadAttempts; attempt++)
        {
            try
            {
                var info = new FileInfo(path);info.Refresh();if (!info.Exists) throw new FileNotFoundException("The requested file is missing.", path);if (info.Length > limit) throw new InvalidDataException("The requested file exceeds its size limit.");
                using (Stream input = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) return Sha256Stream(input);
            }
            catch (IOException) { if (attempt + 1 >= NetworkReadAttempts) throw;Thread.Sleep(NetworkRetryDelay(attempt)); }
        }
        throw new IOException("The requested file could not be hashed within the network retry budget.");
    }
    private static string TryFileHash(string path) { try { return FileHashWithRetry(path, Math.Max(ManifestLimit, EvidenceLimit)); } catch { return ""; } }

    private static string StreamVerifiedEvidenceCopy(string source, string destination, out long copiedBytes)
    {
        copiedBytes = 0L;
        for (int attempt = 0; attempt < 3; attempt++)
        {
            TryDelete(destination);
            try
            {
                var info = new FileInfo(source);info.Refresh();if (!info.Exists) throw new FileNotFoundException("The staged evidence file no longer exists.", source);if (info.Length > EvidenceLimit) throw new InvalidDataException("A staged evidence file exceeds the publication size limit.");
                long total = 0L;byte[] buffer = new byte[1024 * 1024];
                using (var sha = SHA256.Create())
                using (Stream input = File.Open(source, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var output = OpenCompatibleFileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, buffer.Length))
                {
                    int read;while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        total += read;if (total > EvidenceLimit) throw new InvalidDataException("A staged evidence file exceeds the publication size limit.");
                        sha.TransformBlock(buffer, 0, read, buffer, 0);output.Write(buffer, 0, read);
                    }
                    sha.TransformFinalBlock(new byte[0], 0, 0);FlushCompatible(output);copiedBytes = total;
                    return BitConverter.ToString(sha.Hash).Replace("-", "").ToLowerInvariant();
                }
            }
            catch (IOException) { TryDelete(destination);if (attempt + 1 >= 3) throw;Thread.Sleep(NetworkRetryDelay(attempt)); }
            catch { TryDelete(destination);throw; }
        }
        throw new IOException("The staged evidence file could not be copied within the network retry budget.");
    }
    private static FileStream OpenCompatibleFileStream(string path, FileMode mode, FileAccess access, FileShare share, int bufferSize)
    {
        return new FileStream(path, mode, access, share, bufferSize, FileOptions.None);
    }
    private static void FlushCompatible(FileStream stream)
    {
        stream.Flush();
    }
    private static void AtomicWrite(string path, byte[] bytes)
    {
        string expectedHash = Sha256Bytes(bytes);
        for (int attempt = 0; ; attempt++)
        {
            string directory = Path.GetDirectoryName(path);
            Directory.CreateDirectory(directory);
            string operationId = Guid.NewGuid().ToString("N"), temporary = Path.Combine(directory, ".isut-" + operationId + ".tmp"), previous = Path.Combine(directory, ".isut-" + operationId + ".previous");
            try
            {
                using (var stream = OpenCompatibleFileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920))
                {
                    stream.Write(bytes, 0, bytes.Length);
                    FlushCompatible(stream);
                }
                if (File.Exists(path))
                {
                    TryDelete(previous);
                    try { File.Replace(temporary, path, previous, true); }
                    catch (PlatformNotSupportedException) { VerifiedCopyReplace(temporary, path, previous, bytes); }
                    catch (IOException) { VerifiedCopyReplace(temporary, path, previous, bytes); }
                }
                else File.Move(temporary, path);
                if (!String.Equals(Sha256Bytes(ReadAllBytesWithRetry(path, Math.Max(ManifestLimit, bytes.LongLength))), expectedHash, StringComparison.OrdinalIgnoreCase)) throw new IOException("The network-share write completed but failed its SHA-256 verification.");
                TryDelete(previous);
                return;
            }
            catch (IOException error)
            {
                if (attempt + 1 >= NetworkWriteAttempts) throw new IOException("Compatible write failed for " + Path.GetFileName(path) + " during create, replace, or verification after network-aware retries. " + CleanLine(error.Message, 300), error);
                Thread.Sleep(NetworkRetryDelay(attempt));
            }
            finally { TryDelete(temporary); }
        }
    }
    private static void VerifiedCopyReplace(string temporary, string path, string previous, byte[] expected)
    {
        File.Copy(path, previous, true);
        try
        {
            File.Copy(temporary, path, true);
            if (!String.Equals(Sha256Bytes(ReadAllBytesWithRetry(path, Math.Max(ManifestLimit, expected.LongLength))), Sha256Bytes(expected), StringComparison.OrdinalIgnoreCase)) throw new IOException("The network-share fallback write failed its SHA-256 verification.");
            TryDelete(temporary);
        }
        catch
        {
            try { if (File.Exists(previous)) File.Copy(previous, path, true); } catch { }
            throw;
        }
    }
    private static void ProbeMappedFolder(string root)
    {
        byte[] expected = Encoding.ASCII.GetBytes("ISUT-MAPPED-FOLDER-PROBE");
        for (int attempt = 0; ; attempt++)
        {
            string path = Path.Combine(root, ".isut-map-probe-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (var stream = OpenCompatibleFileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096))
                {
                    stream.Write(expected, 0, expected.Length);
                    FlushCompatible(stream);
                }
                byte[] actual = ReadAllBytesWithRetry(path, 4096);
                if (!String.Equals(Sha256Bytes(actual), Sha256Bytes(expected), StringComparison.OrdinalIgnoreCase)) throw new IOException("The mapped-folder probe could not verify the bytes it wrote.");
                File.Delete(path);
                return;
            }
            catch (IOException error)
            {
                TryDelete(path);
                if (attempt + 1 >= NetworkReadAttempts) throw new IOException("Mapped-folder compatibility probe failed after network-aware retries while creating, writing, reading, or deleting a temporary file. " + CleanLine(error.Message, 300), error);
                Thread.Sleep(NetworkRetryDelay(attempt));
            }
            catch (Exception error)
            {
                TryDelete(path);
                throw new IOException("Mapped-folder compatibility probe failed while creating, writing, reading, or deleting a temporary file. " + CleanLine(error.Message, 300), error);
            }
        }
    }
    private static void TryDelete(string path) { try { if (File.Exists(path)) File.Delete(path); } catch { } }
}
