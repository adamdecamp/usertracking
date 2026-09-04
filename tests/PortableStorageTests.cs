using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class PortableStorageTests
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 100 * 1024 * 1024 };

    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }

    private static byte[] PdfBytes() { return Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"); }

    private static byte[] EvidenceZip(string entryName, byte[] contents)
    {
        using (var memory = new MemoryStream())
        {
            using (var archive = new ZipArchive(memory, ZipArchiveMode.Create, true))
            {
                ZipArchiveEntry entry = archive.CreateEntry(entryName, CompressionLevel.Optimal);
                using (Stream output = entry.Open()) output.Write(contents, 0, contents.Length);
            }
            return memory.ToArray();
        }
    }

    private static byte[] InspectionZip()
    {
        using (var memory = new MemoryStream())
        {
            using (var archive = new ZipArchive(memory, ZipArchiveMode.Create, true))
            {
                foreach (var item in new Dictionary<string, byte[]> { { "compliance-snapshot.pdf", PdfBytes() }, { "filtered-users.csv", Encoding.UTF8.GetBytes("header\nvalue") }, { "evidence-inventory.csv", Encoding.UTF8.GetBytes("header\nvalue") }, { "audit-chain-verification.json", Encoding.UTF8.GetBytes("{\"healthy\":true}") }, { "release-metadata.json", Encoding.UTF8.GetBytes("{\"version\":1}") }, { "active-exceptions.csv", Encoding.UTF8.GetBytes("header\nnone") } })
                { ZipArchiveEntry entry = archive.CreateEntry(item.Key, CompressionLevel.Optimal);using (Stream output = entry.Open()) output.Write(item.Value, 0, item.Value.Length); }
            }
            return memory.ToArray();
        }
    }

    private static string Database(string email)
    {
        var system = new Dictionary<string, object> { { "id", "system-1" }, { "name", "Test System" }, { "type", "Administrative" }, { "organization", "GOV" }, { "archived", false } };
        var user = new Dictionary<string, object> { { "id", "user-1" }, { "systemId", "system-1" }, { "organization", "GOV" }, { "last", "Shaw" }, { "first", "Vivian" }, { "middle", "" }, { "email", email }, { "disabled", false }, { "roles", new object[] { "General" } }, { "privilegedUsernames", new object[0] }, { "privilegedTypes", new object[0] }, { "artifacts", new object[0] }, { "changes", new object[0] } };
        return Json.Serialize(new Dictionary<string, object> { { "version", 2 }, { "updated", DateTime.UtcNow.ToString("o") }, { "systems", new object[] { system } }, { "users", new object[] { user } } });
    }

    private static void RunStorageEnumerationFuzz(string parent)
    {
        string fuzzRoot = Path.Combine(parent, "Storage Fuzz (Mapped), Unicode-\u00e9");
        Directory.CreateDirectory(fuzzRoot);
        string[] organizations = { "GDMS", "NGC", "LM", "GOV", "Boeing", "Org With Spaces", "Org_(Mixed)", "Org-\u00e9" };
        string[] separators = { "_", "__", " ", "   ", ", " };
        var random = new Random(0x53a91f27);
        const int total = 800;
        for (int index = 0; index < total; index++)
        {
            string organization = organizations[index % organizations.Length];
            string directory = Path.Combine(fuzzRoot, organization, "Layer " + (index % 4).ToString(), "Batch_" + (index % 31).ToString("00"));
            Directory.CreateDirectory(directory);
            string separator = separators[index % separators.Length];
            string stem = "Last" + index.ToString("0000") + separator + "First" + index.ToString("0000") + separator + "(" + organization + ")" + separator + (index % 2 == 0 ? "DoD Cyber Cert" : "GEN User Agreement") + separator + "26AUG2026";
            switch (index % 4)
            {
                case 0:
                    File.WriteAllBytes(Path.Combine(directory, stem + ".pdf"), PdfBytes());
                    break;
                case 1:
                    File.WriteAllBytes(Path.Combine(directory, stem + ".pdf.zip"), EvidenceZip(stem + ".pdf", PdfBytes()));
                    break;
                case 2:
                    var invalid = new byte[32 + random.Next(224)];random.NextBytes(invalid);
                    File.WriteAllBytes(Path.Combine(directory, stem + ".pdf"), invalid);
                    break;
                default:
                    File.WriteAllText(Path.Combine(directory, stem + ".txt"), "Not evidence", Encoding.UTF8);
                    break;
            }
        }

        string cache = Path.Combine(parent, "storage-fuzz-mappings.json");
        using (var fuzzStorage = new PortableStorage("DOMAIN\\fuzz-operator", cache))
        {
            fuzzStorage.Map("fuzz-system", fuzzRoot);
            object[] nativeItems;
            try
            {
                PortableStorage.ForceNativeEnumerationForTests = true;
                nativeItems = (object[])Json.DeserializeObject(fuzzStorage.Scan("fuzz-system", "fuzz-rules", true));
            }
            finally { PortableStorage.ForceNativeEnumerationForTests = false; }
            Assert(nativeItems.Length == total, "Native enumeration fuzz should return every generated file exactly once.");
            Assert(nativeItems.Cast<Dictionary<string, object>>().Count(item => Convert.ToBoolean(item["accepted"])) == total / 2, "Native enumeration fuzz should accept only the valid PDF and PDF-in-ZIP cases.");

            object[] incrementalItems = (object[])Json.DeserializeObject(fuzzStorage.Scan("fuzz-system", "fuzz-rules", false));
            Assert(incrementalItems.Length == total, "Incremental managed enumeration should return the same complete fuzz corpus.");
            Assert(incrementalItems.Cast<Dictionary<string, object>>().Count(item => Convert.ToBoolean(item["unchanged"])) == total * 3 / 4, "Incremental Sync should reuse validation for every unchanged PDF or ZIP while leaving irrelevant extensions uncached.");

            object[] repeatedNativeItems;
            try
            {
                PortableStorage.ForceNativeEnumerationForTests = true;
                repeatedNativeItems = (object[])Json.DeserializeObject(fuzzStorage.Scan("fuzz-system", "fuzz-rules", false));
            }
            finally { PortableStorage.ForceNativeEnumerationForTests = false; }
            Assert(repeatedNativeItems.Length == total && repeatedNativeItems.Cast<Dictionary<string, object>>().Count(item => Convert.ToBoolean(item["accepted"])) == total / 2, "Repeated native enumeration should remain deterministic after the shared Sync index exists.");

            object[] shellItems;
            try
            {
                PortableStorage.ForceShellEnumerationForTests = true;
                shellItems = (object[])Json.DeserializeObject(fuzzStorage.Scan("fuzz-system", "fuzz-rules", false));
            }
            finally { PortableStorage.ForceShellEnumerationForTests = false; }
            Assert(shellItems.Length == total, "Windows Explorer namespace enumeration should return every generated file exactly once; returned " + shellItems.Length.ToString() + " of " + total.ToString() + ".");
            Assert(shellItems.Cast<Dictionary<string, object>>().Count(item => Convert.ToBoolean(item["accepted"])) == total / 2, "Windows Explorer namespace enumeration should preserve evidence validation results.");
            Assert(shellItems.Cast<Dictionary<string, object>>().All(item => Convert.ToString(item["path"]).IndexOf("..", StringComparison.Ordinal) < 0), "Windows Explorer namespace enumeration must not return paths outside the mapped root.");
        }
    }

    public static int Main(string[] args)
    {
        if (args.Length != 1) throw new ArgumentException("A test directory is required.");
        MethodInfo optionalQueryValue = typeof(TrackerContext).GetMethod("OptionalQueryValue", BindingFlags.NonPublic | BindingFlags.Static);
        Assert(optionalQueryValue != null, "The launcher must expose its optional archive request-value parser.");
        Assert(Convert.ToString(optionalQueryValue.Invoke(null, new object[] { "/api/storage/system/archive?path=file.pdf&filename=", "filename" })) == "", "An explicitly empty optional archive filename should use the source filename.");
        Assert(optionalQueryValue.Invoke(null, new object[] { "/api/storage/system/archive?path=file.pdf", "filename" }) == null, "A missing optional archive filename must not reject an otherwise valid archive request.");
        string root = Path.GetFullPath(args[0]);
        Directory.CreateDirectory(root);
        RunStorageEnumerationFuzz(Path.GetDirectoryName(root));
        string compatibilityRoot = Path.Combine(root, "write-compatibility"), compatibilityCache = Path.Combine(root, "write-compatibility-mappings.json");
        Directory.CreateDirectory(compatibilityRoot);
        using (var compatibilityStorage = new PortableStorage("DOMAIN\\compatibility-operator", compatibilityCache))
        {
            compatibilityStorage.Map("compatibility-key", compatibilityRoot);
            Assert(compatibilityStorage.AcquireLease("compatibility-key", "compatibility-session"), "A filesystem that rejects write-through options should still acquire an exclusive lease using compatible buffered I/O.");
            compatibilityStorage.SaveManifest("compatibility-key", Database("compatibility@example.mil"));
            compatibilityStorage.SaveCsv("compatibility-key", Encoding.UTF8.GetBytes("header\nvalue"));
            compatibilityStorage.AppendAudit("compatibility-key", "COMPATIBILITY WRITE TEST");
            compatibilityStorage.ReleaseLease("compatibility-key", "compatibility-session");
        }
        Assert(File.Exists(Path.Combine(compatibilityRoot, "information-system-user-tracker.json")) && File.Exists(Path.Combine(compatibilityRoot, "System", "backup", "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".csv")) && Directory.EnumerateFiles(Path.Combine(compatibilityRoot, "System", "Audit Logs"), "audit-*.jsonl").Any(), "Compatible buffered I/O should preserve manifest, backup, and audit writes beneath the System support folder.");
        string legacyCache = Path.Combine(root, "legacy-folder-mappings.json");
        File.WriteAllText(legacyCache, "{\"version\":1,\"lastSystemId\":\"legacy\",\"mappings\":[{\"systemId\":\"legacy\",\"path\":\"" + compatibilityRoot.Replace("\\", "\\\\") + "\"}]}", Encoding.UTF8);
        using (var legacyStorage = new PortableStorage("DOMAIN\\operator", legacyCache)) Assert(!legacyStorage.CachedMappings().Contains("legacy"), "Version-1 development mapping caches should be ignored so a clean update cannot restore stale test systems.");
        string mappingCache = Path.Combine(root, "local-folder-mappings.json");
        string legacyAuditDirectory = Path.Combine(root, "Audit Logs");Directory.CreateDirectory(legacyAuditDirectory);File.WriteAllText(Path.Combine(legacyAuditDirectory, "audit-2020-01-01.txt"), "legacy audit record", Encoding.UTF8);
        var storage = new PortableStorage("DOMAIN\\operator", mappingCache);
        storage.Map("mapping-key", root);
        Assert(Directory.Exists(Path.Combine(root, "Organizations")), "Mapping should create the top-level Organizations folder.");
        Assert(storage.CreateOrganization("mapping-key", "GOV").Contains("\"organization\":\"GOV\"") && storage.ListOrganizations("mapping-key").Contains("GOV"), "The launcher should create and list organization folders beneath Organizations.");
        bool rejectedReservedOrganization = false;try { storage.CreateOrganization("mapping-key", "SAAR"); } catch (InvalidDataException) { rejectedReservedOrganization = true; }
        Assert(rejectedReservedOrganization && !Directory.Exists(Path.Combine(root, "Organizations", "SAAR")), "Document-type folders must not be accepted as organizations.");
        bool rejectedDeviceOrganization = false;try { storage.CreateOrganization("mapping-key", "CON"); } catch (InvalidDataException) { rejectedDeviceOrganization = true; }
        Assert(rejectedDeviceOrganization, "Reserved Windows device names must not be accepted as organizations.");
        Assert(!Directory.Exists(legacyAuditDirectory) && File.Exists(Path.Combine(root, "System", "Audit Logs", "audit-2020-01-01.txt")), "Mapping should migrate legacy support folders beneath the top-level System folder without losing their contents.");
        Assert(!Directory.EnumerateFiles(root, ".isut-map-probe-*", SearchOption.TopDirectoryOnly).Any(), "A successful mapping compatibility probe should remove its temporary file.");
        var competingStorage = new PortableStorage("DOMAIN\\second-operator", mappingCache);
        competingStorage.Map("mapping-key", root);

        storage.SaveManifest("mapping-key", Database("first@example.mil"));
        string manifestPathForLockTest = Path.Combine(root, "information-system-user-tracker.json");
        var manifestBlocker = new FileStream(manifestPathForLockTest, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        var releaseManifestBlocker = new Thread(new ThreadStart(delegate { Thread.Sleep(100); manifestBlocker.Dispose(); }));
        releaseManifestBlocker.Start();
        storage.SaveManifest("mapping-key", Database("first@example.mil"));
        releaseManifestBlocker.Join();
        Assert(File.ReadAllText(manifestPathForLockTest, Encoding.UTF8).Contains("first@example.mil") && !Directory.EnumerateFiles(root, ".isut-*", SearchOption.TopDirectoryOnly).Any(), "A brief SMB-style replacement lock should be retried without changing or stranding the manifest.");
        string cachedFile = File.ReadAllText(mappingCache, Encoding.UTF8);
        Assert(cachedFile.Contains("\"version\":2") && cachedFile.Contains("mapping-key") && cachedFile.Contains(root.Replace("\\", "\\\\")) && !cachedFile.Contains("first@example.mil"), "The local cache should contain only current-version mapping metadata, not operational user records.");
        var restoredStorage = new PortableStorage("DOMAIN\\operator", mappingCache);
        string restoredMappings = restoredStorage.CachedMappings();
        Assert(restoredMappings.Contains("\"storageId\":\"mapping-key\"") && restoredMappings.Contains("\"systemId\":\"system-1\"") && restoredMappings.Contains("first@example.mil"), "A new launcher should reload the current manifest through its cached folder mapping.");
        restoredStorage.Dispose();
        storage.SaveCsv("mapping-key", Encoding.UTF8.GetBytes("header\nvalue"));
        string firstList = storage.ListBackups("mapping-key", "system-1");
        object[] firstItems = (object[])Json.DeserializeObject(firstList);
        Assert(firstItems.Length == 1, "The first database save should create one snapshot.");
        string firstFilename = Convert.ToString(((Dictionary<string, object>)firstItems[0])["filename"]);
        Assert(Convert.ToBoolean(((Dictionary<string, object>)firstItems[0])["valid"]), "The first snapshot should verify.");
        string drill = storage.RestoreDrill("mapping-key", "system-1", firstFilename);
        Assert(drill.Contains("\"healthy\":true") && drill.Contains("\"nonDestructive\":true") && drill.Contains("\"userCount\":1") && File.ReadAllText(manifestPathForLockTest, Encoding.UTF8).Contains("first@example.mil"), "The restore drill should verify and reconstruct a snapshot without changing the live manifest.");
        byte[] queueBytes = Encoding.UTF8.GetBytes("{\"version\":1,\"items\":[]}");
        storage.SaveRenamerQueue("mapping-key", queueBytes);
        Assert(storage.ReadRenamerQueue("mapping-key").Contains("\"version\":1") && !storage.Scan("mapping-key").Contains("tracker-document-renamer-queue.json"), "The resumable renamer queue should round-trip and remain excluded from evidence scans.");
        storage.ClearRenamerQueue("mapping-key");
        Assert(storage.ReadRenamerQueue("mapping-key") == "null", "Clearing the resumable renamer queue should be idempotent.");

        storage.SaveManifest("mapping-key", Database("second@example.mil"));
        object[] secondItems = (object[])Json.DeserializeObject(storage.ListBackups("mapping-key", "system-1"));
        Assert(secondItems.Length == 2, "A distinct database state should create a second snapshot.");
        string restored = storage.Restore("mapping-key", "system-1", firstFilename);
        Assert(restored.Contains("first@example.mil") && !restored.Contains("second@example.mil"), "Restore should replace the manifest with the selected snapshot.");

        string evidence = storage.StoreEvidence("mapping-key", "GOV", "Shaw", "Vivian", "Shaw_Vivian_SAAR_24AUG2026.pdf.zip", EvidenceZip("Shaw_Vivian_SAAR_24AUG2026.pdf", PdfBytes()));
        Assert(evidence.EndsWith(".zip", StringComparison.OrdinalIgnoreCase), "Evidence should retain a ZIP filename.");
        File.WriteAllText(Path.Combine(root, "operator-notes.txt"), "This non-evidence file must not require metadata validation.", Encoding.UTF8);
        string scan = storage.Scan("mapping-key", "rules-1", false);
        Assert(scan.Contains("Shaw_Vivian_SAAR_24AUG2026.pdf.zip") && scan.Contains("\"accepted\":true") && scan.Contains("\"unchanged\":false"), "The first directory scan should validate launcher-stored PDF evidence.");
        Dictionary<string, object> ignoredNonEvidence = ((object[])Json.DeserializeObject(scan)).Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "operator-notes.txt");
        Assert(Convert.ToInt64(ignoredNonEvidence["size"]) == 0 && !Convert.ToBoolean(ignoredNonEvidence["accepted"]), "Sync should classify irrelevant extensions without requesting provider metadata for them.");
        try
        {
            PortableStorage.ForceNativeEnumerationForTests = true;
            object[] nativeScanItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", true));
            Assert(nativeScanItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip" && Convert.ToBoolean(item["accepted"])), "The native Windows fallback should enumerate and validate evidence files.");
            Assert(nativeScanItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["name"]) == "operator-notes.txt" && !Convert.ToBoolean(item["accepted"])), "The native Windows fallback should enumerate non-evidence files for review without accepting them.");
        }
        finally { PortableStorage.ForceNativeEnumerationForTests = false; }
        Assert(File.Exists(Path.Combine(root, "tracker-sync-index.json")) && File.Exists(Path.Combine(root, "tracker-sync-index.json.sha256")), "A successful scan should store a checksum-protected shared Sync index.");
        object[] cachedScanItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", false));
        Dictionary<string, object> cachedEvidenceItem = cachedScanItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
        Assert(Convert.ToBoolean(cachedEvidenceItem["unchanged"]), "A later scan should skip unchanged evidence content validation.");
        string evidencePath = Path.Combine(root, "Organizations", "GOV", "Shaw_Vivian", evidence);File.SetLastWriteTimeUtc(evidencePath, File.GetLastWriteTimeUtc(evidencePath).AddSeconds(2));
        object[] changedScanItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", false));
        Dictionary<string, object> changedEvidenceItem = changedScanItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
        Assert(!Convert.ToBoolean(changedEvidenceItem["unchanged"]), "A changed modification timestamp should force evidence revalidation.");
        var crossComputerStorage = new PortableStorage("DOMAIN\\other-computer", mappingCache);crossComputerStorage.Map("mapping-key", root);
        object[] crossComputerItems = (object[])Json.DeserializeObject(crossComputerStorage.Scan("mapping-key", "rules-1", false));
        Dictionary<string, object> crossComputerEvidence = crossComputerItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
        Assert(Convert.ToBoolean(crossComputerEvidence["unchanged"]), "The shared Sync index should accelerate a different Windows launcher using the same mapped folder.");crossComputerStorage.Dispose();
        using (var evidenceBlocker = new FileStream(evidencePath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            Dictionary<string, object> cachedWhileLocked = ((object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", false))).Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
            Assert(Convert.ToBoolean(cachedWhileLocked["accepted"]) && Convert.ToBoolean(cachedWhileLocked["unchanged"]), "An unchanged cached file should not be reopened during incremental Sync.");
            Dictionary<string, object> forcedWhileLocked = ((object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", true))).Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
            Assert(!Convert.ToBoolean(forcedWhileLocked["accepted"]) && !Convert.ToBoolean(forcedWhileLocked["unchanged"]), "Full Rescan should reopen evidence and report a transient exclusive file lock.");
        }
        Dictionary<string, object> recoveredAfterLock = ((object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", false))).Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
        Assert(Convert.ToBoolean(recoveredAfterLock["accepted"]) && !Convert.ToBoolean(recoveredAfterLock["unchanged"]), "A transient read failure must not be cached after the file becomes available.");
        object[] fullScanItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", true));
        Assert(!Convert.ToBoolean(fullScanItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip")["unchanged"]), "Full Rescan should ignore the shared Sync index.");
        object[] changedRuleItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-2", false));
        Assert(!Convert.ToBoolean(changedRuleItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip")["unchanged"]), "A rule-set change should invalidate the shared Sync index.");
        File.WriteAllText(Path.Combine(root, "tracker-sync-index.json.sha256"), new string('0', 64) + "  tracker-sync-index.json\n", Encoding.ASCII);
        object[] damagedIndexItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-2", false));
        Assert(!Convert.ToBoolean(damagedIndexItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip")["unchanged"]), "A damaged Sync-index checksum should fall back to full validation.");
        Assert(!cachedScanItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["name"]).StartsWith("tracker-sync-index.json", StringComparison.OrdinalIgnoreCase)), "Sync index files must be excluded from evidence results.");
        string alternateDateEvidence = storage.StoreEvidence("mapping-key", "GOV", "Shaw", "Vivian", "Shaw_Vivian_GEN_User_Agreement_20260826.pdf.zip", EvidenceZip("Shaw_Vivian_GEN_User_Agreement_20260826.pdf", PdfBytes()));
        string alternateDateRelative = Path.Combine("Organizations", "GOV", "Shaw_Vivian", alternateDateEvidence), alternateDatePath = Path.Combine(root, alternateDateRelative), normalizedDateName = "Shaw_Vivian_(GOV)_GEN_User_Agreement_26AUG2026.pdf.zip";byte[] alternateDateBytes = File.ReadAllBytes(alternateDatePath);
        var normalizedDateResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.NormalizeEvidenceFilename("mapping-key", alternateDateRelative, normalizedDateName));
        string normalizedDatePath = Path.Combine(root, "Organizations", "GOV", "Shaw_Vivian", normalizedDateName);
        Assert(!File.Exists(alternateDatePath) && File.Exists(normalizedDatePath) && alternateDateBytes.SequenceEqual(File.ReadAllBytes(normalizedDatePath)) && Convert.ToString(normalizedDateResponse["renamed"]).EndsWith(normalizedDateName), "Filename normalization should apply the folder organization and standard date without changing any file bytes.");
        File.WriteAllBytes(alternateDatePath, alternateDateBytes);
        var collisionResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.NormalizeEvidenceFilename("mapping-key", alternateDateRelative, normalizedDateName));
        Assert(Convert.ToBoolean(collisionResponse["collision"]) && File.Exists(alternateDatePath) && File.Exists(normalizedDatePath), "A normalization collision should preserve both files and return it for duplicate review instead of aborting Sync.");
        string conflictArchiveName = "Shaw_Vivian_(GOV)_GEN_User_Agreement_26AUG2026_CONFLICT_ABCDEF12.pdf.zip", conflictArchiveResult = storage.ArchiveEvidence("mapping-key", alternateDateRelative, conflictArchiveName), conflictArchiveRelative = Convert.ToString(((Dictionary<string, object>)Json.DeserializeObject(conflictArchiveResult))["archived"]);
        Assert(conflictArchiveRelative.EndsWith(conflictArchiveName, StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(root, conflictArchiveRelative.Replace('/', Path.DirectorySeparatorChar))), "A non-authoritative same-name conflict should retain its traceable hash identifier in the organization Archive.");
        bool rejectedArchiveExtension = false;
        try { storage.ArchiveEvidence("mapping-key", Path.Combine("Organizations", "GOV", "Shaw_Vivian", normalizedDateName), "unsafe-conflict.exe"); } catch (InvalidDataException) { rejectedArchiveExtension = true; }
        Assert(rejectedArchiveExtension && File.Exists(normalizedDatePath), "A requested collision archive name must preserve the PDF or ZIP evidence extension and leave the source unchanged when rejected.");
        bool rejectedUnsafeRename = false;
        try { storage.NormalizeEvidenceFilename("mapping-key", Path.Combine("Organizations", "GOV", "Shaw_Vivian", normalizedDateName), "..\\escape.zip"); } catch (InvalidDataException) { rejectedUnsafeRename = true; }
        Assert(rejectedUnsafeRename, "Date normalization should reject an unsafe target filename.");
        string olderEvidence = storage.StoreEvidence("mapping-key", "GOV", "Shaw", "Vivian", "Shaw_Vivian_SAAR_24AUG2025.pdf.zip", EvidenceZip("Shaw_Vivian_SAAR_24AUG2025.pdf", PdfBytes()));
        string olderRelative = Path.Combine("Organizations", "GOV", "Shaw_Vivian", olderEvidence), archiveResult = storage.ArchiveEvidence("mapping-key", olderRelative);
        var archiveResponse = (Dictionary<string, object>)Json.DeserializeObject(archiveResult);
        string archivedRelative = Convert.ToString(archiveResponse["archived"]), archivedPath = Path.Combine(root, archivedRelative.Replace('/', Path.DirectorySeparatorChar));
        Assert(!File.Exists(Path.Combine(root, olderRelative)) && File.Exists(archivedPath) && archivedRelative.StartsWith("Organizations/GOV/GOV SAAR Archive/", StringComparison.OrdinalIgnoreCase), "Approved SAAR cleanup should move the access-request record into the permanent organization SAAR Archive without deleting it.");
        Assert(storage.Scan("mapping-key").Contains("Shaw_Vivian_SAAR_24AUG2025.pdf.zip"), "Permanent organization SAAR Archive records should remain visible to later account-status Sync scans.");
        string nestedOrganizationDirectory = Path.Combine(root, "GDMS", "General", "Brown_Jacob");
        Directory.CreateDirectory(nestedOrganizationDirectory);
        string nestedArchiveName = "Brown_Jacob_(GDMS)_GEN_User_Agreement_24AUG2025.pdf.zip", nestedArchivePath = Path.Combine(nestedOrganizationDirectory, nestedArchiveName);
        File.WriteAllBytes(nestedArchivePath, EvidenceZip("Brown_Jacob_(GDMS)_GEN_User_Agreement_24AUG2025.pdf", PdfBytes()));
        var nestedArchiveResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.ArchiveEvidence("mapping-key", Path.Combine("GDMS", "General", "Brown_Jacob", nestedArchiveName)));
        string nestedArchivedRelative = Convert.ToString(nestedArchiveResponse["archived"]);
        Assert(nestedArchivedRelative.StartsWith("GDMS/GDMS Archive/", StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(root, nestedArchivedRelative.Replace('/', Path.DirectorySeparatorChar))), "A nested organization should receive its own organization-named Archive folder.");
        string retainedEvidenceName = "Brown_Jacob_(GDMS)_PRIV_Training_Cert_24AUG2019.pdf.zip", retainedEvidencePath = Path.Combine(nestedOrganizationDirectory, retainedEvidenceName);
        File.WriteAllBytes(retainedEvidencePath, EvidenceZip("Brown_Jacob_(GDMS)_PRIV_Training_Cert_24AUG2019.pdf", PdfBytes()));
        var retainedArchiveResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.ArchiveEvidence("mapping-key", Path.Combine("GDMS", "General", "Brown_Jacob", retainedEvidenceName)));
        string retainedArchivedRelative = Convert.ToString(retainedArchiveResponse["archived"]);
        Assert(retainedArchivedRelative.StartsWith("GDMS/GDMS Archive/Superseded/", StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(root, retainedArchivedRelative.Replace('/', Path.DirectorySeparatorChar))), "Archived training evidence older than five years should be retained in the organization's Superseded folder.");
        string looseRelative = Path.Combine("Organizations", "GOV", "Shaw_Vivian", "Shaw_Vivian_GEN_User_Agreement_24AUG2026.pdf"), loosePath = Path.Combine(root, looseRelative);
        File.WriteAllBytes(loosePath, PdfBytes());
        var compressionResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.CompressEvidence("mapping-key", looseRelative));
        string compressedRelative = Convert.ToString(compressionResponse["compressed"]), compressedPath = Path.Combine(root, compressedRelative.Replace('/', Path.DirectorySeparatorChar));
        Assert(!File.Exists(loosePath) && File.Exists(compressedPath), "Validated compression should create the ZIP before deleting its source PDF.");
        string repeatedCompression = storage.CompressEvidence("mapping-key", looseRelative);
        Assert(repeatedCompression.Contains("\"alreadyCompleted\":true") && repeatedCompression.Contains("Shaw_Vivian_GEN_User_Agreement_24AUG2026.pdf.zip"), "A repeated cleanup request should recognize the validated ZIP instead of reporting its removed PDF as missing.");
        using (var compressedStream = File.OpenRead(compressedPath))
        using (var compressedArchive = new ZipArchive(compressedStream, ZipArchiveMode.Read))
            Assert(compressedArchive.Entries.Count == 1 && compressedArchive.Entries[0].FullName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase), "Cleanup compression should create a ZIP containing exactly one PDF.");
        Assert(storage.Scan("mapping-key").Contains("Shaw_Vivian_GEN_User_Agreement_24AUG2026.pdf.zip"), "The compressed evidence should remain available to later Sync scans.");
        string exactCoexistRelative = Path.Combine("GOV", "Exact_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf"), exactCoexistPath = Path.Combine(root, exactCoexistRelative), exactZipPath = exactCoexistPath + ".zip";
        Directory.CreateDirectory(Path.GetDirectoryName(exactCoexistPath));File.WriteAllBytes(exactCoexistPath, PdfBytes());File.WriteAllBytes(exactZipPath, EvidenceZip(Path.GetFileName(exactCoexistPath), PdfBytes()));
        string exactCoexistResult = storage.CompressEvidence("mapping-key", exactCoexistRelative);
        Assert(exactCoexistResult.Contains("\"alreadyCompleted\":true") && !File.Exists(exactCoexistPath) && File.Exists(exactZipPath), "A matching loose PDF and existing ZIP should complete idempotently by retaining the validated ZIP and removing only the redundant PDF.");
        string conflictRelative = Path.Combine("GOV", "Conflict_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf"), conflictPath = Path.Combine(root, conflictRelative), conflictZipPath = conflictPath + ".zip";
        byte[] alternatePdf = Encoding.ASCII.GetBytes("%PDF-1.4\n% alternate evidence\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");File.WriteAllBytes(conflictPath, PdfBytes());File.WriteAllBytes(conflictZipPath, EvidenceZip(Path.GetFileName(conflictPath), alternatePdf));bool compressionCollisionObserved = false;
        try { storage.CompressEvidence("mapping-key", conflictRelative); } catch (IOException error) { compressionCollisionObserved = error.Message.Contains("collision review"); }
        Assert(compressionCollisionObserved && File.Exists(conflictPath) && File.Exists(conflictZipPath), "Different PDFs sharing one compression destination must both remain intact for collision review.");
        string longCompressionDirectory = Path.Combine(root, "Long Path Compression");
        Directory.CreateDirectory(longCompressionDirectory);
        string longCompressionPrefix = "Shaw_Vivian_GEN_User_Agreement_", longCompressionSuffix = "_24AUG2026.pdf";
        int longCompressionFill = Math.Max(1, 235 - longCompressionDirectory.Length - 1 - longCompressionPrefix.Length - longCompressionSuffix.Length);
        string longCompressionName = longCompressionPrefix + new string('X', longCompressionFill) + longCompressionSuffix, longCompressionPath = Path.Combine(longCompressionDirectory, longCompressionName), longCompressionRelative = Path.Combine("Long Path Compression", longCompressionName);
        Assert(longCompressionPath.Length >= 230 && longCompressionPath.Length < 248, "The long-path compression regression fixture should approach the legacy Windows limit without exceeding the source-file limit.");
        File.WriteAllBytes(longCompressionPath, PdfBytes());
        var longCompressionResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.CompressEvidence("mapping-key", longCompressionRelative));
        string longCompressedRelative = Convert.ToString(longCompressionResponse["compressed"]), longCompressedPath = Path.Combine(root, longCompressedRelative.Replace('/', Path.DirectorySeparatorChar));
        Assert(!File.Exists(longCompressionPath) && File.Exists(longCompressedPath), "Compression should use a short temporary name instead of exceeding the Windows path limit.");

        string longEvidenceDirectory = Path.Combine(root, "Organizations", "GOV", "Shaw_Vivian"), longEvidencePrefix = "Shaw_Vivian_GEN_User_Agreement_", longEvidenceSuffix = "_24AUG2026.pdf.zip";
        int longEvidenceFill = Math.Max(1, 235 - longEvidenceDirectory.Length - 1 - longEvidencePrefix.Length - longEvidenceSuffix.Length);
        string longEvidenceName = longEvidencePrefix + new string('Y', longEvidenceFill) + longEvidenceSuffix, longEvidencePdfName = longEvidenceName.Substring(0, longEvidenceName.Length - 4);
        string storedLongEvidence = storage.StoreEvidence("mapping-key", "GOV", "Shaw", "Vivian", longEvidenceName, EvidenceZip(longEvidencePdfName, PdfBytes())), storedLongEvidencePath = Path.Combine(longEvidenceDirectory, storedLongEvidence);
        Assert(storedLongEvidencePath.Length >= 230 && File.Exists(storedLongEvidencePath), "Atomic evidence storage should use short temporary and rollback names near the Windows path limit.");
        File.WriteAllText(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.txt"), "not evidence");
        File.WriteAllBytes(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf"), Encoding.ASCII.GetBytes("not a pdf"));
        scan = storage.Scan("mapping-key");
        object[] scannedItems = (object[])Json.DeserializeObject(scan);
        Dictionary<string, object> textItem = scannedItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_DOD_Cyber_24AUG2026.txt");
        Dictionary<string, object> fakePdfItem = scannedItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf");
        Assert(!Convert.ToBoolean(textItem["accepted"]) && Convert.ToString(textItem["error"]).Contains("Only PDF evidence"), "Directory scan should reject non-PDF evidence.");
        Assert(!Convert.ToBoolean(fakePdfItem["accepted"]), "Directory scan should reject a renamed non-PDF file.");
        string correctionRelative = "Shaw_Vivian_GEN_SAAR_24AUG2026.pdf", correctionPath = Path.Combine(root, correctionRelative);
        File.WriteAllBytes(correctionPath, Encoding.ASCII.GetBytes("correction required"));
        var reworkResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.MoveEvidenceToRework("mapping-key", correctionRelative));
        string reworkedRelative = Convert.ToString(reworkResponse["reworked"]), reworkedPath = Path.Combine(root, reworkedRelative.Replace('/', Path.DirectorySeparatorChar));
        string rootOrganization = new DirectoryInfo(root).Name;
        Assert(!File.Exists(correctionPath) && File.Exists(reworkedPath) && reworkedRelative.StartsWith(rootOrganization + " Rework/", StringComparison.OrdinalIgnoreCase), "A correction PDF at the organization root should move into that organization's named Rework folder even when its PDF bytes are invalid.");
        Assert(!storage.Scan("mapping-key").Contains("Shaw_Vivian_GEN_SAAR_24AUG2026.pdf"), "Rework files should be excluded from later Sync scans.");
        string nestedReworkDirectory = Path.Combine(root, "NGC", "Privileged", "Miller_Ava");
        Directory.CreateDirectory(nestedReworkDirectory);
        string nestedReworkName = "Miller_Ava_(NGC)_GEN_SAAR_24AUG2026.pdf", nestedReworkPath = Path.Combine(nestedReworkDirectory, nestedReworkName);
        File.WriteAllBytes(nestedReworkPath, Encoding.ASCII.GetBytes("correction required"));
        var nestedReworkResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.MoveEvidenceToRework("mapping-key", Path.Combine("NGC", "Privileged", "Miller_Ava", nestedReworkName)));
        string nestedReworkedRelative = Convert.ToString(nestedReworkResponse["reworked"]);
        Assert(nestedReworkedRelative.StartsWith("NGC/NGC Rework/", StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(root, nestedReworkedRelative.Replace('/', Path.DirectorySeparatorChar))), "A nested organization should receive its own organization-named Rework folder.");
        string invalidZipName = "Miller Ava (NGC) GEN SAAR 20260826.zip", invalidZipRelative = Path.Combine("NGC", "Privileged", "Miller_Ava", invalidZipName), invalidZipPath = Path.Combine(root, invalidZipRelative), embeddedPdfName = "Miller_Ava_(NGC)_GEN_SAAR_20260826.pdf";
        File.WriteAllBytes(invalidZipPath, EvidenceZip(embeddedPdfName, PdfBytes()));
        var extractedReworkResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.MoveEvidenceToRework("mapping-key", invalidZipRelative));
        string extractedReworkRelative = Convert.ToString(extractedReworkResponse["reworked"]), extractedReworkPath = Path.Combine(root, extractedReworkRelative.Replace('/', Path.DirectorySeparatorChar));
        Assert(Convert.ToBoolean(extractedReworkResponse["extracted"]) && !File.Exists(invalidZipPath) && File.Exists(extractedReworkPath) && extractedReworkPath.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase), "An invalidly named one-PDF ZIP should be extracted to a loose PDF in the organization Rework folder and removed only after verification.");
        Assert(File.ReadAllBytes(extractedReworkPath).SequenceEqual(PdfBytes()), "The Rework extraction must preserve the embedded PDF bytes exactly.");
        string interruptedZipName = "Miller Ava (NGC) User Agreement 20260827.zip", interruptedZipRelative = Path.Combine("NGC", "Privileged", "Miller_Ava", interruptedZipName), interruptedZipPath = Path.Combine(root, interruptedZipRelative), interruptedPdfName = "Miller_Ava_(NGC)_User_Agreement_20260827.pdf", interruptedPdfPath = Path.Combine(root, "NGC", "NGC Rework", interruptedPdfName);File.WriteAllBytes(interruptedZipPath, EvidenceZip(interruptedPdfName, PdfBytes()));bool reworkInterruptionObserved = false;
        try { PortableStorage.FailAfterStageForTests = "rework-extract-move";storage.MoveEvidenceToRework("mapping-key", interruptedZipRelative); } catch (IOException) { reworkInterruptionObserved = true; } finally { PortableStorage.FailAfterStageForTests = null; }
        Assert(reworkInterruptionObserved && File.Exists(interruptedZipPath) && File.Exists(interruptedPdfPath), "An interrupted ZIP extraction should retain the source while preserving the verified destination for transaction recovery.");
        storage.Scan("mapping-key");
        Assert(!File.Exists(interruptedZipPath) && File.Exists(interruptedPdfPath) && File.ReadAllBytes(interruptedPdfPath).SequenceEqual(PdfBytes()), "Transaction recovery should verify the extracted PDF before removing the interrupted source ZIP.");
        string reworkDirectory = Path.Combine(root, "NGC", "NGC Rework"), archiveDate = DateTime.UtcNow.Date.AddYears(-2).AddDays(-1).ToString("ddMMMyyyy", CultureInfo.InvariantCulture).ToUpperInvariant(), supersededDate = DateTime.UtcNow.Date.AddYears(-6).ToString("ddMMMyyyy", CultureInfo.InvariantCulture).ToUpperInvariant(), currentDate = DateTime.UtcNow.Date.AddMonths(-6).ToString("ddMMMyyyy", CultureInfo.InvariantCulture).ToUpperInvariant(), oldSaarDate = DateTime.UtcNow.Date.AddYears(-8).ToString("ddMMMyyyy", CultureInfo.InvariantCulture).ToUpperInvariant();
        string oldReworkName = "Miller_Ava_(WRONG)_DoD_Cyber_Cert_" + archiveDate + ".pdf", supersededReworkName = "Miller_Ava_(WRONG)_User_Agreement_" + supersededDate + ".pdf.zip", currentReworkName = "Miller_Ava_(WRONG)_DoD_Cyber_Cert_" + currentDate + ".pdf", oldSaarReworkName = "Miller_Ava_(WRONG)_PRIV_DTA_SAAR_" + oldSaarDate + ".pdf", oldYearOnlyName = "Miller_Ava_(WRONG)_DoD_Cyber_Cert_" + DateTime.UtcNow.Date.AddYears(-2).Year.ToString(CultureInfo.InvariantCulture) + ".pdf", currentYearOnlyName = "Miller_Ava_(WRONG)_DoD_Cyber_Cert_" + DateTime.UtcNow.Date.AddYears(-1).Year.ToString(CultureInfo.InvariantCulture) + ".pdf", disabledSaarName = "Miller_Ava_(NGC)_GEN_SAAR_DISABLED_" + currentDate + ".pdf", activeExpiredName = "Miller_Ava_(NGC)_User_Agreement_" + archiveDate + ".pdf", misplacedDate = DateTime.UtcNow.Date.AddYears(-4).ToString("ddMMMyyyy", CultureInfo.InvariantCulture).ToUpperInvariant(), misplacedAgreementName = "Miller_Ava_(NGC)_User_Agreement_" + misplacedDate + ".pdf", misplacedDisabledSaarName = "Miller_Ava_(NGC)_GEN_SAAR_DISABLED_" + oldSaarDate + ".pdf";
        File.WriteAllBytes(Path.Combine(reworkDirectory, oldReworkName), Encoding.ASCII.GetBytes("old filename correction"));
        File.WriteAllBytes(Path.Combine(reworkDirectory, supersededReworkName), Encoding.ASCII.GetBytes("retained old record"));
        File.WriteAllBytes(Path.Combine(reworkDirectory, currentReworkName), Encoding.ASCII.GetBytes("current correction"));
        File.WriteAllBytes(Path.Combine(reworkDirectory, oldSaarReworkName), Encoding.ASCII.GetBytes("non-expiring SAAR correction"));
        File.WriteAllBytes(Path.Combine(reworkDirectory, oldYearOnlyName), Encoding.ASCII.GetBytes("old year-only correction"));
        File.WriteAllBytes(Path.Combine(reworkDirectory, currentYearOnlyName), Encoding.ASCII.GetBytes("current year-only correction"));
        File.WriteAllBytes(Path.Combine(nestedReworkDirectory, disabledSaarName), Encoding.ASCII.GetBytes("disabled access request"));
        File.WriteAllBytes(Path.Combine(nestedReworkDirectory, activeExpiredName), Encoding.ASCII.GetBytes("expired active agreement"));
        string existingSupersededDirectory = Path.Combine(root, "NGC", "NGC Archive", "Superseded");Directory.CreateDirectory(existingSupersededDirectory);
        File.WriteAllBytes(Path.Combine(existingSupersededDirectory, misplacedAgreementName), Encoding.ASCII.GetBytes("incorrectly superseded agreement"));
        File.WriteAllBytes(Path.Combine(existingSupersededDirectory, misplacedDisabledSaarName), Encoding.ASCII.GetBytes("incorrectly superseded SAAR"));
        string looseArchiveDirectory = Path.Combine(root, "NGC", "NGC Archive", DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)), looseArchivePdf = "Miller_Ava_(NGC)_User_Agreement_24AUG2025.pdf";Directory.CreateDirectory(looseArchiveDirectory);File.WriteAllBytes(Path.Combine(looseArchiveDirectory, looseArchivePdf), PdfBytes());
        string permanentSaarDirectory = Path.Combine(root, "NGC", "NGC SAAR Archive"), loosePermanentSaar = "Miller_Ava_(NGC)_GEN_SAAR_24AUG2020.pdf", unrelatedPermanentArchiveFile = "Miller_Ava_(NGC)_User_Agreement_24AUG2020.pdf";Directory.CreateDirectory(permanentSaarDirectory);File.WriteAllBytes(Path.Combine(permanentSaarDirectory, loosePermanentSaar), PdfBytes());File.WriteAllBytes(Path.Combine(permanentSaarDirectory, unrelatedPermanentArchiveFile), PdfBytes());
        string rejectedExtension = Path.Combine(nestedReworkDirectory, "Miller_Ava_(NGC)_unsupported.docx");File.WriteAllText(rejectedExtension, "unsupported evidence format", Encoding.UTF8);
        var retentionResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.ProcessReworkRetention("mapping-key"));object[] retentionMoves = (object[])retentionResponse["moved"];
        object[] retentionCompressed = (object[])retentionResponse["compressed"];
        Assert(retentionMoves.Length >= 8, "Archive preflight should move disabled SAARs, repair misplaced archives, move outdated evidence, and reject unsupported active files before the main scan.");
        Assert(retentionMoves.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["bucket"]) == "Unaccepted File Format"), "An unsupported active file should be moved to the organization Rework folder and explicitly classified as an unaccepted format.");
        Assert(retentionCompressed.Length >= 2 && !File.Exists(Path.Combine(looseArchiveDirectory, looseArchivePdf)) && File.Exists(Path.Combine(looseArchiveDirectory, looseArchivePdf + ".zip")) && !File.Exists(Path.Combine(permanentSaarDirectory, loosePermanentSaar)) && File.Exists(Path.Combine(permanentSaarDirectory, loosePermanentSaar + ".zip")), "Every loose PDF already in a dated Archive or permanent SAAR Archive should become a validated one-PDF ZIP before its source PDF is removed.");
        Assert(File.Exists(Path.Combine(root, "NGC", "NGC Archive", DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), oldReworkName)), "A one-to-five-year-old Rework file should move to the organization's dated Archive without changing its filename.");
        Assert(File.Exists(Path.Combine(root, "NGC", "NGC Archive", "Superseded", supersededReworkName)), "A Rework file older than five years should move directly to the organization's Superseded folder without changing its filename.");
        Assert(File.Exists(Path.Combine(root, "NGC", "NGC Archive", DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), oldYearOnlyName)), "A year-only filename that is safely beyond the one-year currency window should move to Archive without filename rework.");
        Assert(File.Exists(Path.Combine(root, "NGC", "NGC SAAR Archive", disabledSaarName)), "A SAAR with a standalone DISABLED filename marker should move to the permanent organization SAAR Archive before evidence validation.");
        Assert(File.Exists(Path.Combine(root, "NGC", "NGC SAAR Archive", misplacedDisabledSaarName)) && !File.Exists(Path.Combine(existingSupersededDirectory, misplacedDisabledSaarName)), "A SAAR previously placed in Superseded should be recovered into the permanent organization SAAR Archive.");
        Assert(File.Exists(Path.Combine(root, "NGC", "NGC Archive", DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), misplacedAgreementName)) && !File.Exists(Path.Combine(existingSupersededDirectory, misplacedAgreementName)), "Evidence less than five years old should be repaired out of Superseded into the dated organization Archive.");
        Assert(File.Exists(Path.Combine(root, "NGC", "NGC Archive", DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), activeExpiredName)), "Expired evidence in an active organization folder should be archived before the main scan.");
        Assert(File.Exists(Path.Combine(reworkDirectory, currentReworkName)) && File.Exists(Path.Combine(reworkDirectory, currentYearOnlyName)) && File.Exists(Path.Combine(reworkDirectory, oldSaarReworkName)), "Current evidence, uncertain year-only evidence, and SAARs of any age must remain in Rework for filename correction.");
        string organizedSourceRelative = Path.Combine("Organizations", "GOV", "Shaw_Vivian", evidence), organizedResponseText = storage.OrganizeEvidence("mapping-key", organizedSourceRelative, "SAAR");var organizedResponse = (Dictionary<string, object>)Json.DeserializeObject(organizedResponseText);string organizedRelative = Convert.ToString(organizedResponse["organized"]);
        Assert(organizedRelative.StartsWith("Organizations/GOV/SAAR/", StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(root, organizedRelative.Replace('/', Path.DirectorySeparatorChar))), "Accepted active evidence should move into its canonical document-type folder inside the organization with content integrity preserved.");
        string postCleanupScan = storage.Scan("mapping-key");
        Assert(!postCleanupScan.Contains(nestedArchiveName) && !postCleanupScan.Contains(nestedReworkName), "Unrelated organization Archive and Rework folders must be excluded from every later Sync scan.");
        Assert(postCleanupScan.Contains(loosePermanentSaar + ".zip") && !postCleanupScan.Contains(unrelatedPermanentArchiveFile), "Sync should inspect SAAR records in the permanent organization SAAR Archive while ignoring unrelated files stored there.");
        bool rejectedInvalidCompression = false;
        try { storage.CompressEvidence("mapping-key", "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf"); } catch (InvalidDataException) { rejectedInvalidCompression = true; }
        Assert(rejectedInvalidCompression && File.Exists(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf")) && !File.Exists(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf.zip")), "Failed ZIP validation should preserve the original loose PDF and remove any incomplete ZIP.");
        bool rejectedFakeZip = false, rejectedNonPdfEntry = false;
        try { storage.StoreEvidence("mapping-key", "GOV", "Shaw", "Vivian", "fake.zip", new byte[] { 1, 2, 3 }); } catch (InvalidDataException) { rejectedFakeZip = true; }
        try { storage.StoreEvidence("mapping-key", "GOV", "Shaw", "Vivian", "text.zip", EvidenceZip("evidence.txt", Encoding.UTF8.GetBytes("text"))); } catch (InvalidDataException) { rejectedNonPdfEntry = true; }
        Assert(rejectedFakeZip, "Launcher storage should reject bytes that are not a ZIP.");
        Assert(rejectedNonPdfEntry, "Launcher storage should reject a ZIP containing a non-PDF file.");
        string reportResult = storage.StoreReport("mapping-key", "Compliance-Snapshot_TEST.pdf", PdfBytes());
        Assert(reportResult.Contains("\"sha256\"") && File.Exists(Path.Combine(root, "System", "Reports", "Compliance-Snapshot_TEST.pdf")) && File.Exists(Path.Combine(root, "System", "Reports", "Compliance-Snapshot_TEST.pdf.sha256")), "Compliance reports should be stored with a matching SHA-256 file.");
        string packageResult = storage.StoreInspectionPackage("mapping-key", "Inspection-Package_TEST.zip", InspectionZip());
        Assert(packageResult.Contains("\"sha256\"") && File.Exists(Path.Combine(root, "System", "Reports", "Inspection-Package_TEST.zip")) && File.Exists(Path.Combine(root, "System", "Reports", "Inspection-Package_TEST.zip.sha256")), "Inspection packages should contain the required files and be stored with a matching SHA-256 file.");
        string errorReportResult = storage.StoreErrorReport("mapping-key", "ERR-TEST.txt", "Information System User Tracker Error Report\r\nDetails: simulated failure");
        Assert(errorReportResult.Contains("Error Reports/ERR-TEST.txt") && File.ReadAllText(Path.Combine(root, "Error Reports", "ERR-TEST.txt"), Encoding.UTF8).Contains("simulated failure"), "A plain-text error report should be stored in the top-level Error Reports folder for Notepad review.");

        string journalFirst = storage.ScanWithJournal("mapping-key", "journal-rules", true);var journalFirstObject = (Dictionary<string, object>)Json.DeserializeObject(journalFirst);string journalRun = Convert.ToString(journalFirstObject["runId"]);
        string journalResumed = storage.ScanWithJournal("mapping-key", "journal-rules", false);var journalResumedObject = (Dictionary<string, object>)Json.DeserializeObject(journalResumed);
        Assert(journalRun == Convert.ToString(journalResumedObject["runId"]) && Convert.ToInt32(journalResumedObject["resumedFiles"]) > 0, "An uncommitted Sync journal should resume completed file validation after restart or reconnect.");
        storage.CommitSyncJournal("mapping-key", journalRun);Assert(storage.CommitSyncJournal("mapping-key", journalRun).Contains("\"committed\":true"), "Sync journal commit should be safely repeatable.");
        string interruptedRelative = Path.Combine("GOV", "Transaction_User_(GOV)_User_Agreement_24AUG2026.pdf"), interruptedPath = Path.Combine(root, interruptedRelative), interruptedTarget = "Transaction_User_(GOV)_User_Agreement_25AUG2026.pdf";Directory.CreateDirectory(Path.GetDirectoryName(interruptedPath));File.WriteAllBytes(interruptedPath, PdfBytes());
        bool interruptionObserved = false;try { PortableStorage.FailAfterStageForTests = "rename-move";storage.NormalizeEvidenceFilename("mapping-key", interruptedRelative, interruptedTarget); } catch (IOException) { interruptionObserved = true; } finally { PortableStorage.FailAfterStageForTests = null; }
        Assert(interruptionObserved, "The transaction recovery test must simulate a crash after a completed move.");storage.Map("mapping-key", root);Assert(!File.Exists(interruptedPath) && File.Exists(Path.Combine(Path.GetDirectoryName(interruptedPath), interruptedTarget)) && !Directory.EnumerateFiles(Path.Combine(root, "System", "Storage Transactions"), "transaction-*.json").Any(), "Mapping after an interrupted rename should reconcile the durable transaction without duplicating or losing the file.");
        string pendingRelative = Path.Combine("GOV", "Pending_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf"), pendingPath = Path.Combine(root, pendingRelative);File.WriteAllBytes(pendingPath, PdfBytes());bool pendingInterrupted = false;try { PortableStorage.FailAfterStageForTests = "scan-file-pending";storage.ScanWithJournal("mapping-key", "pending-rules", true); } catch (IOException) { pendingInterrupted = true; } finally { PortableStorage.FailAfterStageForTests = null; }
        Assert(pendingInterrupted && storage.ScanWithJournal("mapping-key", "pending-rules", false).Contains("Pending_User"), "A crash after a pending Sync journal entry should resume and validate that file on the next run.");
        storage.AppendAudit("mapping-key", "TEST ACTION");
        storage.AppendAudit("mapping-key", "SECOND ACTION");
        storage.AppendAuditBatch("mapping-key", new[] { "BATCH ACTION ONE", "BATCH ACTION TWO", "BATCH ACTION THREE" });
        string auditDirectory = Path.Combine(root, "System", "Audit Logs"), auditPath = Directory.EnumerateFiles(auditDirectory, "audit-*.jsonl").Single();
        var auditBlocker = new FileStream(auditPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        var releaseAuditBlocker = new Thread(new ThreadStart(delegate { Thread.Sleep(100); auditBlocker.Dispose(); }));
        releaseAuditBlocker.Start();
        storage.AppendAudit("mapping-key", "ACTION AFTER TRANSIENT FILE LOCK");
        releaseAuditBlocker.Join();
        string[] auditLines = File.ReadAllLines(auditPath, Encoding.UTF8);
        Assert(auditLines.Length == 6, "Audit batching and a later append should preserve every action after a brief shared-folder file lock clears.");
        var firstAudit = (Dictionary<string, object>)Json.DeserializeObject(auditLines[0]);
        var secondAudit = (Dictionary<string, object>)Json.DeserializeObject(auditLines[1]);
        DateTimeOffset auditInstant;
        Assert(Convert.ToString(firstAudit["timestampUtc"]).EndsWith("Z") && DateTimeOffset.TryParse(Convert.ToString(firstAudit["timestampUtc"]), out auditInstant) && auditInstant.Offset == TimeSpan.Zero, "Audit timestamps should be unambiguous UTC ISO 8601 values.");
        Assert(Convert.ToInt64(firstAudit["sequence"]) == 1 && Convert.ToInt64(secondAudit["sequence"]) == 2, "Audit entries should use a continuous sequence.");
        Assert(Convert.ToString(secondAudit["previousHash"]) == Convert.ToString(firstAudit["entryHash"]), "Each audit entry should reference the previous entry hash.");
        string auditVerification = storage.VerifyAuditLogs("mapping-key");
        Assert(auditVerification.Contains("\"healthy\":true") && auditVerification.Contains("\"entries\":6"), "The intact batched audit hash chain should verify.");
        string auditView = storage.ReadAuditLogs("mapping-key");
        Assert(auditView.Contains("\"recent\"") && auditView.IndexOf("SECOND ACTION", StringComparison.Ordinal) < auditView.IndexOf("TEST ACTION", StringComparison.Ordinal), "The read-only audit view should return verified entries newest first.");

        Assert(storage.AcquireLease("mapping-key", "session-1"), "The first lease should be acquired.");
        Assert(!TrackerContext.StorageActionRequiresSerialization("lease-acquire") && !TrackerContext.StorageActionRequiresSerialization("lease-renew") && !TrackerContext.StorageActionRequiresSerialization("lease-release") && TrackerContext.StorageActionRequiresSerialization("scan"), "Session lease operations must remain available while a long storage operation is running.");
        object storageRootGate = typeof(PortableStorage).GetMethod("RootLock", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(storage, new object[] { "mapping-key" });
        var rootGateHeld = new ManualResetEvent(false);var releaseRootGate = new ManualResetEvent(false);
        var rootGateThread = new Thread(new ThreadStart(delegate { lock (storageRootGate) { rootGateHeld.Set();releaseRootGate.WaitOne(); } }));rootGateThread.Start();rootGateHeld.WaitOne();
        bool renewed = false;var renewDone = new ManualResetEvent(false);var renewThread = new Thread(new ThreadStart(delegate { renewed = storage.RenewLease("mapping-key", "session-1");renewDone.Set(); }));renewThread.Start();bool renewedWhileRootHeld = renewDone.WaitOne(1000);releaseRootGate.Set();rootGateThread.Join();renewThread.Join();
        Assert(renewedWhileRootHeld && renewed, "Lease renewal must not wait behind a long root storage operation.");
        Assert(!storage.AcquireLease("mapping-key", "session-2"), "A concurrent lease should be rejected.");
        Assert(!competingStorage.AcquireLease("mapping-key", "session-2"), "A second launcher should be blocked by the exclusive file lock.");
        storage.ReleaseLease("mapping-key", "session-1");
        Assert(competingStorage.AcquireLease("mapping-key", "session-2"), "A released exclusive lock should be available to another launcher.");
        competingStorage.ReleaseLease("mapping-key", "session-2");
        Assert(storage.AcquireLease("mapping-key", "session-3"), "The original launcher should be able to reacquire the lock.");
        storage.ExpireLeases(TimeSpan.Zero);
        Assert(competingStorage.AcquireLease("mapping-key", "session-4"), "An expired exclusive lock should be recoverable without deleting its lock file.");
        competingStorage.ReleaseLease("mapping-key", "session-4");

        string verification = storage.VerifyLatest("mapping-key", "system-1");
        Assert(verification.Contains("\"healthy\":true"), "The latest database and backup should verify.");
        object[] items = (object[])Json.DeserializeObject(storage.ListBackups("mapping-key", "system-1"));
        string latest = Convert.ToString(((Dictionary<string, object>)items[0])["filename"]);
        File.AppendAllText(Path.Combine(root, "System", "backup", latest), "tampered");
        object[] tampered = (object[])Json.DeserializeObject(storage.ListBackups("mapping-key", "system-1"));
        Assert(!Convert.ToBoolean(((Dictionary<string, object>)tampered[0])["valid"]), "A modified snapshot should fail integrity verification.");
        storage.FinalizeMappedBackups();
        Assert(storage.VerifyLatest("mapping-key", "system-1").Contains("\"healthy\":true"), "Finalization should create a new valid snapshot when the latest is damaged.");

        firstAudit["action"] = "ALTERED ACTION";
        auditLines[0] = Json.Serialize(firstAudit);
        File.WriteAllLines(auditPath, auditLines, new UTF8Encoding(false));
        bool rejectedTamperedAudit = false, rejectedAppendAfterTamper = false;
        try { storage.VerifyAuditLogs("mapping-key"); } catch (InvalidDataException) { rejectedTamperedAudit = true; }
        try { storage.AppendAudit("mapping-key", "SHOULD NOT APPEND"); } catch (InvalidDataException) { rejectedAppendAfterTamper = true; }
        Assert(rejectedTamperedAudit, "Changing an earlier audit action should break verification.");
        Assert(rejectedAppendAfterTamper, "The launcher should refuse to extend a tampered audit chain.");
        storage.Dispose();
        competingStorage.Dispose();

        Console.WriteLine("Portable storage integration tests passed.");
        return 0;
    }
}
