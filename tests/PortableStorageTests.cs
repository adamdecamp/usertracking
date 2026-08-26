using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
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

    public static int Main(string[] args)
    {
        if (args.Length != 1) throw new ArgumentException("A test directory is required.");
        string root = Path.GetFullPath(args[0]);
        Directory.CreateDirectory(root);
        var storage = new PortableStorage("DOMAIN\\operator");
        storage.Map("mapping-key", root);
        var competingStorage = new PortableStorage("DOMAIN\\second-operator");
        competingStorage.Map("mapping-key", root);

        storage.SaveManifest("mapping-key", Database("first@example.mil"));
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
        string scan = storage.Scan("mapping-key");
        Assert(scan.Contains("Shaw_Vivian_SAAR_24AUG2026.pdf.zip") && scan.Contains("\"accepted\":true"), "Directory scan should accept launcher-stored PDF evidence.");
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
        File.WriteAllText(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.txt"), "not evidence");
        File.WriteAllBytes(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf"), Encoding.ASCII.GetBytes("not a pdf"));
        scan = storage.Scan("mapping-key");
        object[] scannedItems = (object[])Json.DeserializeObject(scan);
        Dictionary<string, object> textItem = scannedItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_DOD_Cyber_24AUG2026.txt");
        Dictionary<string, object> fakePdfItem = scannedItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf");
        Assert(!Convert.ToBoolean(textItem["accepted"]) && Convert.ToString(textItem["error"]).Contains("Only PDF evidence"), "Directory scan should reject non-PDF evidence.");
        Assert(!Convert.ToBoolean(fakePdfItem["accepted"]), "Directory scan should reject a renamed non-PDF file.");
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
        string[] auditLines = File.ReadAllLines(auditPath, Encoding.UTF8);
        Assert(auditLines.Length == 2, "Audit logging should append two JSON Lines entries to the daily file.");
        var firstAudit = (Dictionary<string, object>)Json.DeserializeObject(auditLines[0]);
        var secondAudit = (Dictionary<string, object>)Json.DeserializeObject(auditLines[1]);
        DateTimeOffset auditInstant;
        Assert(Convert.ToString(firstAudit["timestampUtc"]).EndsWith("Z") && DateTimeOffset.TryParse(Convert.ToString(firstAudit["timestampUtc"]), out auditInstant) && auditInstant.Offset == TimeSpan.Zero, "Audit timestamps should be unambiguous UTC ISO 8601 values.");
        Assert(Convert.ToInt64(firstAudit["sequence"]) == 1 && Convert.ToInt64(secondAudit["sequence"]) == 2, "Audit entries should use a continuous sequence.");
        Assert(Convert.ToString(secondAudit["previousHash"]) == Convert.ToString(firstAudit["entryHash"]), "Each audit entry should reference the previous entry hash.");
        string auditVerification = storage.VerifyAuditLogs("mapping-key");
        Assert(auditVerification.Contains("\"healthy\":true") && auditVerification.Contains("\"entries\":2"), "The intact audit hash chain should verify.");

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
