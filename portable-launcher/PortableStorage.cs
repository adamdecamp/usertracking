using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

internal sealed class PortableStorage : IDisposable
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
    private const int SyncIndexVersion = 1;
    private const int SyncJournalVersion = 1;
    private const int StorageTransactionVersion = 1;
    private const int MappingCacheVersion = 2;
    private const string SystemDirectoryName = "System";
    private const string ErrorReportsDirectoryName = "Error Reports";
    private static readonly string[] SupportDirectoryNames = new[] { "Audit Logs", "backup", "Archive Review", "Reports", "Sync Journals", "Storage Transactions", ErrorReportsDirectoryName };
    private const string SyncIndexFilename = "tracker-sync-index.json";
    private const string SyncIndexChecksumFilename = "tracker-sync-index.json.sha256";
    private const string RenamerQueueFilename = "tracker-document-renamer-queue.json";
    private static readonly string AuditGenesisHash = new string('0', 64);
    private readonly Dictionary<string, string> roots = new Dictionary<string, string>(StringComparer.Ordinal);
    private readonly Dictionary<string, string> cachedRoots = new Dictionary<string, string>(StringComparer.Ordinal);
    private readonly Dictionary<string, object> rootLocks = new Dictionary<string, object>(StringComparer.Ordinal);
    private readonly Dictionary<string, object> leaseLocks = new Dictionary<string, object>(StringComparer.Ordinal);
    private readonly Dictionary<string, HeldLease> heldLeases = new Dictionary<string, HeldLease>(StringComparer.Ordinal);
    private readonly object mapGate = new object();
    private readonly object errorReportGate = new object();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 100 * 1024 * 1024, RecursionLimit = 256 };
    private readonly string actor;
    private readonly string mappingCachePath;
    private string lastSystemId;
    internal static bool ForceNativeEnumerationForTests { get; set; }
    internal static bool ForceShellEnumerationForTests { get; set; }
    internal static string FailAfterStageForTests { get; set; }

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
    }

    private sealed class SyncJournalState
    {
        public string Path;
        public string RunId;
        public string RuleSetVersion;
        public int ResumedFiles;
        public readonly Dictionary<string, Dictionary<string, object>> Completed = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
    }

    public PortableStorage(string currentActor, string cachePath = null)
    {
        actor = CleanLine(currentActor, 500);
        mappingCachePath = String.IsNullOrWhiteSpace(cachePath) ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InformationSystemUserTracker", "folder-mappings.json") : Path.GetFullPath(cachePath);
        LoadMappingCache();
    }

    public void Map(string systemId, string path)
    {
        ValidateSystemId(systemId);
        string full = NormalizeRootPath(path);
        if (!Directory.Exists(full)) throw new DirectoryNotFoundException("The selected system folder is unavailable.");
        ProbeMappedFolder(full);
        MigrateSupportDirectories(full);
        Directory.CreateDirectory(Path.Combine(full, "Organizations"));
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
    }

    public string CachedMappings()
    {
        KeyValuePair<string, string>[] mappings;
        string selected;
        lock (mapGate) { mappings = cachedRoots.ToArray(); selected = lastSystemId; }
        var available = new List<Dictionary<string, object>>();
        foreach (KeyValuePair<string, string> mapping in mappings)
        {
            try
            {
                if (!Directory.Exists(mapping.Value)) continue;
                string manifestPath = Path.Combine(mapping.Value, "information-system-user-tracker.json");
                if (!File.Exists(manifestPath)) continue;
                string manifest = ReadText(manifestPath, ManifestLimit);
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
                available.Add(new Dictionary<string, object> { { "storageId", mapping.Key }, { "systemId", logicalSystemId }, { "folderName", new DirectoryInfo(mapping.Value).Name }, { "manifest", database } });
            }
            catch { }
        }
        available = available.GroupBy(item => Convert.ToString(item["systemId"]), StringComparer.Ordinal).Select(group => group.FirstOrDefault(item => String.Equals(Convert.ToString(item["storageId"]), selected, StringComparison.Ordinal)) ?? group.Last()).ToList();
        Dictionary<string, object> selectedMapping = available.FirstOrDefault(item => String.Equals(Convert.ToString(item["storageId"]), selected, StringComparison.Ordinal));
        selected = selectedMapping != null ? Convert.ToString(selectedMapping["systemId"]) : available.Count > 0 ? Convert.ToString(available[0]["systemId"]) : "";
        return json.Serialize(new Dictionary<string, object> { { "lastSystemId", selected ?? "" }, { "mappings", available } });
    }

    public string FolderName(string systemId) { return new DirectoryInfo(Root(systemId)).Name; }

    public string ReadManifest(string systemId)
    {
        string path = Path.Combine(Root(systemId), "information-system-user-tracker.json");
        if (!File.Exists(path)) return null;
        string text = ReadText(path, ManifestLimit);
        ValidateDatabase(text);
        return text;
    }

    public string SaveManifest(string systemId, string text)
    {
        Dictionary<string, object> database = ValidateDatabase(text);
        string canonical = json.Serialize(database), now = DateTime.UtcNow.ToString("o");
        database["updated"] = now;
        canonical = json.Serialize(database);
        lock (RootLock(systemId))
        {
            string root = Root(systemId), manifest = Path.Combine(root, "information-system-user-tracker.json");
            RecoverTransactions(root);
            byte[] manifestBytes = Encoding.UTF8.GetBytes(canonical);
            string destinationHash = Sha256Bytes(manifestBytes), transaction = BeginTransaction(root, "manifest-write", manifest, manifest, TryFileHash(manifest), destinationHash);
            try { AtomicWrite(manifest, manifestBytes);FailAfter("manifest-write");CompleteTransaction(transaction); }
            catch { if (!String.Equals(TryFileHash(manifest), destinationHash, StringComparison.OrdinalIgnoreCase)) CompleteTransaction(transaction);throw; }
            string backupDirectory = SupportDirectory(root, "backup");
            string backupCreated = CreateSnapshot(backupDirectory, database, false);
            return json.Serialize(new Dictionary<string, object> { { "saved", now }, { "backup", backupCreated ?? LatestCreated(backupDirectory) }, { "snapshotCreated", backupCreated != null } });
        }
    }

    public string SaveCsv(string systemId, byte[] bytes)
    {
        if (bytes.Length > ManifestLimit) throw new InvalidDataException("The CSV backup exceeds the 50 MB safety limit.");
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "backup");
            string path = Path.Combine(directory, "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".csv");
            AtomicWrite(path, bytes);
            return DateTime.UtcNow.ToString("o");
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
            string manifestPath = Path.Combine(Root(systemId), "information-system-user-tracker.json");
            if (File.Exists(manifestPath))
            {
                Dictionary<string, object> current = ValidateDatabase(ReadText(manifestPath, ManifestLimit));
                CreateSnapshot(directory, current, true);
            }
            string now = DateTime.UtcNow.ToString("o");
            restored["updated"] = now;
            string restoredText = json.Serialize(restored);
            AtomicWrite(manifestPath, Encoding.UTF8.GetBytes(restoredText));
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
        string manifestPath = Path.Combine(Root(systemId), "information-system-user-tracker.json"), directory = SupportDirectory(Root(systemId), "backup");
        if (!File.Exists(manifestPath)) throw new FileNotFoundException("The current database manifest is missing.");
        ValidateDatabase(ReadText(manifestPath, ManifestLimit));
        string latest = SnapshotPaths(directory).FirstOrDefault();
        if (latest == null) throw new FileNotFoundException("No JSON backup snapshot is available.");
        Dictionary<string, object> envelope = VerifySnapshot(latest), database = ObjectDictionary(envelope["database"]);
        object[] systems = ObjectArray(database["systems"]);
        if (systems.Length != 1 || !String.Equals(Convert.ToString(ObjectDictionary(systems[0])["id"]), logicalSystemId, StringComparison.Ordinal)) throw new InvalidDataException("The latest backup belongs to a different information system.");
        AuditState audit = VerifyAuditChain(SupportDirectory(Root(systemId), "Audit Logs"));
        return json.Serialize(new Dictionary<string, object> { { "healthy", true }, { "saved", File.GetLastWriteTimeUtc(manifestPath).ToString("o") }, { "backup", Convert.ToString(envelope["created"]) }, { "filename", Path.GetFileName(latest) }, { "auditHealthy", true }, { "auditEntries", audit.Entries }, { "auditHeadHash", audit.HeadHash } });
    }

    public void FinalizeMappedBackups()
    {
        string[] ids;
        lock (mapGate) ids = roots.Keys.ToArray();
        foreach (string id in ids)
        {
            lock (RootLock(id))
            {
                string root = Root(id), manifest = Path.Combine(root, "information-system-user-tracker.json");
                if (!File.Exists(manifest)) continue;
                Dictionary<string, object> database = ValidateDatabase(ReadText(manifest, ManifestLimit));
                string backupDirectory = SupportDirectory(root, "backup");
                CreateSnapshot(backupDirectory, database, false);
            }
        }
    }

    public string Scan(string systemId) { return Scan(systemId, "legacy", false); }

    public string Scan(string systemId, string ruleSetVersion, bool fullRescan)
    {
        Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(ScanWithJournal(systemId, ruleSetVersion, fullRescan)));
        return json.Serialize(ObjectArray(envelope["items"]));
    }

    public string ScanWithJournal(string systemId, string ruleSetVersion, bool fullRescan)
    {
        string cleanRuleSet = CleanLine(ruleSetVersion, 100);
        if (String.IsNullOrWhiteSpace(cleanRuleSet)) throw new InvalidDataException("The Sync rule-set version is missing.");
        lock (RootLock(systemId))
        {
            string root = Root(systemId);
            RecoverTransactions(root);
            SyncJournalState journal = StartOrResumeSyncJournal(root, cleanRuleSet, fullRescan);
            FailAfter("scan-start");
            Dictionary<string, Dictionary<string, object>> previous = fullRescan ? new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase) : LoadSyncIndex(root, cleanRuleSet);
            var result = new List<Dictionary<string, object>>();
            var next = new List<Dictionary<string, object>>();
            var pending = new Stack<Tuple<string, int, bool>>();
            pending.Push(Tuple.Create(root, 0, false));
            while (pending.Count > 0)
            {
                Tuple<string, int, bool> current = pending.Pop();
                if (current.Item2 > 25) throw new InvalidDataException("Folder nesting limit exceeded.");
                foreach (string file in EnumerateScanFiles(root, current.Item1))
                {
                    if (result.Count >= 100000) throw new InvalidDataException("File scan limit exceeded.");
                    string filename = Path.GetFileName(file), relative = Relative(root, file).Replace(Path.DirectorySeparatorChar, '/');
                    if (current.Item2 == 0 && (String.Equals(filename, "tracker-active-session.json", StringComparison.OrdinalIgnoreCase) || String.Equals(filename, "tracker-exclusive-session.lock", StringComparison.OrdinalIgnoreCase) || String.Equals(filename, "information-system-user-tracker.json", StringComparison.OrdinalIgnoreCase) || String.Equals(filename, SyncIndexFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(filename, SyncIndexChecksumFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(filename, RenamerQueueFilename, StringComparison.OrdinalIgnoreCase))) continue;
                    bool supportedExtension = filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) || filename.EndsWith(".zip", StringComparison.OrdinalIgnoreCase), historicalSaar = current.Item3 && supportedExtension && LooksLikeSaarFilename(filename);
                    if (current.Item3 && !historicalSaar) continue;
                    long journalSize = 0L, journalModified = 0L;
                    if (supportedExtension) try { var journalInfo = new FileInfo(file);journalSize = journalInfo.Length;journalModified = new DateTimeOffset(journalInfo.LastWriteTimeUtc).ToUnixTimeMilliseconds(); } catch { }
                    Dictionary<string, object> resumed;
                    if (journal.Completed.TryGetValue(relative, out resumed) && resumed.ContainsKey("cacheable") && Convert.ToBoolean(resumed["cacheable"], CultureInfo.InvariantCulture) && JournalItemMatches(resumed, filename, journalSize, journalModified))
                    {
                        Dictionary<string, object> indexed;bool indexUnchanged = previous.TryGetValue(relative, out indexed) && JournalItemMatches(indexed, filename, journalSize, journalModified);
                        var resumedItem = new Dictionary<string, object>(resumed);resumedItem["unchanged"] = indexUnchanged;resumedItem["resumed"] = true;
                        result.Add(resumedItem);journal.ResumedFiles++;
                        bool resumedCacheable = resumed.ContainsKey("cacheable") && Convert.ToBoolean(resumed["cacheable"], CultureInfo.InvariantCulture);
                        if (resumedCacheable) next.Add(IndexItem(resumedItem));
                        continue;
                    }
                    AppendSyncJournal(journal.Path, new Dictionary<string, object> { { "type", "file" }, { "state", "pending" }, { "path", relative }, { "name", CleanLine(filename, 500) }, { "size", journalSize }, { "lastModifiedUnixMs", journalModified }, { "timestampUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) } });
                    FailAfter("scan-file-pending");
                    if (!supportedExtension)
                    {
                        var rejected = new Dictionary<string, object> { { "name", CleanLine(filename, 500) }, { "path", relative }, { "size", journalSize }, { "lastModifiedUnixMs", journalModified }, { "accepted", false }, { "error", "Only PDF evidence or a ZIP containing one PDF is accepted." }, { "unchanged", false }, { "cacheable", true } };
                        result.Add(rejected);AppendSyncJournalResult(journal.Path, rejected, "rejected");
                        continue;
                    }
                    var info = new FileInfo(file);long size, lastModifiedUnixMs;
                    try { size = info.Length;lastModifiedUnixMs = new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds(); }
                    catch (Exception error)
                    {
                        if (!(error is IOException) && !(error is UnauthorizedAccessException)) throw;
                        var rejected = new Dictionary<string, object> { { "name", CleanLine(filename, 500) }, { "path", relative }, { "size", 0L }, { "lastModifiedUnixMs", 0L }, { "accepted", false }, { "error", "File metadata could not be read: " + CleanLine(error.Message, 240) }, { "unchanged", false }, { "cacheable", false } };
                        result.Add(rejected);AppendSyncJournalResult(journal.Path, rejected, "rejected");
                        continue;
                    }
                    Dictionary<string, object> cached;
                    bool unchanged = previous.TryGetValue(relative, out cached) && String.Equals(Convert.ToString(cached["name"], CultureInfo.InvariantCulture), filename, StringComparison.OrdinalIgnoreCase) && Convert.ToInt64(cached["size"], CultureInfo.InvariantCulture) == size && Convert.ToInt64(cached["lastModifiedUnixMs"], CultureInfo.InvariantCulture) == lastModifiedUnixMs;
                    string validationError = unchanged ? Convert.ToString(cached["error"], CultureInfo.InvariantCulture) : "";
                    bool cacheable = true, accepted = unchanged ? Convert.ToBoolean(cached["accepted"], CultureInfo.InvariantCulture) : historicalSaar || TryValidateEvidenceFile(file, out validationError, out cacheable);
                    if (!unchanged)
                    {
                        try { info.Refresh();if (!info.Exists || info.Length != size || new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds() != lastModifiedUnixMs) { accepted = false; validationError = "The evidence file changed during Sync. Run Sync again."; cacheable = false; } }
                        catch (Exception error) { if (!(error is IOException) && !(error is UnauthorizedAccessException)) throw;accepted = false;validationError = "File metadata could not be rechecked after validation: " + CleanLine(error.Message, 220);cacheable = false; }
                    }
                    string cleanName = CleanLine(filename, 500), cleanError = CleanLine(validationError, 300);
                    var item = new Dictionary<string, object> { { "name", cleanName }, { "path", relative }, { "size", size }, { "lastModifiedUnixMs", lastModifiedUnixMs }, { "accepted", accepted }, { "error", cleanError }, { "unchanged", unchanged } };
                    result.Add(item);
                    if (cacheable) next.Add(new Dictionary<string, object> { { "name", cleanName }, { "path", relative }, { "size", size }, { "lastModifiedUnixMs", lastModifiedUnixMs }, { "accepted", accepted }, { "error", cleanError } });
                    item["cacheable"] = cacheable;AppendSyncJournalResult(journal.Path, item, accepted ? "validated" : "rejected");item.Remove("cacheable");
                }
                foreach (string directory in EnumerateScanDirectories(root, current.Item1))
                {
                    string name = Path.GetFileName(directory);
                    bool permanentSaarArchive = IsPermanentSaarArchiveDirectory(name);
                    if (current.Item3 || IsManagedStorageDirectory(name) && !permanentSaarArchive) continue;
                    if (IsScanReparsePoint(root, directory)) continue;
                    pending.Push(Tuple.Create(directory, current.Item2 + 1, permanentSaarArchive));
                }
            }
            SaveSyncIndex(root, cleanRuleSet, next);
            AppendSyncJournal(journal.Path, new Dictionary<string, object> { { "type", "run-state" }, { "state", "indexed" }, { "timestampUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "files", result.Count } });
            return json.Serialize(new Dictionary<string, object> { { "version", SyncJournalVersion }, { "runId", journal.RunId }, { "resumedFiles", journal.ResumedFiles }, { "items", result.ToArray() } });
        }
    }

    public string CommitSyncJournal(string systemId, string runId)
    {
        ValidateSessionId(runId);
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "Sync Journals"), path = Path.Combine(directory, "sync-" + runId + ".jsonl");
            if (!File.Exists(path)) throw new FileNotFoundException("The Sync journal no longer exists.");
            AppendSyncJournal(path, new Dictionary<string, object> { { "type", "run-state" }, { "state", "committed" }, { "timestampUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) } });
            PruneSyncJournals(directory);
            return "{\"committed\":true}";
        }
    }

    private SyncJournalState StartOrResumeSyncJournal(string root, string ruleSetVersion, bool fullRescan)
    {
        string directory = SupportDirectory(root, "Sync Journals");
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

    private void AppendSyncJournal(string path, Dictionary<string, object> item)
    {
        string line = json.Serialize(item) + Environment.NewLine;byte[] bytes = Encoding.UTF8.GetBytes(line);
        var info = new FileInfo(path);if (info.Exists && info.Length + bytes.Length > JournalLimit) throw new InvalidDataException("The resumable Sync journal exceeds the 100 MB limit.");
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        using (var stream = OpenCompatibleFileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, 8192)) { stream.Write(bytes, 0, bytes.Length);FlushCompatible(stream); }
    }

    private static bool JournalItemMatches(Dictionary<string, object> item, string filename, long size, long modified)
    {
        try { return String.Equals(Convert.ToString(item["name"], CultureInfo.InvariantCulture), filename, StringComparison.OrdinalIgnoreCase) && Convert.ToInt64(item["size"], CultureInfo.InvariantCulture) == size && Convert.ToInt64(item["lastModifiedUnixMs"], CultureInfo.InvariantCulture) == modified && item.ContainsKey("accepted") && item.ContainsKey("error"); }
        catch { return false; }
    }

    private static Dictionary<string, object> IndexItem(Dictionary<string, object> item)
    {
        return new Dictionary<string, object> { { "name", item["name"] }, { "path", item["path"] }, { "size", item["size"] }, { "lastModifiedUnixMs", item["lastModifiedUnixMs"] }, { "accepted", item["accepted"] }, { "error", item["error"] } };
    }

    private static void PruneSyncJournals(string directory)
    {
        if (!Directory.Exists(directory)) return;
        foreach (string stale in Directory.EnumerateFiles(directory, "sync-*.jsonl", SearchOption.TopDirectoryOnly).OrderByDescending(Path.GetFileName).Skip(30)) TryDelete(stale);
    }

    private Dictionary<string, Dictionary<string, object>> LoadSyncIndex(string root, string ruleSetVersion)
    {
        var result = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
        try
        {
            string indexPath = Path.Combine(root, SyncIndexFilename), checksumPath = Path.Combine(root, SyncIndexChecksumFilename);
            if (!File.Exists(indexPath) || !File.Exists(checksumPath)) return result;
            string text = ReadText(indexPath, SyncIndexLimit), checksum = ReadText(checksumPath, 1024).Trim();
            string[] checksumParts = checksum.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            if (checksumParts.Length != 2 || !String.Equals(checksumParts[1], SyncIndexFilename, StringComparison.Ordinal) || !IsSha256(checksumParts[0]) || !String.Equals(checksumParts[0], Sha256(text), StringComparison.OrdinalIgnoreCase)) return result;
            Dictionary<string, object> envelope = ObjectDictionary(json.DeserializeObject(text));
            if (!envelope.ContainsKey("version") || Convert.ToInt32(envelope["version"], CultureInfo.InvariantCulture) != SyncIndexVersion || !envelope.ContainsKey("ruleSetVersion") || !String.Equals(Convert.ToString(envelope["ruleSetVersion"], CultureInfo.InvariantCulture), ruleSetVersion, StringComparison.Ordinal) || !envelope.ContainsKey("files")) return result;
            object[] files = ObjectArray(envelope["files"]);if (files.Length > 100000) return result;
            foreach (object value in files)
            {
                Dictionary<string, object> item = ObjectDictionary(value);
                if (!item.ContainsKey("path") || !item.ContainsKey("name") || !item.ContainsKey("size") || !item.ContainsKey("lastModifiedUnixMs") || !item.ContainsKey("accepted") || !item.ContainsKey("error")) return new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
                string relative = Convert.ToString(item["path"], CultureInfo.InvariantCulture), name = Convert.ToString(item["name"], CultureInfo.InvariantCulture), error = Convert.ToString(item["error"], CultureInfo.InvariantCulture);
                long size = Convert.ToInt64(item["size"], CultureInfo.InvariantCulture), modified = Convert.ToInt64(item["lastModifiedUnixMs"], CultureInfo.InvariantCulture);
                if (String.IsNullOrWhiteSpace(relative) || relative.Length > 32767 || relative.IndexOf('\0') >= 0 || String.IsNullOrWhiteSpace(name) || name.Length > 500 || size < 0 || modified < 0 || error.Length > 300) return new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
                item["accepted"] = Convert.ToBoolean(item["accepted"], CultureInfo.InvariantCulture);result[relative] = item;
            }
        }
        catch { return new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase); }
        return result;
    }

    private void SaveSyncIndex(string root, string ruleSetVersion, List<Dictionary<string, object>> files)
    {
        try
        {
            var envelope = new Dictionary<string, object> { { "version", SyncIndexVersion }, { "ruleSetVersion", ruleSetVersion }, { "generatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "files", files.ToArray() } };
            string text = json.Serialize(envelope);byte[] bytes = Encoding.UTF8.GetBytes(text);if (bytes.LongLength > SyncIndexLimit) return;
            string indexPath = Path.Combine(root, SyncIndexFilename), checksumPath = Path.Combine(root, SyncIndexChecksumFilename);
            AtomicWrite(indexPath, bytes);AtomicWrite(checksumPath, Encoding.ASCII.GetBytes(Sha256(text) + "  " + SyncIndexFilename + Environment.NewLine));
        }
        catch { TryDelete(Path.Combine(root, SyncIndexFilename));TryDelete(Path.Combine(root, SyncIndexChecksumFilename)); }
    }

    public byte[] ReadRelativeFile(string systemId, string relative)
    {
        string path = SafeRelativePath(Root(systemId), relative);
        var file = new FileInfo(path);
        if (!file.Exists) throw new FileNotFoundException("The selected evidence file no longer exists.");
        if (file.Length > EvidenceLimit) throw new InvalidDataException("The selected evidence file exceeds the size limit.");
        return File.ReadAllBytes(path);
    }

    public string ReadRenamerQueue(string systemId)
    {
        string path = Path.Combine(Root(systemId), RenamerQueueFilename);
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
        AtomicWrite(Path.Combine(Root(systemId), RenamerQueueFilename), bytes);
        return "{\"saved\":true}";
    }

    public string ClearRenamerQueue(string systemId)
    {
        TryDelete(Path.Combine(Root(systemId), RenamerQueueFilename));
        return "{\"cleared\":true}";
    }

    public string ArchiveEvidence(string systemId, string relative, string requestedFilename = null)
    {
        lock (RootLock(systemId))
        {
            string root = Root(systemId);RecoverTransactions(root);string source = SafeRelativePath(root, relative), normalized = Relative(root, source);
            if (ContainsManagedStorageDirectory(normalized)) throw new InvalidDataException("Only active evidence files can be moved to an organization Archive folder.");
            if (!File.Exists(source)) throw new FileNotFoundException("The selected evidence file no longer exists.");
            string validationError;
            if (!TryValidateEvidenceFile(source, out validationError)) throw new InvalidDataException(String.IsNullOrWhiteSpace(validationError) ? "The selected evidence file is invalid." : validationError);
            Tuple<string, string> organization = OrganizationStorageLocation(root, source);
            string filename = SafePart(Path.GetFileName(source), 180), sourceExtension = filename.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase) ? ".pdf.zip" : Path.GetExtension(filename), archiveFilename = String.IsNullOrWhiteSpace(requestedFilename) ? filename : SafePart(requestedFilename, 180);if (String.IsNullOrWhiteSpace(sourceExtension) || !archiveFilename.EndsWith(sourceExtension, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The archive filename must preserve the PDF or ZIP evidence extension.");bool permanentSaar = IsSaarFilename(filename);
            string bucket = permanentSaar ? "Permanent SAAR" : EvidenceOlderThanYears(filename, 5) ? "Superseded" : DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), directory = permanentSaar ? Path.Combine(organization.Item1, SafePart(organization.Item2, 60) + " SAAR Archive") : Path.Combine(organization.Item1, SafePart(organization.Item2, 60) + " Archive", bucket);
            Directory.CreateDirectory(directory);
            string extension = archiveFilename.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase) ? archiveFilename.Substring(archiveFilename.Length - 8) : Path.GetExtension(archiveFilename), stem = archiveFilename.Substring(0, archiveFilename.Length - extension.Length), destination = Path.Combine(directory, archiveFilename);
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
        if (candidates.Count == 0)
        {
            MatchCollection years = Regex.Matches(value, @"(?:^|[^0-9])((?:19|20)[0-9]{2})(?![0-9])", RegexOptions.IgnoreCase);
            if (years.Count == 0) return null;
            int year;if (!Int32.TryParse(years[years.Count - 1].Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out year) || year < 1900 || year > 2099) return null;
            return new DateTime(year, 12, 31, 0, 0, 0, DateTimeKind.Utc);
        }
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

    public string ProcessReworkRetention(string systemId)
    {
        lock (RootLock(systemId))
        {
            string root = Root(systemId);RecoverTransactions(root);
            var errors = new List<Dictionary<string, object>>();
            var moved = new List<Dictionary<string, object>>();
            var compressed = new List<Dictionary<string, object>>();
            var pending = new Stack<Tuple<string, int, bool, bool, bool>>();
            pending.Push(Tuple.Create(root, 0, false, false, false));
            int scanned = 0, skippedSaar = 0, currentFiles = 0, undated = 0;
            while (pending.Count > 0)
            {
                Tuple<string, int, bool, bool, bool> current = pending.Pop();
                if (current.Item2 > 25) { errors.Add(RetentionError(root, current.Item1, "Folder nesting limit exceeded during the Archive preflight."));continue; }
                string[] files;
                try { files = EnumerateScanFiles(root, current.Item1); }
                catch (Exception error) { errors.Add(RetentionError(root, current.Item1, CleanLine(error.Message, 300)));files = new string[0]; }
                foreach (string source in files)
                {
                    if (scanned >= 100000) { errors.Add(RetentionError(root, current.Item1, "Archive preflight file limit exceeded."));break; }
                    string filename = Path.GetFileName(source);
                    bool supported = filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) || filename.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
                    if (!supported)
                    {
                        if (current.Item3 || current.Item5 || IsRootControlFile(root, source)) continue;
                        scanned++;
                        try
                        {
                            Tuple<string, string> organization = OrganizationStorageLocation(root, source);string directory = Path.Combine(organization.Item1, SafePart(organization.Item2, 60) + " Rework");Directory.CreateDirectory(directory);
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
                    if (current.Item3 && source.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                    {
                        try
                        {
                            string compressedPath = CompressEvidenceFile(root, source, true);compressed.Add(new Dictionary<string, object> { { "source", Relative(root, source).Replace(Path.DirectorySeparatorChar, '/') }, { "compressed", Relative(root, compressedPath).Replace(Path.DirectorySeparatorChar, '/') } });effectiveSource = compressedPath;filename = Path.GetFileName(compressedPath);
                        }
                        catch (Exception error) { errors.Add(RetentionError(root, source, "Archive compression failed: " + CleanLine(error.Message, 260))); }
                    }
                    bool saar = IsSaarFilename(filename), disabledSaar = saar && IsDisabledSaarFilename(filename), archivedSaar = current.Item3 && !current.Item4 && saar;
                    DateTime? evidenceDate = EvidenceDate(filename);bool insideSuperseded = current.Item3 && IsSupersededDirectory(root, current.Item1), datedArchiveRepair = insideSuperseded && !saar && evidenceDate.HasValue && evidenceDate.Value >= DateTime.UtcNow.Date.AddYears(-5);
                    if (current.Item4) continue;
                    if (current.Item3 && !archivedSaar && !datedArchiveRepair) continue;
                    if (!current.Item3 && saar && !disabledSaar) { skippedSaar++;continue; }
                    if (!disabledSaar && !archivedSaar && !datedArchiveRepair && !evidenceDate.HasValue) { undated++;continue; }
                    if (!disabledSaar && !archivedSaar && !datedArchiveRepair && evidenceDate.Value >= DateTime.UtcNow.Date.AddYears(-1)) { currentFiles++;continue; }
                    try
                    {
                        if (effectiveSource.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                        {
                            try { string compressedPath = CompressEvidenceFile(root, effectiveSource, true);compressed.Add(new Dictionary<string, object> { { "source", Relative(root, effectiveSource).Replace(Path.DirectorySeparatorChar, '/') }, { "compressed", Relative(root, compressedPath).Replace(Path.DirectorySeparatorChar, '/') } });effectiveSource = compressedPath;filename = Path.GetFileName(compressedPath); }
                            catch (Exception compressionError) { errors.Add(RetentionError(root, effectiveSource, "Archive compression failed; the source file was preserved for archival: " + CleanLine(compressionError.Message, 220))); }
                        }
                        Tuple<string, string> organization = OrganizationStorageLocation(root, effectiveSource);
                        bool permanentSaar = disabledSaar || archivedSaar;string bucket = permanentSaar ? "Permanent SAAR" : evidenceDate.HasValue && evidenceDate.Value < DateTime.UtcNow.Date.AddYears(-5) ? "Superseded" : DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                        string directory = permanentSaar ? Path.Combine(organization.Item1, SafePart(organization.Item2, 60) + " SAAR Archive") : Path.Combine(organization.Item1, SafePart(organization.Item2, 60) + " Archive", bucket), destination;
                        Directory.CreateDirectory(directory);destination = UniqueDestination(directory, filename);
                        string sourceHash = Sha256Bytes(File.ReadAllBytes(effectiveSource)), transaction = BeginTransaction(root, "retention-preflight", effectiveSource, destination, sourceHash, "");
                        File.Move(effectiveSource, destination);FailAfter("rework-retention-move");
                        if (!String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The Archive preflight evidence failed its SHA-256 integrity check.");
                        CompleteTransaction(transaction);
                        moved.Add(new Dictionary<string, object> { { "source", Relative(root, effectiveSource).Replace(Path.DirectorySeparatorChar, '/') }, { "archived", Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/') }, { "bucket", bucket }, { "evidenceDate", evidenceDate.HasValue ? evidenceDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : permanentSaar ? "Permanent SAAR" : "Recognized Filename Year" } });
                    }
                    catch (Exception error) { errors.Add(RetentionError(root, effectiveSource, CleanLine(error.Message, 300))); }
                }
                string[] directories;
                try { directories = EnumerateScanDirectories(root, current.Item1); }
                catch (Exception error) { errors.Add(RetentionError(root, current.Item1, CleanLine(error.Message, 300)));continue; }
                foreach (string directory in directories)
                {
                    string name = Path.GetFileName(directory);
                    bool isSaarArchive = name.EndsWith(" SAAR Archive", StringComparison.OrdinalIgnoreCase);
                    if (current.Item3 || name.EndsWith(" Archive", StringComparison.OrdinalIgnoreCase)) { if (!IsScanReparsePoint(root, directory)) pending.Push(Tuple.Create(directory, current.Item2 + 1, true, current.Item4 || isSaarArchive, false));continue; }
                    if (IsReworkStorageDirectory(name)) { pending.Push(Tuple.Create(directory, current.Item2 + 1, false, false, true));continue; }
                    if (IsManagedStorageDirectory(name) || IsScanReparsePoint(root, directory)) continue;
                    pending.Push(Tuple.Create(directory, current.Item2 + 1, false, false, false));
                }
            }
            return json.Serialize(new Dictionary<string, object> { { "moved", moved.ToArray() }, { "compressed", compressed.ToArray() }, { "errors", errors.ToArray() }, { "scanned", scanned }, { "skippedSaar", skippedSaar }, { "current", currentFiles }, { "undated", undated } });
        }
    }

    private static bool IsReworkStorageDirectory(string name) { return String.Equals(name, "Rework", StringComparison.OrdinalIgnoreCase) || name.EndsWith(" Rework", StringComparison.OrdinalIgnoreCase); }
    private static bool IsSupersededDirectory(string root, string directory) { return Relative(root, directory).Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries).Any(part => String.Equals(part, "Superseded", StringComparison.OrdinalIgnoreCase)); }
    private static bool IsSaarFilename(string filename) { return (filename ?? "").IndexOf("SAAR", StringComparison.OrdinalIgnoreCase) >= 0; }
    private static bool IsDisabledSaarFilename(string filename) { return IsSaarFilename(filename) && Regex.IsMatch(filename ?? "", @"(?:^|[^A-Za-z0-9])DISABLED(?:[^A-Za-z0-9]|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant); }
    private static bool IsRootControlFile(string root, string path)
    {
        if (!String.Equals(Path.GetDirectoryName(path).TrimEnd(Path.DirectorySeparatorChar), root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) return false;
        string name = Path.GetFileName(path);
        return String.Equals(name, "tracker-active-session.json", StringComparison.OrdinalIgnoreCase) || String.Equals(name, "tracker-exclusive-session.lock", StringComparison.OrdinalIgnoreCase) || String.Equals(name, "information-system-user-tracker.json", StringComparison.OrdinalIgnoreCase) || String.Equals(name, SyncIndexFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(name, SyncIndexChecksumFilename, StringComparison.OrdinalIgnoreCase) || String.Equals(name, RenamerQueueFilename, StringComparison.OrdinalIgnoreCase);
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
            string root = Root(systemId);RecoverTransactions(root);string source = SafeRelativePath(root, relative), normalized = Relative(root, source);
            if (ContainsManagedStorageDirectory(normalized)) throw new InvalidDataException("Only active correction evidence can be moved to an organization Rework folder.");
            bool sourceIsPdf = source.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase), sourceIsZip = source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
            if (!sourceIsPdf && !sourceIsZip) throw new InvalidDataException("Only a PDF or a ZIP containing one PDF can be moved to Rework.");
            if (!File.Exists(source)) throw new FileNotFoundException("The selected correction evidence no longer exists.");
            Tuple<string, string> organization = OrganizationStorageLocation(root, source);
            string directory = Path.Combine(organization.Item1, SafePart(organization.Item2, 60) + " Rework"), filename = SafePart(Path.GetFileName(source), 180);
            Directory.CreateDirectory(directory);
            if (sourceIsZip)
            {
                string validationError;if (!TryValidateEvidenceFile(source, out validationError)) throw new InvalidDataException(String.IsNullOrWhiteSpace(validationError) ? "The selected correction ZIP is invalid." : validationError);
                string embeddedName;
                using (Stream input = File.Open(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var archive = new ZipArchive(input, ZipArchiveMode.Read, false)) embeddedName = Path.GetFileName(archive.Entries.Single(entry => !entry.FullName.EndsWith("/", StringComparison.Ordinal)).FullName);
                if (filename.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase)) filename = filename.Substring(0, filename.Length - 4);
                else filename = SafePart(embeddedName, 180);
                if (!filename.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) filename = SafePart(Path.GetFileNameWithoutExtension(filename), 175) + ".pdf";
                string extractedDestination = UniqueDestination(directory, filename), temporary = Path.Combine(directory, ".isut-" + Guid.NewGuid().ToString("N") + ".tmp"), zipHash = Sha256Bytes(File.ReadAllBytes(source)), extractedHash = "", extractTransaction = null;
                try
                {
                    using (Stream input = File.Open(source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                    using (var archive = new ZipArchive(input, ZipArchiveMode.Read, false))
                    using (Stream entry = archive.Entries.Single(item => !item.FullName.EndsWith("/", StringComparison.Ordinal)).Open())
                    using (var output = OpenCompatibleFileStream(temporary, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 81920)) { entry.CopyTo(output);FlushCompatible(output);output.Position = 0;ValidatePdfStream(output, filename, output.Length); }
                    extractedHash = Sha256Bytes(File.ReadAllBytes(temporary));extractTransaction = BeginTransaction(root, "rework-extract", source, extractedDestination, zipHash, extractedHash);
                    File.Move(temporary, extractedDestination);FailAfter("rework-extract-move");
                    if (!String.Equals(extractedHash, Sha256Bytes(File.ReadAllBytes(extractedDestination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The extracted Rework PDF failed its SHA-256 integrity check.");
                    File.Delete(source);CompleteTransaction(extractTransaction);
                }
                catch { TryDelete(temporary);throw; }
                string extracted = Relative(root, extractedDestination).Replace(Path.DirectorySeparatorChar, '/');
                return json.Serialize(new Dictionary<string, object> { { "reworked", extracted }, { "extracted", true }, { "sourceRemoved", true } });
            }
            string extension = Path.GetExtension(filename), stem = Path.GetFileNameWithoutExtension(filename), destination = Path.Combine(directory, filename);
            for (int index = 1; File.Exists(destination); index++) destination = Path.Combine(directory, stem + "_" + index.ToString(CultureInfo.InvariantCulture) + extension);
            string sourceHash = Sha256Bytes(File.ReadAllBytes(source)), transaction = BeginTransaction(root, "rework", source, destination, sourceHash, "");
            File.Move(source, destination);FailAfter("rework-move");
            if (!String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The Rework move failed its SHA-256 integrity check.");
            CompleteTransaction(transaction);
            string reworked = Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/');
            return json.Serialize(new Dictionary<string, object> { { "reworked", reworked }, { "extracted", false }, { "sourceRemoved", true } });
        }
    }

    public string OrganizeEvidence(string systemId, string relative, string folder)
    {
        lock (RootLock(systemId))
        {
            string root = Root(systemId);RecoverTransactions(root);string source = SafeRelativePath(root, relative), normalized = Relative(root, source), safeFolder = SafePart(folder, 60);
            string[] allowed = { "SAAR", "User Agreement", "DoD Cyber Cert", "8140 Certification Memo", "Privileged User Training", "DTA Training" };
            if (!allowed.Any(item => String.Equals(item, safeFolder, StringComparison.OrdinalIgnoreCase)) || !String.Equals(safeFolder, folder, StringComparison.Ordinal)) throw new InvalidDataException("The evidence document-type folder is invalid.");
            if (ContainsManagedStorageDirectory(normalized)) throw new InvalidDataException("Only active evidence files can be organized by document type.");
            if (!File.Exists(source)) throw new FileNotFoundException("The selected evidence file no longer exists.");
            string validationError;if (!TryValidateEvidenceFile(source, out validationError)) throw new InvalidDataException(String.IsNullOrWhiteSpace(validationError) ? "The selected evidence file is invalid." : validationError);
            Tuple<string, string> organization = OrganizationStorageLocation(root, source);string directory = Path.Combine(organization.Item1, safeFolder);Directory.CreateDirectory(directory);
            string destination = Path.Combine(directory, Path.GetFileName(source));
            if (String.Equals(source, destination, StringComparison.OrdinalIgnoreCase)) return json.Serialize(new Dictionary<string, object> { { "organized", Relative(root, source).Replace(Path.DirectorySeparatorChar, '/') }, { "alreadyCompleted", true } });
            if (File.Exists(destination)) return json.Serialize(new Dictionary<string, object> { { "organized", Relative(root, source).Replace(Path.DirectorySeparatorChar, '/') }, { "collision", true }, { "existing", Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/') } });
            string sourceHash = Sha256Bytes(File.ReadAllBytes(source)), transaction = BeginTransaction(root, "organize", source, destination, sourceHash, "");
            File.Move(source, destination);FailAfter("organize-move");
            try { if (!String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The organized evidence failed its SHA-256 integrity check."); }
            catch { if (!File.Exists(source) && File.Exists(destination)) File.Move(destination, source);throw; }
            CompleteTransaction(transaction);
            return json.Serialize(new Dictionary<string, object> { { "organized", Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/') } });
        }
    }

    public string NormalizeEvidenceFilename(string systemId, string relative, string filename)
    {
        lock (RootLock(systemId))
        {
            string root = Root(systemId);RecoverTransactions(root);string source = SafeRelativePath(root, relative), normalized = Relative(root, source);
            if (ContainsManagedStorageDirectory(normalized)) throw new InvalidDataException("Only active evidence filenames can be normalized.");
            if (!File.Exists(source)) throw new FileNotFoundException("The selected evidence file no longer exists.");
            string safeName = SafePart(filename, 180);
            if (!String.Equals(safeName, filename, StringComparison.Ordinal) || !String.Equals(Path.GetFileName(filename), filename, StringComparison.Ordinal)) throw new InvalidDataException("The normalized evidence filename is invalid or too long.");
            string sourceExtension = Path.GetExtension(source), targetExtension = Path.GetExtension(safeName);
            if ((!sourceExtension.Equals(".pdf", StringComparison.OrdinalIgnoreCase) && !sourceExtension.Equals(".zip", StringComparison.OrdinalIgnoreCase)) || !sourceExtension.Equals(targetExtension, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The normalized filename must preserve the PDF or ZIP extension.");
            string destination = Path.Combine(Path.GetDirectoryName(source), safeName);
            if (String.Equals(source, destination, StringComparison.Ordinal)) return json.Serialize(new Dictionary<string, object> { { "renamed", Relative(root, source).Replace(Path.DirectorySeparatorChar, '/') }, { "alreadyCompleted", true } });
            if (File.Exists(destination)) return json.Serialize(new Dictionary<string, object> { { "renamed", Relative(root, source).Replace(Path.DirectorySeparatorChar, '/') }, { "collision", true }, { "existing", Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/') } });
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
            return json.Serialize(new Dictionary<string, object> { { "renamed", Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/') } });
        }
    }

    public string CompressEvidence(string systemId, string relative)
    {
        lock (RootLock(systemId))
        {
            string root = Root(systemId);RecoverTransactions(root);string source = SafeRelativePath(root, relative), normalized = Relative(root, source);
            if (ContainsManagedStorageDirectory(normalized)) throw new InvalidDataException("Only active evidence files can be compressed.");
            bool alreadyCompleted;string destination = CompressEvidenceFile(root, source, false, out alreadyCompleted), compressed = Relative(root, destination).Replace(Path.DirectorySeparatorChar, '/');
            if (alreadyCompleted) return json.Serialize(new Dictionary<string, object> { { "compressed", compressed }, { "alreadyCompleted", true } });
            return json.Serialize(new Dictionary<string, object> { { "compressed", compressed } });
        }
    }

    private string CompressEvidenceFile(string root, string source, bool allowManaged) { bool ignored;return CompressEvidenceFile(root, source, allowManaged, out ignored); }

    private string CompressEvidenceFile(string root, string source, bool allowManaged, out bool alreadyCompleted)
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
        string validationError;
        if (!TryValidateEvidenceFile(source, out validationError)) throw new InvalidDataException(String.IsNullOrWhiteSpace(validationError) ? "The selected PDF is invalid." : validationError);
        string sourcePdfHash = EvidencePdfSha256(source);
        if (File.Exists(destination))
        {
            string existingError;
            if (!TryValidateEvidenceFile(destination, out existingError)) throw new IOException("A ZIP with the same filename already exists but is not valid evidence. Both files were preserved for collision review.");
            if (!String.Equals(sourcePdfHash, EvidencePdfSha256(destination), StringComparison.OrdinalIgnoreCase)) throw new IOException("A different PDF already occupies the ZIP compression destination. Both files were preserved for collision review.");
            string existingTransaction = BeginTransaction(root, "compression", source, destination, sourcePdfHash, "");
            File.Delete(source);CompleteTransaction(existingTransaction);alreadyCompleted = true;return destination;
        }
        string temporary = Path.Combine(Path.GetDirectoryName(destination), ".isut-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
            {
                using (var archive = new ZipArchive(output, ZipArchiveMode.Create, true))
                {
                    ZipArchiveEntry entry = archive.CreateEntry(Path.GetFileName(source), CompressionLevel.Optimal);
                    using (Stream input = File.Open(source, FileMode.Open, FileAccess.Read, FileShare.Read))
                    using (Stream target = entry.Open()) input.CopyTo(target);
                }
                output.Position = 0;
                ValidateEvidenceZip(output, Path.GetFileName(destination));
                FlushCompatible(output);
            }
            string transaction = BeginTransaction(root, "compression", source, destination, sourcePdfHash, "");
            File.Move(temporary, destination);FailAfter("compression-move");
            try { File.Delete(source);CompleteTransaction(transaction); }
            catch { TryDelete(destination);throw; }
        }
        catch { TryDelete(temporary);throw; }
        return destination;
    }

    public string StoreEvidence(string systemId, string organization, string last, string first, string filename, byte[] bytes)
    {
        if (bytes.Length > EvidenceLimit) throw new InvalidDataException("The compressed evidence exceeds the size limit.");
        string entry = SafePart(filename, 180), zipName = entry.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ? entry : entry + ".zip";
        if (!entry.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Stored evidence must be a ZIP containing exactly one PDF.");
        try { using (var memory = new MemoryStream(bytes, false)) ValidateEvidenceZip(memory, zipName); }
        catch (InvalidDataException) { throw; }
        catch (Exception) { throw new InvalidDataException("The evidence ZIP is invalid or unreadable."); }
        lock (RootLock(systemId))
        {
            string directory = Path.Combine(Root(systemId), "Organizations", ValidOrganizationName(organization), SafePart(last, 80) + "_" + SafePart(first, 80));
            Directory.CreateDirectory(directory);
            AtomicWrite(Path.Combine(directory, zipName), bytes);
        }
        return zipName;
    }

    public string ListOrganizations(string systemId)
    {
        lock (RootLock(systemId))
        {
            string root = Root(systemId), directory = Path.Combine(root, "Organizations");Directory.CreateDirectory(directory);
            string[] names = EnumerateScanDirectories(root, directory).Select(path => new DirectoryInfo(path).Name).Where(name => !ReservedOrganizationName(name)).OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToArray();
            return json.Serialize(names);
        }
    }

    public string CreateOrganization(string systemId, string requested)
    {
        string organization = ValidOrganizationName(requested);
        lock (RootLock(systemId))
        {
            string directory = Path.Combine(Root(systemId), "Organizations", organization);Directory.CreateDirectory(directory);
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

    public string StoreInspectionPackage(string systemId, string filename, byte[] bytes)
    {
        if (bytes == null || bytes.Length == 0 || bytes.Length > 50L * 1024 * 1024) throw new InvalidDataException("The inspection package is empty or exceeds the 50 MB limit.");
        string safeName = SafePart(filename, 180);if (!safeName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Inspection packages must use the ZIP format.");
        var required = new HashSet<string>(new[] { "compliance-snapshot.pdf", "filtered-users.csv", "evidence-inventory.csv", "audit-chain-verification.json", "release-metadata.json", "active-exceptions.csv" }, StringComparer.OrdinalIgnoreCase);
        using (var memory = new MemoryStream(bytes, false))
        using (var archive = new ZipArchive(memory, ZipArchiveMode.Read, true))
        {
            if (archive.Entries.Count != required.Count) throw new InvalidDataException("The inspection package must contain exactly the six required inspection files.");
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                ValidateZipEntryName(entry.FullName);if (!required.Remove(entry.FullName)) throw new InvalidDataException("The inspection package contains an unexpected or duplicate entry.");
                if (entry.Length <= 0 || entry.Length > 25L * 1024 * 1024) throw new InvalidDataException("An inspection-package entry is empty or exceeds its size limit.");
                if (entry.FullName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) using (Stream pdf = entry.Open()) ValidatePdfStream(pdf, entry.FullName, entry.Length);
            }
            if (required.Count != 0) throw new InvalidDataException("The inspection package is missing a required entry.");
        }
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "Reports"), path = Path.Combine(directory, safeName), hash = Sha256Bytes(bytes), saved = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            AtomicWrite(path, bytes);try { AtomicWrite(path + ".sha256", Encoding.ASCII.GetBytes(hash + "  " + safeName + "\n")); } catch { TryDelete(path);throw; }
            return json.Serialize(new Dictionary<string, object> { { "filename", safeName }, { "saved", saved }, { "sha256", hash } });
        }
    }

    public string VerifyAuditLogs(string systemId)
    {
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "Audit Logs");
            AuditState state = VerifyAuditChainWithRetry(directory);
            return json.Serialize(new Dictionary<string, object> { { "healthy", true }, { "entries", state.Entries }, { "files", state.Files }, { "legacyFiles", state.LegacyFiles }, { "firstTimestamp", state.FirstTimestamp }, { "lastTimestamp", state.LastTimestamp }, { "headHash", state.HeadHash } });
        }
    }

    public string ReadAuditLogs(string systemId)
    {
        lock (RootLock(systemId))
        {
            string directory = SupportDirectory(Root(systemId), "Audit Logs");
            AuditState state = VerifyAuditChain(directory);
            state.Recent.Reverse();
            return json.Serialize(new Dictionary<string, object> { { "healthy", true }, { "entries", state.Entries }, { "files", state.Files }, { "legacyFiles", state.LegacyFiles }, { "firstTimestamp", state.FirstTimestamp }, { "lastTimestamp", state.LastTimestamp }, { "headHash", state.HeadHash }, { "recent", state.Recent } });
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
            AuditState state = VerifyAuditChainWithRetry(directory);
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
                currentPath = path;
                buffer.Append(json.Serialize(entry)).Append('\n');
                state.Entries = sequence;
                state.HeadHash = entryHash;
                state.LastInstant = now;
                state.LastTimestamp = timestamp;
            }
            if (currentPath != null) AppendAuditBytes(currentPath, Encoding.UTF8.GetBytes(buffer.ToString()));
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

    public void Dispose()
    {
        HeldLease[] leases;
        lock (mapGate) { leases = heldLeases.Values.ToArray(); heldLeases.Clear(); }
        foreach (HeldLease held in leases) DisposeLease(held, true);
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
        string created = DateTime.UtcNow.ToString("o"), filename = "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss-fffffffZ") + ".json";
        var envelope = new Dictionary<string, object> { { "backupVersion", 1 }, { "created", created }, { "contentHash", stateHash }, { "database", database } };
        string text = json.Serialize(envelope), path = Path.Combine(directory, filename), integrity = Sha256(text);
        AtomicWrite(path, Encoding.UTF8.GetBytes(text));
        try { AtomicWrite(path + ".sha256", Encoding.ASCII.GetBytes(integrity + "  " + filename + Environment.NewLine)); }
        catch { TryDelete(path); throw; }
        foreach (string stale in SnapshotPaths(directory).Skip(SnapshotLimit).ToArray()) { TryDelete(stale); TryDelete(stale + ".sha256"); }
        return created;
    }

    private Dictionary<string, object> VerifySnapshot(string path)
    {
        if (!File.Exists(path + ".sha256")) throw new InvalidDataException("The matching SHA-256 file is missing.");
        string text = ReadText(path, ManifestLimit), checksum = ReadText(path + ".sha256", 1024).Trim(), filename = Path.GetFileName(path);
        string[] parts = checksum.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2 || parts[1] != filename || parts[0].Length != 64 || !String.Equals(parts[0], Sha256(text), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The backup SHA-256 integrity check failed.");
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
        return Directory.EnumerateFiles(directory, "user-tracker-*.json", SearchOption.TopDirectoryOnly).OrderByDescending(path => Path.GetFileName(path), StringComparer.Ordinal);
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
        return value;
    }

    private static void ValidateDatabaseObject(Dictionary<string, object> value) { MigrateDatabaseObject(value); }

    private string StateHash(Dictionary<string, object> database)
    {
        var state = new Dictionary<string, object> { { "systems", database["systems"] }, { "users", database["users"] } };
        return Sha256(json.Serialize(state));
    }

    private bool RefreshLease(string systemId, HeldLease held, bool released)
    {
        try { WriteLeaseMetadata(held, released); return true; }
        catch
        {
            lock (mapGate) { HeldLease current; if (heldLeases.TryGetValue(systemId, out current) && Object.ReferenceEquals(current, held)) heldLeases.Remove(systemId); }
            DisposeLease(held, false);
            return false;
        }
    }

    private void WriteLeaseMetadata(HeldLease held, bool released)
    {
        var value = new Dictionary<string, object> { { "sessionId", held.SessionId }, { "actor", actor }, { "computer", Environment.MachineName }, { "processId", System.Diagnostics.Process.GetCurrentProcess().Id }, { "updated", DateTime.UtcNow.ToString("o") }, { "released", released }, { "lockType", "exclusive-windows-file-lock" } };
        byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(value));
        held.Stream.Position = 0;
        held.Stream.SetLength(0);
        held.Stream.Write(bytes, 0, bytes.Length);
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

    private static string SupportDirectory(string root, string name)
    {
        string system = Path.Combine(root, SystemDirectoryName), directory = Path.Combine(system, name);
        Directory.CreateDirectory(directory);
        return directory;
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
        string id = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffffffZ", CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N"), path = Path.Combine(directory, "transaction-" + id + ".json");
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
            if (operation == "compression")
            {
                if (File.Exists(destination))
                {
                    string validationError;if (!TryValidateEvidenceFile(destination, out validationError)) { if (File.Exists(source)) { TryDelete(destination);CompleteTransaction(path);continue; } throw new InvalidDataException("An interrupted evidence compression left an invalid ZIP without its source PDF."); }
                    if (!String.IsNullOrEmpty(sourceHash) && !String.Equals(sourceHash, EvidencePdfSha256(destination), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("An interrupted evidence compression found different PDF content at the ZIP destination. Both files were preserved for collision review.");
                    if (File.Exists(source))
                    {
                        if (!String.IsNullOrEmpty(sourceHash) && !String.Equals(sourceHash, EvidencePdfSha256(source), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("An interrupted evidence compression source changed after the transaction began. Both files were preserved for collision review.");
                        File.Delete(source);
                    }
                    CompleteTransaction(path);continue;
                }
                if (File.Exists(source)) { CompleteTransaction(path);continue; }
                throw new InvalidDataException("An interrupted evidence compression lost both source and destination files.");
            }
            if (operation == "rework-extract")
            {
                bool extractSourceExists = File.Exists(source), extractDestinationExists = File.Exists(destination);
                if (extractDestinationExists)
                {
                    string validationError;if (!TryValidateEvidenceFile(destination, out validationError) || !destination.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("An interrupted Rework extraction left an invalid destination PDF.");
                    if (!String.IsNullOrEmpty(destinationHash) && !String.Equals(destinationHash, Sha256Bytes(File.ReadAllBytes(destination)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("An interrupted Rework extraction found different PDF content at the destination.");
                    if (extractSourceExists)
                    {
                        if (!String.IsNullOrEmpty(sourceHash) && !String.Equals(sourceHash, Sha256Bytes(File.ReadAllBytes(source)), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("An interrupted Rework extraction source ZIP changed after the transaction began. Both files were preserved for review.");
                        File.Delete(source);
                    }
                    CompleteTransaction(path);continue;
                }
                if (extractSourceExists) { CompleteTransaction(path);continue; }
                throw new InvalidDataException("An interrupted Rework extraction lost both source and destination files.");
            }
            if (operation == "manifest-write")
            {
                if (!File.Exists(destination)) { CompleteTransaction(path);continue; }
                string currentHash = Sha256Bytes(File.ReadAllBytes(destination));
                if ((!String.IsNullOrEmpty(destinationHash) && String.Equals(currentHash, destinationHash, StringComparison.OrdinalIgnoreCase)) || (!String.IsNullOrEmpty(sourceHash) && String.Equals(currentHash, sourceHash, StringComparison.OrdinalIgnoreCase))) { CompleteTransaction(path);continue; }
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
        if (String.IsNullOrEmpty(filename) || filename != Path.GetFileName(filename) || !filename.StartsWith("user-tracker-", StringComparison.Ordinal) || !filename.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The backup filename is invalid.");
        return SafeRelativePath(directory, filename);
    }

    private static string SafeRelativePath(string root, string relative)
    {
        if (String.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative)) throw new InvalidDataException("The requested file path is invalid.");
        string fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase)) throw new UnauthorizedAccessException("The requested file is outside the mapped system folder.");
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
        return String.Equals(value, SystemDirectoryName, StringComparison.OrdinalIgnoreCase) || String.Equals(value, ErrorReportsDirectoryName, StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Audit Logs", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "backup", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Archive Review", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Rework", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Reports", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Sync Journals", StringComparison.OrdinalIgnoreCase) || String.Equals(value, "Storage Transactions", StringComparison.OrdinalIgnoreCase) || value.EndsWith(" Rework", StringComparison.OrdinalIgnoreCase) || value.EndsWith(" Archive", StringComparison.OrdinalIgnoreCase);
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

    private static string ComparableStorageName(string value)
    {
        var result = new StringBuilder();
        foreach (char character in value ?? "") if (Char.IsLetterOrDigit(character)) result.Append(Char.ToUpperInvariant(character));
        return result.ToString();
    }

    private static bool ReservedOrganizationName(string value)
    {
        string comparable = ComparableStorageName(value), upper = (value ?? "").Trim().ToUpperInvariant();
        string[] reserved = { "ORGANIZATIONS", "USEREVIDENCE", "ACTIVE", "ACTIVEEVIDENCE", "EVIDENCE", "GENERAL", "GENERALUSERS", "PRIVILEGED", "PRIVILEGEDUSERS", "USERS", "USERRECORDS", "USERACCOUNTS", "SAAR", "DODCYBERCERT", "USERAGREEMENT", "8140CERTIFICATIONMEMO", "PRIVILEGEDUSERTRAINING", "DTATRAINING", "SYSTEM", "ERRORREPORTS", "AUDITLOGS", "BACKUP", "ARCHIVEREVIEW", "REPORTS", "SYNCJOURNALS", "STORAGETRANSACTIONS" };
        return reserved.Contains(comparable, StringComparer.OrdinalIgnoreCase) || Regex.IsMatch(value ?? "", @"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) || upper.EndsWith(" REWORK", StringComparison.OrdinalIgnoreCase) || upper.EndsWith(" ARCHIVE", StringComparison.OrdinalIgnoreCase);
    }

    private static string ValidOrganizationName(string value)
    {
        string raw = (value ?? "").Trim(), safe = SafePart(raw, 80);
        if (String.IsNullOrWhiteSpace(raw) || raw.Length > 80 || !String.Equals(raw, safe, StringComparison.Ordinal) || ReservedOrganizationName(raw)) throw new InvalidDataException("The organization name is invalid or reserved for application storage.");
        return raw;
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

    private static string[] EnumerateScanFiles(string root, string directory)
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
        try { return (File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0; }
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

    private static IOException ScanFailure(string root, string path, string stage, Exception error)
    {
        string location;
        try { location = String.Equals(Path.GetFullPath(root), Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase) ? "." : Relative(root, path).Replace(Path.DirectorySeparatorChar, '/'); }
        catch { location = CleanLine(path, 300); }
        return new IOException("Scan failed while " + stage + " at " + location + ". " + CleanLine(error.Message, 300), error);
    }

    private static string NormalizeRootPath(string path)
    {
        if (String.IsNullOrWhiteSpace(path) || path.StartsWith(@"\\?\", StringComparison.Ordinal) || path.StartsWith(@"\\.\", StringComparison.Ordinal)) throw new InvalidDataException("The selected system folder path is invalid.");
        return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
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
        return TryValidateEvidenceFile(path, out error, out cacheable);
    }

    private static bool TryValidateEvidenceFile(string path, out string error, out bool cacheable)
    {
        error = "";
        cacheable = true;
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists) throw new FileNotFoundException("The evidence file is missing.");
            if (info.Length > EvidenceLimit) throw new InvalidDataException("The file exceeds the 100 MB evidence limit.");
            if (path.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
            {
                using (var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) ValidatePdfStream(stream, Path.GetFileName(path), info.Length);
                return true;
            }
            if (path.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            {
                using (var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) ValidateEvidenceZip(stream, Path.GetFileName(path));
                return true;
            }
            error = "Only PDF evidence or a ZIP containing one PDF is accepted.";
            return false;
        }
        catch (InvalidDataException ex) { error = CleanLine(ex.Message, 300); return false; }
        catch (IOException ex) { cacheable = false;error = CleanLine(ex.Message, 300);return false; }
        catch (UnauthorizedAccessException ex) { cacheable = false;error = CleanLine(ex.Message, 300);return false; }
        catch (Exception ex) { cacheable = false;error = CleanLine(ex.Message, 300);return false; }
    }

    private static void ValidateEvidenceZip(Stream stream, string label)
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
            try { using (Stream pdf = files[0].Open()) ValidatePdfStream(pdf, files[0].FullName, files[0].Length); }
            catch (InvalidDataException) { throw; }
            catch (Exception) { throw new InvalidDataException(label + " contains an encrypted, unsupported, or unreadable PDF entry."); }
        }
    }

    private static void ValidateZipEntryName(string name)
    {
        if (String.IsNullOrWhiteSpace(name) || name.IndexOf('\0') >= 0 || name.IndexOf('\\') >= 0 || name.StartsWith("/", StringComparison.Ordinal) || (name.Length > 1 && Char.IsLetter(name[0]) && name[1] == ':')) throw new InvalidDataException("The ZIP contains an unsafe entry path.");
        foreach (string segment in name.Split('/')) if (segment == "." || segment == "..") throw new InvalidDataException("The ZIP contains an unsafe entry path.");
    }

    private static void ValidatePdfStream(Stream stream, string label, long expectedLength)
    {
        byte[] buffer = new byte[8192], head = new byte[1024], tail = new byte[4096];
        int headCount = 0, tailCount = 0, tailPosition = 0, read;
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
    private static string ReadText(string path, long limit) { var info = new FileInfo(path); if (!info.Exists) throw new FileNotFoundException("The requested file is missing."); if (info.Length > limit) throw new InvalidDataException("The requested file exceeds its size limit."); return File.ReadAllText(path, Encoding.UTF8); }
    private static string EvidencePdfSha256(string path)
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

    private static string Sha256Stream(Stream value) { using (var sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(value)).Replace("-", "").ToLowerInvariant(); } }
    private static string Sha256(string value) { using (var sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant(); } }
    private static string Sha256Bytes(byte[] value) { using (var sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(value)).Replace("-", "").ToLowerInvariant(); } }
    private static string TryFileHash(string path) { try { return File.Exists(path) ? Sha256Bytes(File.ReadAllBytes(path)) : ""; } catch { return ""; } }
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
                if (!String.Equals(Sha256Bytes(File.ReadAllBytes(path)), Sha256Bytes(bytes), StringComparison.OrdinalIgnoreCase)) throw new IOException("The network-share write completed but failed its SHA-256 verification.");
                TryDelete(previous);
                return;
            }
            catch (IOException error)
            {
                if (attempt >= 2) throw new IOException("Compatible write failed for " + Path.GetFileName(path) + " during create, replace, or verification. " + CleanLine(error.Message, 300), error);
                Thread.Sleep(75 * (attempt + 1));
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
            if (!String.Equals(Sha256Bytes(File.ReadAllBytes(path)), Sha256Bytes(expected), StringComparison.OrdinalIgnoreCase)) throw new IOException("The network-share fallback write failed its SHA-256 verification.");
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
        string path = Path.Combine(root, ".isut-map-probe-" + Guid.NewGuid().ToString("N") + ".tmp");
        byte[] expected = Encoding.ASCII.GetBytes("ISUT-MAPPED-FOLDER-PROBE");
        try
        {
            using (var stream = OpenCompatibleFileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096))
            {
                stream.Write(expected, 0, expected.Length);
                FlushCompatible(stream);
            }
            byte[] actual = File.ReadAllBytes(path);
            if (!String.Equals(Sha256Bytes(actual), Sha256Bytes(expected), StringComparison.OrdinalIgnoreCase)) throw new IOException("The mapped-folder probe could not verify the bytes it wrote.");
            File.Delete(path);
        }
        catch (Exception error)
        {
            TryDelete(path);
            throw new IOException("Mapped-folder compatibility probe failed while creating, writing, reading, or deleting a temporary file. " + CleanLine(error.Message, 300), error);
        }
    }
    private static void TryDelete(string path) { try { if (File.Exists(path)) File.Delete(path); } catch { } }
}
