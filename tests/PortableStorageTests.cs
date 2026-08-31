using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
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
        }
    }

    public static int Main(string[] args)
    {
        if (args.Length != 1) throw new ArgumentException("A test directory is required.");
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
        Assert(File.Exists(Path.Combine(compatibilityRoot, "information-system-user-tracker.json")) && File.Exists(Path.Combine(compatibilityRoot, "backup", "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".csv")) && Directory.EnumerateFiles(Path.Combine(compatibilityRoot, "Audit Logs"), "audit-*.jsonl").Any(), "Compatible buffered I/O should preserve manifest, backup, and audit writes.");
        string legacyCache = Path.Combine(root, "legacy-folder-mappings.json");
        File.WriteAllText(legacyCache, "{\"version\":1,\"lastSystemId\":\"legacy\",\"mappings\":[{\"systemId\":\"legacy\",\"path\":\"" + compatibilityRoot.Replace("\\", "\\\\") + "\"}]}", Encoding.UTF8);
        using (var legacyStorage = new PortableStorage("DOMAIN\\operator", legacyCache)) Assert(!legacyStorage.CachedMappings().Contains("legacy"), "Version-1 development mapping caches should be ignored so a clean update cannot restore stale test systems.");
        string mappingCache = Path.Combine(root, "local-folder-mappings.json");
        var storage = new PortableStorage("DOMAIN\\operator", mappingCache);
        storage.Map("mapping-key", root);
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
        string evidencePath = Path.Combine(root, "User Evidence", "GOV", "Shaw_Vivian", evidence);File.SetLastWriteTimeUtc(evidencePath, File.GetLastWriteTimeUtc(evidencePath).AddSeconds(2));
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
        string alternateDateRelative = Path.Combine("User Evidence", "GOV", "Shaw_Vivian", alternateDateEvidence), alternateDatePath = Path.Combine(root, alternateDateRelative), normalizedDateName = "Shaw_Vivian_(GOV)_GEN_User_Agreement_26AUG2026.pdf.zip";byte[] alternateDateBytes = File.ReadAllBytes(alternateDatePath);
        var normalizedDateResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.NormalizeEvidenceFilename("mapping-key", alternateDateRelative, normalizedDateName));
        string normalizedDatePath = Path.Combine(root, "User Evidence", "GOV", "Shaw_Vivian", normalizedDateName);
        Assert(!File.Exists(alternateDatePath) && File.Exists(normalizedDatePath) && alternateDateBytes.SequenceEqual(File.ReadAllBytes(normalizedDatePath)) && Convert.ToString(normalizedDateResponse["renamed"]).EndsWith(normalizedDateName), "Filename normalization should apply the folder organization and standard date without changing any file bytes.");
        File.WriteAllBytes(alternateDatePath, alternateDateBytes);
        var collisionResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.NormalizeEvidenceFilename("mapping-key", alternateDateRelative, normalizedDateName));
        Assert(Convert.ToBoolean(collisionResponse["collision"]) && File.Exists(alternateDatePath) && File.Exists(normalizedDatePath), "A normalization collision should preserve both files and return it for duplicate review instead of aborting Sync.");
        bool rejectedUnsafeRename = false;
        try { storage.NormalizeEvidenceFilename("mapping-key", Path.Combine("User Evidence", "GOV", "Shaw_Vivian", normalizedDateName), "..\\escape.zip"); } catch (InvalidDataException) { rejectedUnsafeRename = true; }
        Assert(rejectedUnsafeRename, "Date normalization should reject an unsafe target filename.");
        string olderEvidence = storage.StoreEvidence("mapping-key", "GOV", "Shaw", "Vivian", "Shaw_Vivian_SAAR_24AUG2025.pdf.zip", EvidenceZip("Shaw_Vivian_SAAR_24AUG2025.pdf", PdfBytes()));
        string olderRelative = Path.Combine("User Evidence", "GOV", "Shaw_Vivian", olderEvidence), archiveResult = storage.ArchiveEvidence("mapping-key", olderRelative);
        var archiveResponse = (Dictionary<string, object>)Json.DeserializeObject(archiveResult);
        string archivedRelative = Convert.ToString(archiveResponse["archived"]), archivedPath = Path.Combine(root, archivedRelative.Replace('/', Path.DirectorySeparatorChar));
        Assert(!File.Exists(Path.Combine(root, olderRelative)) && File.Exists(archivedPath), "Approved cleanup should move evidence into Archive Review without deleting it.");
        Assert(!storage.Scan("mapping-key").Contains("Shaw_Vivian_SAAR_24AUG2025.pdf.zip"), "Archived evidence should be excluded from later Sync scans.");
        string looseRelative = Path.Combine("User Evidence", "GOV", "Shaw_Vivian", "Shaw_Vivian_GEN_User_Agreement_24AUG2026.pdf"), loosePath = Path.Combine(root, looseRelative);
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

        string longEvidenceDirectory = Path.Combine(root, "User Evidence", "GOV", "Shaw_Vivian"), longEvidencePrefix = "Shaw_Vivian_GEN_User_Agreement_", longEvidenceSuffix = "_24AUG2026.pdf.zip";
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
        Assert(!File.Exists(correctionPath) && File.Exists(reworkedPath) && reworkedRelative.StartsWith("Rework/", StringComparison.OrdinalIgnoreCase), "Correction PDFs should move into the root Rework folder even when their PDF bytes are invalid.");
        Assert(!storage.Scan("mapping-key").Contains("Shaw_Vivian_GEN_SAAR_24AUG2026.pdf"), "Rework files should be excluded from later Sync scans.");
        bool rejectedInvalidCompression = false;
        try { storage.CompressEvidence("mapping-key", "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf"); } catch (InvalidDataException) { rejectedInvalidCompression = true; }
        Assert(rejectedInvalidCompression && File.Exists(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf")) && !File.Exists(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf.zip")), "Failed ZIP validation should preserve the original loose PDF and remove any incomplete ZIP.");
        bool rejectedFakeZip = false, rejectedNonPdfEntry = false;
        try { storage.StoreEvidence("mapping-key", "GOV", "Shaw", "Vivian", "fake.zip", new byte[] { 1, 2, 3 }); } catch (InvalidDataException) { rejectedFakeZip = true; }
        try { storage.StoreEvidence("mapping-key", "GOV", "Shaw", "Vivian", "text.zip", EvidenceZip("evidence.txt", Encoding.UTF8.GetBytes("text"))); } catch (InvalidDataException) { rejectedNonPdfEntry = true; }
        Assert(rejectedFakeZip, "Launcher storage should reject bytes that are not a ZIP.");
        Assert(rejectedNonPdfEntry, "Launcher storage should reject a ZIP containing a non-PDF file.");
        string reportResult = storage.StoreReport("mapping-key", "Compliance-Snapshot_TEST.pdf", PdfBytes());
        Assert(reportResult.Contains("\"sha256\"") && File.Exists(Path.Combine(root, "Reports", "Compliance-Snapshot_TEST.pdf")) && File.Exists(Path.Combine(root, "Reports", "Compliance-Snapshot_TEST.pdf.sha256")), "Compliance reports should be stored with a matching SHA-256 file.");
        storage.AppendAudit("mapping-key", "TEST ACTION");
        storage.AppendAudit("mapping-key", "SECOND ACTION");
        string auditDirectory = Path.Combine(root, "Audit Logs"), auditPath = Directory.EnumerateFiles(auditDirectory, "audit-*.jsonl").Single();
        var auditBlocker = new FileStream(auditPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        var releaseAuditBlocker = new Thread(new ThreadStart(delegate { Thread.Sleep(100); auditBlocker.Dispose(); }));
        releaseAuditBlocker.Start();
        storage.AppendAudit("mapping-key", "ACTION AFTER TRANSIENT FILE LOCK");
        releaseAuditBlocker.Join();
        string[] auditLines = File.ReadAllLines(auditPath, Encoding.UTF8);
        Assert(auditLines.Length == 3, "Audit logging should append after a brief shared-folder file lock clears.");
        var firstAudit = (Dictionary<string, object>)Json.DeserializeObject(auditLines[0]);
        var secondAudit = (Dictionary<string, object>)Json.DeserializeObject(auditLines[1]);
        DateTimeOffset auditInstant;
        Assert(Convert.ToString(firstAudit["timestampUtc"]).EndsWith("Z") && DateTimeOffset.TryParse(Convert.ToString(firstAudit["timestampUtc"]), out auditInstant) && auditInstant.Offset == TimeSpan.Zero, "Audit timestamps should be unambiguous UTC ISO 8601 values.");
        Assert(Convert.ToInt64(firstAudit["sequence"]) == 1 && Convert.ToInt64(secondAudit["sequence"]) == 2, "Audit entries should use a continuous sequence.");
        Assert(Convert.ToString(secondAudit["previousHash"]) == Convert.ToString(firstAudit["entryHash"]), "Each audit entry should reference the previous entry hash.");
        string auditVerification = storage.VerifyAuditLogs("mapping-key");
        Assert(auditVerification.Contains("\"healthy\":true") && auditVerification.Contains("\"entries\":3"), "The intact audit hash chain should verify.");
        string auditView = storage.ReadAuditLogs("mapping-key");
        Assert(auditView.Contains("\"recent\"") && auditView.IndexOf("SECOND ACTION", StringComparison.Ordinal) < auditView.IndexOf("TEST ACTION", StringComparison.Ordinal), "The read-only audit view should return verified entries newest first.");

        Assert(storage.AcquireLease("mapping-key", "session-1"), "The first lease should be acquired.");
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
        File.AppendAllText(Path.Combine(root, "backup", latest), "tampered");
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
