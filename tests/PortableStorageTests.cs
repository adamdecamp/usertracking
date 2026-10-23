using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Globalization;
using System.Linq;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class PortableStorageTests
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 100 * 1024 * 1024 };

    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }

    private static string LocalEvidenceFile(PortableStorage storage, string systemId, string relative)
    {
        object[] arguments = { systemId, relative, null };string localRoot = storage.LocalWorkspacePath(systemId);
        try { string result = Convert.ToString(typeof(PortableStorage).GetMethod("ResolveEvidencePath", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(storage, arguments));return String.Equals(Convert.ToString(arguments[2]), localRoot, StringComparison.OrdinalIgnoreCase) ? result : Path.Combine(localRoot, relative); }
        catch (TargetInvocationException error) { if (error.InnerException is FileNotFoundException) return Path.Combine(localRoot, relative);throw; }
    }

    private static string RawLauncherRequest(TrackerContext context, string method, string path, byte[] body, bool includeToken, bool validOrigin, long? declaredLength = null, string leaseSession = "e2e-session")
    {
        using (var client = new TcpClient("127.0.0.1", context.E2EPort))
        using (NetworkStream stream = client.GetStream())
        {
            byte[] requestBody = body ?? new byte[0];long length = declaredLength ?? requestBody.LongLength;
            string headers = method + " " + path + " HTTP/1.1\r\nHost: localhost:" + context.E2EPort.ToString(CultureInfo.InvariantCulture) + "\r\nConnection: close\r\n" + ((method == "POST" || method == "DELETE") ? "Origin: " + (validOrigin ? "http://localhost:" + context.E2EPort.ToString(CultureInfo.InvariantCulture) : "https://invalid.example") + "\r\n" : "") + (includeToken ? "X-RAPTOR-Session-Token: " + context.E2ESessionToken + "\r\n" : "") + (leaseSession == null ? "" : "X-RAPTOR-Lease-Session: " + leaseSession + "\r\n") + "Content-Length: " + length.ToString(CultureInfo.InvariantCulture) + "\r\n\r\n";
            byte[] headerBytes = Encoding.ASCII.GetBytes(headers);stream.Write(headerBytes, 0, headerBytes.Length);if (requestBody.Length > 0) stream.Write(requestBody, 0, requestBody.Length);stream.Flush();
            using (var response = new MemoryStream()) { byte[] buffer = new byte[4096];int read;while ((read = stream.Read(buffer, 0, buffer.Length)) > 0) response.Write(buffer, 0, read);return Encoding.UTF8.GetString(response.ToArray()); }
        }
    }

    private static string RawLauncherHeaders(TrackerContext context, string headerBlock)
    {
        using (var client = new TcpClient("127.0.0.1", context.E2EPort))
        using (NetworkStream stream = client.GetStream())
        {
            client.ReceiveTimeout = 10000;client.SendTimeout = 10000;
            byte[] request = Encoding.ASCII.GetBytes(headerBlock);stream.Write(request, 0, request.Length);stream.Flush();
            using (var response = new MemoryStream()) { byte[] buffer = new byte[4096];int read;while ((read = stream.Read(buffer, 0, buffer.Length)) > 0) response.Write(buffer, 0, read);return Encoding.UTF8.GetString(response.ToArray()); }
        }
    }

    private static void RunLauncherE2E(string parent)
    {
        string root = Path.Combine(parent, "launcher-e2e");Directory.CreateDirectory(root);var context = new TrackerContext(root);
        try
        {
            string authenticated = RawLauncherRequest(context, "GET", "/api/session-user", null, true, true);Assert(authenticated.StartsWith("HTTP/1.1 200", StringComparison.Ordinal) && authenticated.Contains("RAPTOR\\\\E2E"), "The real launcher listener should authenticate and route an API request end to end.");
            Assert(RawLauncherRequest(context, "GET", "/api/session-user", null, false, true).StartsWith("HTTP/1.1 401", StringComparison.Ordinal), "The launcher must reject an API request without its ephemeral session token.");
            Assert(RawLauncherRequest(context, "POST", "/api/activity", null, true, false).StartsWith("HTTP/1.1 403", StringComparison.Ordinal), "The launcher must reject a state-changing request from a foreign Origin.");
            Assert(RawLauncherRequest(context, "POST", "/api/storage/e2e-system/manifest", Encoding.UTF8.GetBytes("{}"), true, true, null, "wrong-session").StartsWith("HTTP/1.1 403", StringComparison.Ordinal), "A mutation must reject a lease owned by another session before parsing its body.");
            Assert(RawLauncherRequest(context, "GET", "/api/storage/e2e-system/scan?rules=e2e&full=1&legacy=1", null, true, true, null, null).StartsWith("HTTP/1.1 403", StringComparison.Ordinal), "A state-changing GET action must also require the exclusive lease.");
            Assert(RawLauncherRequest(context, "POST", "/api/storage/e2e-system/audit", null, true, true, 8193).StartsWith("HTTP/1.1 413", StringComparison.Ordinal), "The launcher must reject an audit body above its endpoint-specific limit before reading it.");
            string authority = "localhost:" + context.E2EPort.ToString(CultureInfo.InvariantCulture), origin = "http://" + authority, token = context.E2ESessionToken;
            Assert(RawLauncherHeaders(context, "POST /api/activity HTTP/1.1\r\nHost: " + authority + "\r\nOrigin: " + origin + "\r\nX-RAPTOR-Session-Token: " + token + "\r\nTransfer-Encoding: chunked\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").StartsWith("HTTP/1.1 400", StringComparison.Ordinal), "Chunked request framing must be rejected at the trust boundary.");
            Assert(RawLauncherHeaders(context, "POST /api/activity HTTP/1.1\r\nHost: " + authority + "\r\nOrigin: " + origin + "\r\nX-RAPTOR-Session-Token: " + token + "\r\nContent-Length: 0\r\nContent-Length: 1\r\nConnection: close\r\n\r\n").StartsWith("HTTP/1.1 400", StringComparison.Ordinal), "Conflicting Content-Length headers must be rejected.");
            Assert(RawLauncherHeaders(context, "PATCH /api/activity HTTP/1.1\r\nHost: " + authority + "\r\nConnection: close\r\n\r\n").StartsWith("HTTP/1.1 405", StringComparison.Ordinal), "Unsupported HTTP methods must fail closed.");
            for (int attempt = 0; attempt < 40; attempt++)
            {
                string fuzzPath = "/api/unknown-" + attempt.ToString(CultureInfo.InvariantCulture) + "?value=" + new string('x', attempt % 17);
                Assert(RawLauncherRequest(context, "GET", fuzzPath, null, false, true).StartsWith("HTTP/1.1 401", StringComparison.Ordinal), "Every randomized API path must authenticate before routing.");
            }
            string auditWrite = RawLauncherRequest(context, "POST", "/api/storage/e2e-system/audit", Encoding.UTF8.GetBytes("LAUNCHER E2E AUDIT"), true, true);Assert(auditWrite.StartsWith("HTTP/1.1 200", StringComparison.Ordinal), "The launcher should route an allowed bounded audit write through the storage layer. Response: " + auditWrite);
            PortableStorage.FailAfterStageForTests = "scan-start";
            string failed = RawLauncherRequest(context, "GET", "/api/storage/e2e-system/scan?rules=e2e&full=1&legacy=1", null, true, true);Assert(failed.StartsWith("HTTP/1.1 400", StringComparison.Ordinal) && failed.Contains("Injected interruption"), "The launcher E2E test should surface an injected storage failure without terminating the listener.");
            Assert(RawLauncherRequest(context, "GET", "/api/storage/e2e-system/audit-verify", null, true, true).StartsWith("HTTP/1.1 200", StringComparison.Ordinal), "The launcher must remain usable after an injected storage failure.");
            var scanEntered = new ManualResetEvent(false);var allowScan = new ManualResetEvent(false);var scanFinished = new ManualResetEvent(false);var releaseFinished = new ManualResetEvent(false);string blockedScanResponse = null, deferredReleaseResponse = null;int blockedEnumeration = 0;Thread blockedScan = null, deferredRelease = null;bool entered = false, releasedEarly = false;
            try
            {
                PortableStorage.DirectoryEnumerationForTests = delegate(string ignored) { if (Interlocked.CompareExchange(ref blockedEnumeration, 1, 0) == 0) { scanEntered.Set();allowScan.WaitOne(10000); } };
                blockedScan = new Thread(new ThreadStart(delegate { try { blockedScanResponse = RawLauncherRequest(context, "GET", "/api/storage/e2e-system/scan?rules=lease-race&full=1&legacy=1", null, true, true); } catch (Exception error) { blockedScanResponse = error.ToString(); } finally { scanFinished.Set(); } }));blockedScan.Start();entered = scanEntered.WaitOne(5000);
                if (entered)
                {
                    deferredRelease = new Thread(new ThreadStart(delegate { try { deferredReleaseResponse = RawLauncherRequest(context, "POST", "/api/storage/e2e-system/lease-release?session=e2e-session", null, true, true); } catch (Exception error) { deferredReleaseResponse = error.ToString(); } finally { releaseFinished.Set(); } }));deferredRelease.Start();releasedEarly = releaseFinished.WaitOne(250);
                }
            }
            finally
            {
                allowScan.Set();if (blockedScan != null) blockedScan.Join(10000);if (deferredRelease != null) deferredRelease.Join(10000);PortableStorage.DirectoryEnumerationForTests = null;
            }
            Assert(entered, "The lease-release concurrency test must hold an active serialized storage operation.");
            Assert(!releasedEarly && scanFinished.WaitOne(0) && releaseFinished.WaitOne(0), "Lease release must remain deferred until the active per-system storage operation completes.");
            Assert(blockedScanResponse != null && blockedScanResponse.StartsWith("HTTP/1.1 200", StringComparison.Ordinal), "The active storage operation should complete before deferred lease release. Response: " + blockedScanResponse);
            Assert(deferredReleaseResponse != null && deferredReleaseResponse.StartsWith("HTTP/1.1 200", StringComparison.Ordinal), "Deferred lease release should complete after the active storage operation. Response: " + deferredReleaseResponse);
            Assert(RawLauncherRequest(context, "POST", "/api/storage/e2e-system/manifest", Encoding.UTF8.GetBytes("{}"), true, true).StartsWith("HTTP/1.1 403", StringComparison.Ordinal), "A mutation must fail after the deferred release actually drops the lease.");
            Assert(RawLauncherRequest(context, "POST", "/api/storage/e2e-system/lease-acquire?session=e2e-session", null, true, true).Contains("\"acquired\":true"), "The E2E session should reacquire its lease after the deferral test.");
            Assert(RawLauncherRequest(context, "POST", "/api/session-downgrade", null, true, true).StartsWith("HTTP/1.1 200", StringComparison.Ordinal), "The authorization state model should allow an explicit downgrade to Read-Only.");
            Assert(RawLauncherRequest(context, "GET", "/api/storage/e2e-system/manifest", null, true, true).StartsWith("HTTP/1.1 200", StringComparison.Ordinal), "Read-Only must retain allowed manifest lookup.");
            Assert(RawLauncherRequest(context, "GET", "/api/storage/e2e-system/scan?rules=e2e&full=1&legacy=1", null, true, true).StartsWith("HTTP/1.1 403", StringComparison.Ordinal), "Read-Only must reject Sync after downgrade.");
            Assert(RawLauncherRequest(context, "POST", "/api/storage/e2e-system/manifest", Encoding.UTF8.GetBytes("{}"), true, true).StartsWith("HTTP/1.1 403", StringComparison.Ordinal), "Read-Only must reject manifest mutation after downgrade.");
        }
        finally { PortableStorage.FailAfterStageForTests = null;context.StopE2E(); }
    }

    private static Dictionary<string, object> ItemNamed(object[] items, string name)
    {
        Dictionary<string, object> result = items.Cast<Dictionary<string, object>>().FirstOrDefault(item => String.Equals(Convert.ToString(item["name"]), name, StringComparison.Ordinal));
        Assert(result != null, "Expected scan item was not returned: " + name + ". Returned: " + String.Join(", ", items.Cast<Dictionary<string, object>>().Select(item => Convert.ToString(item["name"])).Take(20)));
        return result;
    }

    private static byte[] PdfBytes() { return Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"); }

    private static byte[] EncryptedPdfBytes() { return Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\ntrailer\n<<>>\n%%EOF\n"); }

    private static string Sha256(byte[] bytes) { using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
    private static bool IsSha256(string value) { return !String.IsNullOrWhiteSpace(value) && value.Length == 64 && value.All(character => (character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')); }

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

    private static string DatabaseWithLegacyChangeArrays(string email)
    {
        Dictionary<string, object> database = (Dictionary<string, object>)Json.DeserializeObject(Database(email));
        Dictionary<string, object> user = (Dictionary<string, object>)((object[])database["users"])[0];
        user["changes"] = new object[] { new Dictionary<string, object> { { "timestamp", "2026-01-01T00:00:00.000Z" }, { "actor", "DOMAIN\\legacy" }, { "action", "Legacy update" }, { "description", "Created before change-history arrays were persisted." } } };
        return Json.Serialize(database);
    }

    private static string MultiOrganizationDatabase(string changedLmEmail = null)
    {
        var system = new Dictionary<string, object> { { "id", "system-1" }, { "name", "Test System" }, { "type", "Administrative" }, { "organization", "GOV" }, { "archived", false } };
        string[] organizations = { "GOV", "LM", "GOV", "NGC", "LM" };
        object[] users = organizations.Select((organization, index) => (object)new Dictionary<string, object> { { "id", "ordered-user-" + index.ToString(CultureInfo.InvariantCulture) }, { "systemId", "system-1" }, { "organization", organization }, { "last", "Ordered" + index.ToString(CultureInfo.InvariantCulture) }, { "first", "User" }, { "middle", "" }, { "email", index == 1 && !String.IsNullOrWhiteSpace(changedLmEmail) ? changedLmEmail : "ordered" + index.ToString(CultureInfo.InvariantCulture) + "@example.mil" }, { "disabled", false }, { "roles", new object[] { "General" } }, { "privilegedUsernames", new object[0] }, { "privilegedTypes", new object[0] }, { "artifacts", new object[0] }, { "changes", new object[0] } }).ToArray();
        return Json.Serialize(new Dictionary<string, object> { { "version", 2 }, { "updated", DateTime.UtcNow.ToString("o") }, { "systems", new object[] { system } }, { "users", users } });
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
            int nativeAccepted = nativeItems.Cast<Dictionary<string, object>>().Count(item => Convert.ToBoolean(item["accepted"]));
            string firstNativeError = String.Join(" | ", nativeItems.Cast<Dictionary<string, object>>().Where(item => !Convert.ToBoolean(item["accepted"])).Select(item => Convert.ToString(item["error"])).Where(message => !String.IsNullOrWhiteSpace(message)).Distinct().Take(3));
            Assert(nativeAccepted == total / 2, "Native enumeration fuzz should accept only the valid PDF and PDF-in-ZIP cases; accepted " + nativeAccepted.ToString() + " of " + total.ToString() + ". Errors: " + firstNativeError);

            string localFuzzRoot = fuzzStorage.LocalWorkspacePath("fuzz-system");
            foreach (string source in Directory.EnumerateFiles(fuzzRoot, "*", SearchOption.AllDirectories).Where(file => !file.StartsWith(Path.Combine(fuzzRoot, "System"), StringComparison.OrdinalIgnoreCase))) { string destination = Path.Combine(localFuzzRoot, source.Substring(fuzzRoot.Length + 1));Directory.CreateDirectory(Path.GetDirectoryName(destination));File.Copy(source, destination, true); }
            fuzzStorage.Scan("fuzz-system", "fuzz-rules", false);
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

    private static void RunLocalDatabaseScanBoundary(string parent)
    {
        string root = Path.Combine(parent, "local-boundary-share"), cache = Path.Combine(parent, "local-boundary", "mappings.json");Directory.CreateDirectory(root);
        using (var storage = new PortableStorage("DOMAIN\\local-boundary", cache))
        {
            storage.Map("local-boundary", root);
            var database = (Dictionary<string, object>)Json.DeserializeObject(Database("local@example.mil"));
            var user = (Dictionary<string, object>)((object[])database["users"])[0];user["disabled"] = true;
            string disabledName = "Shaw_Vivian_(GOV)_GEN_SAAR_DISABLED_24AUG2026.pdf.zip", archived = "Organizations/GOV/GOV SAAR Archive/" + disabledName;
            user["artifacts"] = new object[] { new Dictionary<string, object> { { "kind", "SAAR" }, { "filename", disabledName }, { "path", archived } } };
            storage.SaveSystemState("local-boundary", Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", "local database" } })));
            string local = storage.LocalWorkspacePath("local-boundary"), incoming = Path.Combine(local, "Organizations", "GOV"), localName = "Local_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf";File.WriteAllBytes(Path.Combine(incoming, localName), PdfBytes());
            string sharedOnly = "Shared_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf", sharedDirectory = Path.Combine(root, "Organizations", "GOV", "GOV DoD Cyber Cert");Directory.CreateDirectory(sharedDirectory);File.WriteAllBytes(Path.Combine(sharedDirectory, sharedOnly), PdfBytes());
            string manualOrganization = "MANUAL_ORG", manualOrganizationDirectory = Path.Combine(local, "Organizations", manualOrganization);Directory.CreateDirectory(manualOrganizationDirectory);Directory.CreateDirectory(Path.Combine(manualOrganizationDirectory, "Nested Organization"));Directory.CreateDirectory(Path.Combine(local, "Organizations", "SAAR"));
            int networkEnumerations = 0;PortableStorage.DirectoryEnumerationForTests = delegate(string directory) { if (directory.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || String.Equals(directory, root, StringComparison.OrdinalIgnoreCase)) { networkEnumerations++;throw new IOException("Routine lookup attempted shared-folder enumeration."); } };
            try
            {
                string working = storage.ReadWorkingManifest("local-boundary");Assert(working.Contains("local@example.mil") && working.Contains(disabledName) && working.Contains("\"disabled\":true"), "Disabled state and archived evidence associations must come from the protected local JSON database.");
                Assert(storage.ListOrganizations("local-boundary").Contains("GOV"), "Organization scope must load from local JSON and local workspace folders.");
                string[] localOrganizations = (string[])Json.Deserialize(storage.ListOrganizations("local-boundary"), typeof(string[]));
                Assert(localOrganizations.Contains(manualOrganization) && !localOrganizations.Contains("Nested Organization") && !localOrganizations.Contains("SAAR"), "A manually created local organization must be discovered even when absent from JSON; nested and reserved folders must remain excluded.");
                foreach (string suffix in new[] { " Rework", " Complete" }) Assert(Directory.Exists(Path.Combine(manualOrganizationDirectory, manualOrganization + suffix)), "A discovered local organization must receive its Rework and Complete folders.");
                Assert(!storage.ReadWorkingManifest("local-boundary").Contains(manualOrganization), "Local organization discovery must not invent user records or rewrite the JSON database.");
                Assert(!storage.ListEvidenceLocations("local-boundary").Contains(sharedOnly), "Routine location lookup must not discover unrecorded shared evidence.");
                storage.ListArchivedEvidenceLocations("local-boundary", "GOV");
                foreach (bool legacy in new[] { false, true })
                {
                    var pipeline = (Dictionary<string, object>)Json.DeserializeObject(storage.RunSyncPipeline("local-boundary", "boundary-rules", false, "GOV", legacy));var scan = (Dictionary<string, object>)pipeline["scan"];
                    Assert(Json.Serialize(scan).Contains(localName) && !Json.Serialize(scan).Contains(sharedOnly), "Neither Daily nor Legacy mode may scan shared folders without explicit Full Rescan.");
                    string run = Convert.ToString(scan["runId"]);Assert(storage.CommitSyncJournal("local-boundary", run).Contains("\"committed\":true") && storage.CommitSyncJournal("local-boundary", run).Contains("\"committed\":true"), "Local-workspace journals must commit from their own cache and remain safely repeatable.");
                    string committedJournal = Directory.EnumerateFiles(Path.GetDirectoryName(cache), "sync-" + run + ".jsonl", SearchOption.AllDirectories).SingleOrDefault();if (!String.IsNullOrWhiteSpace(committedJournal)) File.Delete(committedJournal);
                    string missingJournalCommit = storage.CommitSyncJournal("local-boundary", run);Assert(missingJournalCommit.Contains("\"committed\":true") && missingJournalCommit.Contains("\"journalMissing\":true"), "A missing or pruned Sync journal must remain an idempotent success after the database commit instead of reviving stale file actions.");
                }
                Assert(networkEnumerations == 0, "Routine status, organization, location, Archive, pipeline, and commit operations must perform zero shared-folder enumerations.");
            }
            finally { PortableStorage.DirectoryEnumerationForTests = null; }
            Assert(storage.ScanWithJournal("local-boundary", "boundary-rules", true, "GOV", false).Contains(sharedOnly), "Explicit Full Rescan must still discover network evidence.");
            Assert(storage.ReadWorkingManifest("local-boundary").Contains(disabledName), "Full discovery must preserve recorded disabled history in local JSON.");
        }
    }

    private static void RunLegacyWorkspaceRecovery(string parent)
    {
        string root = Path.Combine(parent, "legacy-workspace-recovery"), cache = Path.Combine(parent, "legacy-recovery-cache", "mappings.json");Directory.CreateDirectory(root);Directory.CreateDirectory(Path.GetDirectoryName(cache));
        var storage = new PortableStorage("DOMAIN\\recovery-operator", cache);
        try
        {
            storage.Map("legacy-recovery", root);storage.SaveManifest("legacy-recovery", Database("shared-base@example.mil"));storage.FinalizeMappedBackups();storage.VerifyLatest("legacy-recovery", "system-1");
            byte[] localCommit = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", Json.DeserializeObject(Database("unsent-local@example.mil")) }, { "csv", "local" } }));storage.SaveSystemState("legacy-recovery", localCommit);
            string workspace = storage.LocalWorkspacePath("legacy-recovery"), system = Path.Combine(workspace, "System");File.Delete(Path.Combine(system, "information-system-user-tracker.base.json"));File.Delete(Path.Combine(system, "information-system-user-tracker.base.json.sha256"));
            storage.SaveManifest("legacy-recovery", Database("newer-shared@example.mil"));storage.FinalizeMappedBackups();bool blocked = false;try { storage.VerifyLatest("legacy-recovery", "system-1"); } catch (InvalidDataException error) { blocked = error.Message.IndexOf("predates safe cross-computer reconciliation", StringComparison.OrdinalIgnoreCase) >= 0; }
            Assert(blocked, "A dirty legacy workspace without its three-way merge base must fail closed after the shared master changes.");
            var status = (Dictionary<string, object>)Json.DeserializeObject(storage.LegacyWorkspaceRecoveryStatus("legacy-recovery", "system-1"));Assert(Convert.ToBoolean(status["required"]) && !Convert.ToBoolean(status["baseSnapshotAvailable"]) && !Convert.ToBoolean(status["sharedDataWillChange"]) && Convert.ToInt32(status["userCount"]) == 1, "Guided recovery status must explain the preserved local workspace without claiming shared mutations.");
            byte[] exportRequest = Encoding.UTF8.GetBytes("{\"logicalSystemId\":\"system-1\"}"), resetRequest = Encoding.UTF8.GetBytes("{\"logicalSystemId\":\"system-1\",\"confirmation\":\"BACK UP AND RESET\"}");var review = (Dictionary<string, object>)Json.DeserializeObject(storage.ExportLegacyWorkspaceRecovery("legacy-recovery", exportRequest));string reviewPath = Convert.ToString(review["path"], CultureInfo.InvariantCulture);Assert(File.Exists(reviewPath) && File.Exists(reviewPath + ".sha256") && Convert.ToString(review["sha256"]).Length == 64, "Recovery export must create a protected SHA-256-verified review ZIP.");
            string sharedBefore = storage.ReadManifest("legacy-recovery");var recovered = (Dictionary<string, object>)Json.DeserializeObject(storage.ResetLegacyWorkspaceRecovery("legacy-recovery", resetRequest));Assert(Convert.ToBoolean(recovered["recoveryCompleted"]) && Directory.Exists(Convert.ToString(recovered["archivedWorkspacePath"], CultureInfo.InvariantCulture)) && storage.ReadWorkingManifest("legacy-recovery").Contains("newer-shared@example.mil") && storage.ReadManifest("legacy-recovery") == sharedBefore, "Recovery must archive rather than delete the stale workspace, rebuild from the newest verified shared master, and leave shared records unchanged.");
            string audit = storage.ReadAuditLogs("legacy-recovery");Assert(audit.Contains("LEGACY WORKSPACE RECOVERY EXPORT") && audit.Contains("LEGACY WORKSPACE RECOVERY COMPLETED"), "Review export and recovery completion must be recorded in the tamper-evident shared audit chain.");
        }
        finally { storage.Dispose(); }
    }

    private static byte[] TimestampedEvidenceZip(string entry, byte[] pdf, int day)
    {
        using (var memory = new MemoryStream())
        {
            byte[] bytes = EvidenceZip(entry, pdf);memory.Write(bytes, 0, bytes.Length);memory.Position = 0;
            using (var archive = new ZipArchive(memory, ZipArchiveMode.Update, true)) archive.Entries[0].LastWriteTime = new DateTimeOffset(2026, 9, day, 12, 0, 0, TimeSpan.Zero);
            return memory.ToArray();
        }
    }

    private static string PublicationCsv(string organization, string filename, string status = "Current")
    {
        string[] cells = Enumerable.Repeat("", 17).ToArray();cells[3] = organization;cells[11] = status;cells[12] = filename;
        return String.Join(",", cells.Select(value => "\"" + value.Replace("\"", "\"\"") + "\""));
    }

    private static void RunPublicationRecovery(string parent)
    {
        string shared = Path.Combine(parent, "publication-recovery-share"), cache = Path.Combine(parent, "publication-recovery", "mappings.json");Directory.CreateDirectory(shared);
        using (var storage = new PortableStorage("DOMAIN\\publication-recovery", cache))
        {
            Assert(storage.MapForFullSession("publication-recovery", shared, "publication-recovery-session"), "Publication recovery tests require an isolated editor lease.");
            var database = (Dictionary<string, object>)Json.DeserializeObject(Database("recovery@example.mil"));var user = (Dictionary<string, object>)((object[])database["users"])[0];
            storage.PublishWorkspace("publication-recovery", Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", "initial" } })));
            string workspace = storage.LocalWorkspacePath("publication-recovery"), incoming = Path.Combine(workspace, "Organizations", "GOV"), rework = Path.Combine(workspace, "Organizations", "GOV", "GOV Rework");

            string movedName = "Shaw_Vivian_(GOV)_DoD_Cyber_Cert_16OCT2026.pdf.zip", movedRelative = "Organizations/GOV/GOV DoD Cyber Cert/" + movedName;byte[] movedBytes = EvidenceZip(movedName.Substring(0, movedName.Length - 4), PdfBytes());
            storage.StoreEvidence("publication-recovery", "GOV", "DoD Cyber Cert", movedName, movedBytes);Directory.CreateDirectory(rework);File.Move(Path.Combine(incoming, movedName), Path.Combine(rework, movedName));
            user["artifacts"] = new object[] { new Dictionary<string, object> { { "kind", "DoD Cyber Cert" }, { "filename", movedName }, { "path", movedRelative }, { "sha256", Sha256(movedBytes) } } };
            var movedResult = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("publication-recovery", Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", PublicationCsv("GOV", movedName) } }))));
            Assert(File.Exists(Path.Combine(shared, movedRelative.Replace('/', Path.DirectorySeparatorChar))) && ((object[])movedResult["completionErrors"]).Length == 0, "Publication must recover a hash-matching pending file moved between local workflow folders.");
            database = (Dictionary<string, object>)movedResult["manifest"];user = (Dictionary<string, object>)((object[])database["users"])[0];

            string sharedName = "Shaw_Vivian_(GOV)_User_Agreement_16OCT2026.pdf.zip", sharedRelative = "Organizations/GOV/GOV User Agreement/" + sharedName;byte[] sharedBytes = EvidenceZip(sharedName.Substring(0, sharedName.Length - 4), PdfBytes());
            storage.StoreEvidence("publication-recovery", "GOV", "User Agreement", sharedName, sharedBytes);string sharedDestination = Path.Combine(shared, sharedRelative.Replace('/', Path.DirectorySeparatorChar));Directory.CreateDirectory(Path.GetDirectoryName(sharedDestination));File.WriteAllBytes(sharedDestination, sharedBytes);File.Delete(Path.Combine(incoming, sharedName));
            user["artifacts"] = new object[] { new Dictionary<string, object> { { "kind", "User Agreement" }, { "filename", sharedName }, { "path", sharedRelative }, { "sha256", Sha256(sharedBytes) } } };
            var sharedResult = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("publication-recovery", Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", PublicationCsv("GOV", sharedName) } }))));
            var sharedArtifact = (Dictionary<string, object>)((object[])((Dictionary<string, object>)((object[])((Dictionary<string, object>)sharedResult["manifest"])["users"])[0])["artifacts"])[0];
            Assert(Convert.ToString(sharedArtifact["path"]) == sharedRelative && Convert.ToString(sharedArtifact["sha256"]) == Sha256(sharedBytes), "A stale local entry must self-heal from an exact verified shared copy without re-uploading it.");
            database = (Dictionary<string, object>)sharedResult["manifest"];user = (Dictionary<string, object>)((object[])database["users"])[0];user["artifacts"] = new object[0];

            string orphanName = "Unused_Record_(GOV)_GEN_SAAR_16OCT2026.pdf.zip";byte[] orphanBytes = EvidenceZip(orphanName.Substring(0, orphanName.Length - 4), PdfBytes());storage.StoreEvidence("publication-recovery", "GOV", "SAAR", orphanName, orphanBytes);File.Delete(Path.Combine(incoming, orphanName));
            var orphanResult = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("publication-recovery", Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", "initial" } }))));string orphanWarnings = String.Join(" | ", ((object[])orphanResult["completionErrors"]).Select(Convert.ToString));
            Assert(orphanWarnings.Contains(orphanName) && orphanWarnings.Contains("stale unreferenced publication entry"), "An absent unreferenced pending item must be pruned with a filename-specific diagnostic instead of blocking publication.");
            database = (Dictionary<string, object>)orphanResult["manifest"];user = (Dictionary<string, object>)((object[])database["users"])[0];

            string missingName = "Shaw_Vivian_(GOV)_DoD_Cyber_Cert_15OCT2026.pdf.zip", missingRelative = "Organizations/GOV/GOV DoD Cyber Cert/" + missingName;byte[] missingBytes = EvidenceZip(missingName.Substring(0, missingName.Length - 4), PdfBytes());storage.StoreEvidence("publication-recovery", "GOV", "DoD Cyber Cert", missingName, missingBytes);File.Delete(Path.Combine(incoming, missingName));
            user["artifacts"] = new object[] { new Dictionary<string, object> { { "kind", "DoD Cyber Cert" }, { "filename", missingName }, { "path", missingRelative }, { "sha256", Sha256(missingBytes) } } };
            var missingResult = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("publication-recovery", Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", PublicationCsv("GOV", missingName) } }))));storage.FinalizeMappedBackups();string missingWarnings = String.Join(" | ", ((object[])missingResult["completionErrors"]).Select(Convert.ToString));var missingUser = (Dictionary<string, object>)((object[])((Dictionary<string, object>)missingResult["manifest"])["users"])[0];
            string backup = File.ReadAllText(Path.Combine(shared, "System", "backup", "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".csv"));
            Assert(((object[])missingUser["artifacts"]).Length == 0 && missingWarnings.Contains(missingName) && missingWarnings.Contains("isolated as Missing") && missingWarnings.Contains("Organizations/GOV/") && backup.Contains("\"Missing\",\"\"") && !backup.Contains(missingName), "Genuinely absent referenced evidence must be isolated as Missing with its filename and expected local location while unrelated publication continues and the CSV remains consistent.");
            storage.ReleaseLease("publication-recovery", "publication-recovery-session");
        }
    }

    private static void RunPublicationCollisions(string parent)
    {
        string shared = Path.Combine(parent, "publish-collisions"), cache = Path.Combine(parent, "pc", "mappings.json");Directory.CreateDirectory(shared);
        using (var storage = new PortableStorage("DOMAIN\\publication", cache))
        {
            Assert(storage.MapForFullSession("collisions", shared, "collision-session"), "Publication collision tests require an isolated editor lease.");
            var database = (Dictionary<string, object>)Json.DeserializeObject(Database("collisions@example.mil"));var user = (Dictionary<string, object>)((object[])database["users"])[0];
            storage.PublishWorkspace("collisions", Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", "initial" } })));
            string filename = "Shaw_Vivian_(GOV)_GEN_SAAR_25SEP2026.pdf.zip", relative = "Organizations/GOV/GOV SAAR/" + filename, destination = Path.Combine(shared, relative.Replace('/', Path.DirectorySeparatorChar));
            byte[] localZip = TimestampedEvidenceZip(filename.Substring(0, filename.Length - 4), PdfBytes(), 25), sharedZip = TimestampedEvidenceZip(filename.Substring(0, filename.Length - 4), PdfBytes(), 26);
            Assert(Sha256(localZip) != Sha256(sharedZip), "The duplicate fixture must contain the same PDF in different ZIP containers.");
            storage.StoreEvidence("collisions", "GOV", "SAAR", filename, localZip);Directory.CreateDirectory(Path.GetDirectoryName(destination));File.WriteAllBytes(destination, sharedZip);
            user["artifacts"] = new object[] { new Dictionary<string, object> { { "kind", "SAAR" }, { "filename", filename }, { "path", relative }, { "sha256", Sha256(localZip) } } };
            string csv = String.Join(",", Enumerable.Repeat("\"Unchanged, field\"", 12).Concat(new[] { "\"" + filename + "\"" }));
            byte[] request = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", csv } }));
            int sharedEvidenceEnumerations = 0;PortableStorage.DirectoryEnumerationForTests = path => { if (path.StartsWith(Path.Combine(shared, "Organizations"), StringComparison.OrdinalIgnoreCase)) sharedEvidenceEnumerations++; };
            try
            {
                var duplicate = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("collisions", request));
                var savedArtifact = (Dictionary<string, object>)((object[])((Dictionary<string, object>)((object[])((Dictionary<string, object>)duplicate["manifest"])["users"])[0])["artifacts"])[0];
                Assert(Convert.ToInt32(duplicate["reusedFiles"]) == 1 && Convert.ToString(savedArtifact["sha256"]) == Sha256(sharedZip) && File.ReadAllBytes(destination).SequenceEqual(sharedZip), "Identical PDF content must reuse the existing shared ZIP and record its container hash without replacing shared bytes.");
                string workspace = storage.LocalWorkspacePath("collisions"), mapPath = Path.Combine(workspace, "System", "workspace-evidence.json");
                string clearMap = Convert.ToString(typeof(PortableStorage).GetMethod("ReadProtectedLocalJson", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(storage, new object[] { mapPath, "workspace-evidence", 50L * 1024 * 1024 }));
                Assert(clearMap.Contains(Sha256(localZip)) && clearMap.Contains(Sha256(sharedZip)), "Protected receipts must retain separate local and shared container hashes.");
                string manifest = Path.Combine(shared, "System", "information-system-user-tracker.json"), duplicateManifestHash = Sha256(File.ReadAllBytes(manifest));storage.PublishWorkspace("collisions", request);
                Assert(Sha256(File.ReadAllBytes(manifest)) == duplicateManifestHash && storage.ReadWorkingManifest("collisions").Contains(Sha256(sharedZip)), "Retrying stale browser state must retain the reused shared ZIP hash.");

                string archiveName = "Chen_Henry_(GOV)_PRIV_DEV_SAAR_25SEP2026.pdf.zip";byte[] changedPdf = Encoding.ASCII.GetBytes("%PDF-1.4\n% distinct archived evidence\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"), archiveZip = TimestampedEvidenceZip(archiveName.Substring(0, archiveName.Length - 4), changedPdf, 25), existingArchiveZip = TimestampedEvidenceZip(archiveName.Substring(0, archiveName.Length - 4), PdfBytes(), 25);
                storage.StoreEvidence("collisions", "GOV", "SAAR", archiveName, archiveZip);
                string archive = Convert.ToString(((Dictionary<string, object>)Json.DeserializeObject(storage.ArchiveEvidence("collisions", "Organizations/GOV/GOV SAAR/" + archiveName)))["archived"]), archiveDestination = Path.Combine(shared, archive.Replace('/', Path.DirectorySeparatorChar));Directory.CreateDirectory(Path.GetDirectoryName(archiveDestination));File.WriteAllBytes(archiveDestination, existingArchiveZip);
                user["artifacts"] = new object[] { new Dictionary<string, object> { { "kind", "SAAR" }, { "filename", archiveName }, { "path", archive }, { "sha256", Sha256(archiveZip) } } };
                request = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", csv.Replace(filename, archiveName) } }));
                string conflictName = archiveName.Substring(0, archiveName.Length - 8) + "_CONFLICT_" + Sha256(changedPdf).Substring(0, 8).ToUpperInvariant() + ".pdf.zip", conflictDestination = Path.Combine(Path.GetDirectoryName(archiveDestination), conflictName);
                PortableStorage.FailAfterStageForTests = "publication-evidence-copy";bool interruptedCopy = false;
                try { storage.PublishWorkspace("collisions", request); } catch (IOException error) { interruptedCopy = error.Message.Contains("Injected interruption"); }
                Assert(interruptedCopy && File.Exists(conflictDestination) && File.ReadAllBytes(archiveDestination).SequenceEqual(existingArchiveZip) && Sha256(File.ReadAllBytes(manifest)) == duplicateManifestHash && storage.ReadWorkingManifest("collisions").Contains(conflictName), "A distinct archive PDF must keep both versions and persist resolved local references before a failed transfer can affect the master JSON.");
                string publicationJournal = Path.Combine(workspace, "System", "workspace-publication.json");
                string clearJournal = Convert.ToString(typeof(PortableStorage).GetMethod("ReadProtectedLocalJson", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(storage, new object[] { publicationJournal, "workspace-publication", 50L * 1024 * 1024 }));
                Assert(clearJournal.Contains(conflictName) && clearJournal.Contains("sourceSha256"), "The recovery journal must record the resolved archive destination and local source hash.");
                string publicationProgress = Path.Combine(workspace, "System", "workspace-publication-progress.jsonl");Assert(File.Exists(publicationProgress) && new FileInfo(publicationProgress).Length > 0, "Per-file publication progress must append to a bounded protected journal instead of rewriting the full recovery plan.");
                PortableStorage.FailAfterStageForTests = "publication-manifest-committed";bool interruptedCompletion = false;
                try { storage.PublishWorkspace("collisions", request); } catch (IOException error) { interruptedCompletion = error.Message.Contains("Injected interruption"); }
                Assert(interruptedCompletion, "The retry fixture must interrupt after the shared master was committed.");
                var recovered = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("collisions", request));storage.FinalizeMappedBackups();
                Assert(Convert.ToInt32(recovered["archivedConflicts"]) == 1 && File.ReadAllBytes(conflictDestination).SequenceEqual(archiveZip) && File.ReadAllBytes(archiveDestination).SequenceEqual(existingArchiveZip) && Directory.GetFiles(Path.GetDirectoryName(archiveDestination), "*_CONFLICT_*.zip").Length == 1 && storage.ReadWorkingManifest("collisions").Contains(conflictName), "Repeated interrupted publication must reuse the same deterministic conflict filename and preserve both archive versions.");
                Assert(File.ReadAllText(Path.Combine(shared, "System", "backup", "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".csv")).Contains(conflictName), "CSV references must follow the resolved archived evidence filename.");
                string recoveredHash = Sha256(File.ReadAllBytes(manifest));storage.PublishWorkspace("collisions", request);Assert(Sha256(File.ReadAllBytes(manifest)) == recoveredHash, "A completed archive conflict must reconcile stale browser references on later retries.");
                ((Dictionary<string, object>)((object[])user["artifacts"])[0]).Remove("sha256");storage.PublishWorkspace("collisions", Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", csv.Replace(filename, archiveName) } })));Assert(Sha256(File.ReadAllBytes(manifest)) == recoveredHash, "Legacy browser references without a stored hash must reuse the protected publication receipt on retry.");
                Assert(!Directory.Exists(Path.Combine(workspace, "Organizations", "GOV", "GOV SAAR Archive")), "Archive collision resolution must not create local Archive folders.");

                // Legacy local archive files have no routing-map entry.
                string legacyName = "Legacy_User_(GOV)_GEN_SAAR_24SEP2026.pdf.zip", legacyRelative = "Organizations/GOV/GOV SAAR Archive/" + legacyName, legacyLocal = Path.Combine(workspace, legacyRelative.Replace('/', Path.DirectorySeparatorChar)), legacyShared = Path.Combine(shared, legacyRelative.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(legacyLocal));File.WriteAllBytes(legacyLocal, TimestampedEvidenceZip(legacyName.Substring(0, legacyName.Length - 4), changedPdf, 25));File.WriteAllBytes(legacyShared, TimestampedEvidenceZip(legacyName.Substring(0, legacyName.Length - 4), PdfBytes(), 25));
                File.Delete(Path.Combine(workspace, "System", "workspace-evidence-map.v2"));
                var legacy = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("collisions", Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", recovered["manifest"] }, { "csv", csv } }))));Assert(Convert.ToInt32(legacy["archivedConflicts"]) == 1 && !File.Exists(legacyLocal), "Legacy local archives must use the same conflict-preserving publication rules.");

                storage.StoreEvidence("collisions", "GOV", "SAAR", filename, TimestampedEvidenceZip(filename.Substring(0, filename.Length - 4), changedPdf, 25));
                string beforeActiveConflict = Sha256(File.ReadAllBytes(manifest));bool blockedActive = false;
                try { storage.PublishWorkspace("collisions", Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", legacy["manifest"] }, { "csv", csv } }))); } catch (InvalidDataException error) { blockedActive = error.Message.Contains("different shared evidence file"); }
                Assert(blockedActive && File.ReadAllBytes(destination).SequenceEqual(sharedZip) && Sha256(File.ReadAllBytes(manifest)) == beforeActiveConflict, "Different active evidence must remain blocked without changing the shared file or master JSON.");
                Assert(sharedEvidenceEnumerations == 0, "Publication collision checks must read exact shared destinations without enumerating network evidence folders.");
            }
            finally { PortableStorage.DirectoryEnumerationForTests = null;PortableStorage.FailAfterStageForTests = null;storage.ReleaseLease("collisions", "collision-session"); }
        }
    }

    private static void RunLocalWorkflowLayout(string parent)
    {
        string shared = Path.Combine(parent, "workflow-layout-share"), cache = Path.Combine(parent, "workflow-layout", "mappings.json"), retainedPath = "", cachedPath = "";byte[] cachedBytes = null;
        Directory.CreateDirectory(shared);
        using (var storage = new PortableStorage("DOMAIN\\layout", cache))
        {
            Assert(storage.MapForFullSession("layout", shared, "layout-session"), "The local workflow test requires its own isolated editor lease.");
            var database = (Dictionary<string, object>)Json.DeserializeObject(Database("layout@example.mil"));
            byte[] initial = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", "initial" } }));var initialized = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("layout", initial));
            Assert(!Convert.ToBoolean(initialized["evidenceFastPath"]) && !Convert.ToBoolean(initialized["noChanges"]), "The first publication must retain one-time legacy evidence recovery instead of taking the routine fast path.");
            byte[] initialStatusRequest = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "stateHash", initialized["stateHash"] } }));var initialStatus = (Dictionary<string, object>)Json.DeserializeObject(storage.WorkspaceStatus("layout", initialStatusRequest));
            Assert(Convert.ToBoolean(initialStatus["noChanges"]) && !Convert.ToBoolean(initialStatus["databaseChangePending"]) && Convert.ToInt32(initialStatus["pendingEvidenceCount"]) == 0 && !Convert.ToBoolean(initialStatus["interruptedRecovery"]) && !Convert.ToBoolean(initialStatus["evidenceWorkPending"]), "The local workspace status must answer a clean Session Commit from persisted constant-time metadata.");
            var noChanges = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("layout", initial));
            Assert(Convert.ToBoolean(noChanges["evidenceFastPath"]) && Convert.ToBoolean(noChanges["noChanges"]) && IsSha256(Convert.ToString(noChanges["stateHash"], CultureInfo.InvariantCulture)) && Convert.ToInt32(noChanges["publishedFiles"]) == 0 && Convert.ToInt32(noChanges["compressedForPublication"]) == 0, "A Session Commit with no database or evidence changes must return its verified state hash without evidence work or rewrites.");
            var databaseOnlyUser = (Dictionary<string, object>)((object[])database["users"])[0];databaseOnlyUser["email"] = "database-only@example.mil";byte[] databaseOnlyRequest = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", "database-only" } }));
            bool databaseMetadataInterrupted = false;PortableStorage.FailAfterStageForTests = "local-workspace-database-before-state";
            try { storage.SaveSystemState("layout", databaseOnlyRequest); }
            catch (IOException) { databaseMetadataInterrupted = true; }
            finally { PortableStorage.FailAfterStageForTests = null; }
            var interruptedDatabaseStatus = (Dictionary<string, object>)Json.DeserializeObject(storage.WorkspaceStatus("layout", initialStatusRequest));Assert(databaseMetadataInterrupted && !Convert.ToBoolean(interruptedDatabaseStatus["metadataCurrent"]) && Convert.ToBoolean(interruptedDatabaseStatus["databaseChangePending"]) && !Convert.ToBoolean(interruptedDatabaseStatus["noChanges"]), "An interruption between the protected database and state metadata must remain dirty and force conservative recovery.");storage.SaveSystemState("layout", databaseOnlyRequest);
            var databaseOnly = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("layout", databaseOnlyRequest));
            Assert(Convert.ToBoolean(databaseOnly["evidenceFastPath"]) && !Convert.ToBoolean(databaseOnly["noChanges"]) && IsSha256(Convert.ToString(databaseOnly["stateHash"], CultureInfo.InvariantCulture)) && Convert.ToInt32(databaseOnly["publishedFiles"]) == 0 && Convert.ToInt32(databaseOnly["compressedForPublication"]) == 0 && storage.ReadManifest("layout").Contains("database-only@example.mil"), "A JSON-only change must return its committed state hash and publish the database without scanning, compressing, hashing, or verifying evidence.");
            string workspace = storage.LocalWorkspacePath("layout"), incoming = Path.Combine(workspace, "Organizations", "GOV");
            string reviewMarker = Path.Combine(workspace, "System", "workspace-review-required.flag");File.WriteAllText(reviewMarker, "before-review");MethodInfo beginReview = typeof(PortableStorage).GetMethod("BeginLocalWorkspaceReview", BindingFlags.Instance | BindingFlags.NonPublic), completeReview = typeof(PortableStorage).GetMethod("CompleteLocalWorkspaceReview", BindingFlags.Instance | BindingFlags.NonPublic);object staleReview = beginReview.Invoke(storage, new object[] { "layout", workspace });File.WriteAllText(reviewMarker, "changed-during-review");completeReview.Invoke(storage, new[] { staleReview });Assert(File.Exists(reviewMarker), "Completing an older workspace review must not erase a newer local-folder change marker.");object currentReview = beginReview.Invoke(storage, new object[] { "layout", workspace });completeReview.Invoke(storage, new[] { currentReview });Assert(!File.Exists(reviewMarker), "A successful current workspace review must clear its persistent marker and in-memory exposure.");var reviewedStatus = (Dictionary<string, object>)Json.DeserializeObject(storage.WorkspaceStatus("layout", Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "stateHash", databaseOnly["stateHash"] } }))));Assert(Convert.ToBoolean(reviewedStatus["noChanges"]), "Clearing a successful review must restore the constant-time clean status instead of rescanning the exposed workspace forever.");
            string zipName = "Shaw_Vivian_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf.zip";byte[] zipBytes = EvidenceZip(zipName.Substring(0, zipName.Length - 4), PdfBytes());bool evidenceMetadataInterrupted = false;PortableStorage.FailAfterStageForTests = "local-evidence-map-before-count";
            try { storage.StoreEvidence("layout", "GOV", "DoD Cyber Cert", zipName, zipBytes); }
            catch (IOException) { evidenceMetadataInterrupted = true; }
            finally { PortableStorage.FailAfterStageForTests = null; }
            byte[] interruptedEvidenceStatusRequest = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "stateHash", databaseOnly["stateHash"] } }));var interruptedEvidenceStatus = (Dictionary<string, object>)Json.DeserializeObject(storage.WorkspaceStatus("layout", interruptedEvidenceStatusRequest));
            Assert(evidenceMetadataInterrupted && !Convert.ToBoolean(interruptedEvidenceStatus["metadataCurrent"]) && Convert.ToBoolean(interruptedEvidenceStatus["evidenceWorkPending"]) && !Convert.ToBoolean(interruptedEvidenceStatus["noChanges"]), "An interruption between the evidence map and pending-count update must invalidate constant-time metadata and force conservative recovery.");storage.StoreEvidence("layout", "GOV", "DoD Cyber Cert", zipName, zipBytes);
            byte[] pendingStatusRequest = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "stateHash", databaseOnly["stateHash"] } }));var pendingStatus = (Dictionary<string, object>)Json.DeserializeObject(storage.WorkspaceStatus("layout", pendingStatusRequest));
            Assert(!Convert.ToBoolean(pendingStatus["noChanges"]) && !Convert.ToBoolean(pendingStatus["databaseChangePending"]) && Convert.ToInt32(pendingStatus["pendingEvidenceCount"]) == 1 && Convert.ToBoolean(pendingStatus["evidenceWorkPending"]), "Persisted evidence metadata must expose pending local publication work without enumerating workspace folders.");
            string transactionDirectory = Path.Combine(workspace, "System", "Storage Transactions"), transactionMarker = Path.Combine(transactionDirectory, "pending.flag");Directory.CreateDirectory(transactionDirectory);File.WriteAllText(transactionMarker, "1");var interruptedStatus = (Dictionary<string, object>)Json.DeserializeObject(storage.WorkspaceStatus("layout", pendingStatusRequest));File.Delete(transactionMarker);
            Assert(Convert.ToBoolean(interruptedStatus["interruptedRecovery"]) && Convert.ToBoolean(interruptedStatus["evidenceWorkPending"]), "The local workspace status must surface an interrupted file transaction from its constant-time marker.");
            string zipPath = "Organizations/GOV/GOV DoD Cyber Cert/" + zipName;
            var renamed = (Dictionary<string, object>)Json.DeserializeObject(storage.RelabelUserEvidence("layout", zipPath, "EDITORG", "DoD Cyber Cert", "Shaw_Vivian_(EDITORG)_DoD_Cyber_Cert_24AUG2026.pdf.zip"));
            Assert(File.Exists(LocalEvidenceFile(storage, "layout", Convert.ToString(renamed["path"]))) && !Directory.Exists(Path.Combine(workspace, "Organizations", "EDITORG", "EDITORG DoD Cyber Cert")), "Identity edits must stage at the organization root without creating a local document-type folder.");
            string pdfUploadName = "Shaw_Vivian_(GOV)_User_Agreement_24AUG2026.pdf.zip";var pdfUpload = (Dictionary<string, object>)Json.DeserializeObject(storage.StoreEvidencePdf("layout", "GOV", "User Agreement", pdfUploadName, PdfBytes()));
            Assert(File.Exists(Path.Combine(incoming, pdfUploadName)) && storage.VerifyStoredEvidencePdf("layout", "GOV", "User Agreement", pdfUploadName, Sha256(PdfBytes())).Contains("\"stored\":true") && Convert.ToString(pdfUpload["path"]).StartsWith("Organizations/GOV/GOV User Agreement/", StringComparison.Ordinal), "Manual PDF inputs must be accepted, verified, and zipped at the local organization root without creating document-type folders.");
            string originalSaar = "Shaw_Vivian_(GOV)_GEN_SAAR_24AUG2026.pdf", correctedSaar = "Shaw_Vivian_(GOV)_GEN_SAAR_25AUG2026.pdf";File.WriteAllBytes(Path.Combine(incoming, originalSaar), PdfBytes());
            var organized = (Dictionary<string, object>)Json.DeserializeObject(storage.OrganizeEvidence("layout", "Organizations/GOV/" + originalSaar, "SAAR"));
            var normalized = (Dictionary<string, object>)Json.DeserializeObject(storage.NormalizeEvidenceFilename("layout", Convert.ToString(organized["organized"]), correctedSaar));
            var compressed = (Dictionary<string, object>)Json.DeserializeObject(storage.CompressEvidence("layout", Convert.ToString(normalized["renamed"])));
            Assert(storage.CompressEvidence("layout", Convert.ToString(normalized["renamed"])).Contains("\"alreadyCompleted\":true"), "Compression through a staged logical path must remain repeatable.");
            var archived = (Dictionary<string, object>)Json.DeserializeObject(storage.ArchiveEvidence("layout", Convert.ToString(compressed["compressed"])));retainedPath = Convert.ToString(archived["archived"]);
            string pendingUpload = Path.Combine(workspace, "Organizations", "GOV", "GOV Complete", "Pending Upload");int retainedBeforeRetry = Directory.EnumerateFiles(pendingUpload).Count();var repeatedArchive = (Dictionary<string, object>)Json.DeserializeObject(storage.ArchiveEvidence("layout", Convert.ToString(compressed["compressed"])));int retainedAfterRetry = Directory.EnumerateFiles(pendingUpload).Count();
            Assert(Convert.ToBoolean(repeatedArchive["alreadyCompleted"]) && Convert.ToString(repeatedArchive["archived"]) == retainedPath && retainedBeforeRetry == retainedAfterRetry, "Retrying a completed local archive through its stale source path must resolve the pending upload without creating a second copy.");
            Assert(File.Exists(LocalEvidenceFile(storage, "layout", retainedPath)) && !Directory.Exists(Path.Combine(workspace, "Organizations", "GOV", "GOV SAAR Archive")), "Local archival must stage the ZIP in Pending Upload while tracking its shared archive destination in protected JSON.");
            string archiveOnlyPdf = "Archive_Only_(GOV)_GEN_SAAR_01JAN2025.pdf";File.WriteAllBytes(Path.Combine(incoming, archiveOnlyPdf), PdfBytes());
            var archiveOnly = (Dictionary<string, object>)Json.DeserializeObject(storage.ArchiveEvidence("layout", "Organizations/GOV/" + archiveOnlyPdf));
            string autoPdf = "Shaw_Vivian_(GOV)_GEN_SAAR_26AUG2026.pdf";File.WriteAllBytes(Path.Combine(incoming, autoPdf), PdfBytes());
            var autoOrganized = (Dictionary<string, object>)Json.DeserializeObject(storage.OrganizeEvidence("layout", "Organizations/GOV/" + autoPdf, "SAAR"));
            Assert(Convert.ToString(autoOrganized["organized"]).StartsWith("Organizations/GOV/GOV SAAR/", StringComparison.Ordinal), "Organization must return its tracked shared destination without making that directory locally.");
            string looseAssociatedPdf = "Shaw_Vivian_(GOV)_DoD_Cyber_Cert_25AUG2026.pdf", looseAssociatedPath = Path.Combine(workspace, "Organizations", "GOV", looseAssociatedPdf), looseAssociatedDestination = "Organizations/GOV/GOV DoD Cyber Cert/" + looseAssociatedPdf;File.WriteAllBytes(looseAssociatedPath, PdfBytes());
            string directZipName = "Shaw_Vivian_(GOV)_Priv_User_Training_25AUG2026.pdf.zip", directZipPath = Path.Combine(incoming, directZipName), directZipDestination = "Organizations/GOV/GOV Privileged User Training/" + directZipName;byte[] directZipBytes = EvidenceZip(directZipName.Substring(0, directZipName.Length - 4), PdfBytes());File.WriteAllBytes(directZipPath, directZipBytes);
            var user = (Dictionary<string, object>)((object[])database["users"])[0];user["artifacts"] = new object[] { new Dictionary<string, object> { { "kind", "SAAR" }, { "filename", autoPdf }, { "sha256", Sha256(PdfBytes()) } }, new Dictionary<string, object> { { "kind", "DoD Cyber Cert" }, { "filename", looseAssociatedPdf }, { "path", looseAssociatedDestination }, { "sha256", Sha256(PdfBytes()) } }, new Dictionary<string, object> { { "kind", "Privileged User Training" }, { "filename", directZipName }, { "path", directZipDestination }, { "sha256", Sha256(directZipBytes) } } };
            string orphanPdf = Path.Combine(workspace, "Organizations", "GOV", "Gendell_Mark_(GOV)_PRIV_ADM_SAAR_06SEP2023.pdf");File.WriteAllBytes(orphanPdf, PdfBytes());
            string csv = String.Join(",", Enumerable.Repeat("\"Unchanged, field\"", 12).Concat(new[] { "\"" + autoPdf + "\"", "\"No\"" }));
            byte[] publication = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", csv } }));
            var result = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("layout", publication));storage.FinalizeMappedBackups();
            Assert(Convert.ToInt32(result["compressedForPublication"]) == 3 && Convert.ToInt32(result["deferredLocalPdfs"]) == 0, "Publication must recover and ZIP associated PDFs from stale logical paths plus locally staged PDFs without walking unrelated local files; Daily Sync remains responsible for unassociated loose evidence.");
            var savedUser = (Dictionary<string, object>)((object[])((Dictionary<string, object>)result["manifest"])["users"])[0];var artifact = (Dictionary<string, object>)((object[])savedUser["artifacts"])[0];cachedPath = Convert.ToString(artifact["path"]);
            Assert(Convert.ToString(artifact["filename"]) == autoPdf + ".zip" && File.Exists(Path.Combine(shared, cachedPath.Replace('/', Path.DirectorySeparatorChar))) && File.Exists(Path.Combine(shared, retainedPath.Replace('/', Path.DirectorySeparatorChar))), "Shared publication must contain verified ZIPs in the authoritative document-type and SAAR Archive destinations.");
            var savedCyber = (Dictionary<string, object>)((object[])savedUser["artifacts"])[1];Assert(Convert.ToString(savedCyber["filename"]) == looseAssociatedPdf + ".zip" && File.Exists(Path.Combine(shared, Convert.ToString(savedCyber["path"]).Replace('/', Path.DirectorySeparatorChar))), "A locally associated loose PDF with a stale canonical path must be recovered, compressed, and published instead of blocking the session commit.");
            var savedTraining = (Dictionary<string, object>)((object[])savedUser["artifacts"])[2];Assert(Convert.ToString(savedTraining["filename"]) == directZipName && File.Exists(Path.Combine(shared, Convert.ToString(savedTraining["path"]).Replace('/', Path.DirectorySeparatorChar))) && !File.Exists(directZipPath), "A pre-zipped database artifact at the organization root must be registered, published, and moved to Complete during Session Commit.");
            Assert(File.Exists(Path.Combine(shared, (Convert.ToString(archiveOnly["archived"]) + ".zip").Replace('/', Path.DirectorySeparatorChar))), "A retained PDF must be zipped before its explicit archive destination is published, even without an active user association.");
            Assert(File.Exists(orphanPdf) && !File.Exists(Path.Combine(shared, "Organizations", "GOV", Path.GetFileName(orphanPdf))) && !File.Exists(Path.Combine(incoming, autoPdf)), "An unfinished unassociated PDF must stay local, while each successfully compressed associated PDF is removed.");
            string publishedEvidence = Path.Combine(workspace, "Organizations", "GOV", "GOV Complete");Assert(Directory.Exists(publishedEvidence) && Directory.EnumerateFiles(publishedEvidence).Any() && (!Directory.Exists(pendingUpload) || !Directory.EnumerateFileSystemEntries(pendingUpload).Any()) && !Directory.Exists(Path.Combine(workspace, "Organizations", "GOV", "GOV Complete", "Retained Evidence")) && !Directory.Exists(Path.Combine(publishedEvidence, "Published Evidence")), "A successful Session Commit must drain Pending Upload directly into Complete and remove legacy publication folders.");
            Assert(Directory.EnumerateFiles(incoming).Select(Path.GetFileName).SequenceEqual(new[] { Path.GetFileName(orphanPdf) }), "A successful Session Commit must move every published GOV item out of the organization intake root while preserving unrelated loose evidence for review.");
            string originals = Path.Combine(workspace, "Organizations", "GOV", "GOV Complete", "Original PDFs");int originalCount = Directory.Exists(originals) ? Directory.EnumerateFiles(originals).Count() : 0;Assert(originalCount == 0, "Successfully compressed source PDFs must not be retained in local Complete.");
            Assert(File.ReadAllText(Path.Combine(shared, "System", "backup", "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".csv")).Contains("\"" + autoPdf + ".zip\"") && File.ReadAllText(Path.Combine(shared, "System", "backup", "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".csv")).StartsWith("\"Unchanged, field\"", StringComparison.Ordinal), "The CSV backup must update only its Filename field after automatic publication compression.");
            string sharedCurrent = Path.Combine(shared, cachedPath.Replace('/', Path.DirectorySeparatorChar));byte[] originalSharedZip = File.ReadAllBytes(sharedCurrent), changedSharedZip = EvidenceZip(autoPdf, Encoding.ASCII.GetBytes("%PDF-1.4\n% changed evidence\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"));
            File.WriteAllBytes(sharedCurrent, changedSharedZip);Assert(storage.ReadRelativeFile("layout", cachedPath).SequenceEqual(changedSharedZip), "A published Complete copy must not hide later changes to authoritative shared evidence.");File.WriteAllBytes(sharedCurrent, originalSharedZip);
            byte[] repackagedDuplicate = TimestampedEvidenceZip(directZipName.Substring(0, directZipName.Length - 4), PdfBytes(), 26);Assert(Sha256(repackagedDuplicate) != Sha256(directZipBytes), "The duplicate-publication test requires differently packaged ZIP containers.");File.WriteAllBytes(directZipPath, repackagedDuplicate);storage.PublishWorkspace("layout", publication);Assert((Directory.Exists(originals) ? Directory.EnumerateFiles(originals).Count() : 0) == originalCount, "Retrying an older PDF request must reuse its prepared ZIP without retaining an original PDF.");Assert(!File.Exists(directZipPath), "Retrying Session Commit must verify and drain a duplicate organization-root ZIP even when an older Complete receipt already exists and the duplicate ZIP packaging differs.");
            foreach (string orgDirectory in Directory.EnumerateDirectories(Path.Combine(workspace, "Organizations")))
            {
                string organization = Path.GetFileName(orgDirectory);string[] folders = Directory.EnumerateDirectories(orgDirectory).Select(Path.GetFileName).OrderBy(value => value).ToArray();
                Assert(folders.SequenceEqual(new[] { organization + " Complete", organization + " Rework" }.OrderBy(value => value)), "Upload, organization, normalization, compression, identity edit, archival, and publication must leave only Rework and Complete at each local organization root.");
                Assert(!Directory.EnumerateDirectories(orgDirectory, "*", SearchOption.AllDirectories).Any(path => Path.GetFileName(path).EndsWith(" SAAR Archive", StringComparison.OrdinalIgnoreCase) || Path.GetFileName(path).EndsWith(" DoD Cyber Cert", StringComparison.OrdinalIgnoreCase) || Path.GetFileName(path).EndsWith(" SAAR", StringComparison.OrdinalIgnoreCase)), "No document-type or SAAR Archive folder may be created anywhere in the local organization tree.");
                string organizationPending = Path.Combine(orgDirectory, organization + " Complete", "Pending Upload");
                Assert(Directory.EnumerateFiles(orgDirectory).All(path => String.Equals(Path.GetFileName(path), Path.GetFileName(orphanPdf), StringComparison.OrdinalIgnoreCase)) && (!Directory.Exists(organizationPending) || !Directory.EnumerateFileSystemEntries(organizationPending).Any()), "A successful Session Commit must drain every published organization-root file and Pending Upload item while preserving unrelated loose evidence.");
            }
            string retryName = "Shaw_Vivian_(GOV)_GEN_SAAR_27AUG2026.pdf";File.WriteAllBytes(Path.Combine(incoming, retryName), PdfBytes());
            var retryOrganized = (Dictionary<string, object>)Json.DeserializeObject(storage.OrganizeEvidence("layout", "Organizations/GOV/" + retryName, "SAAR"));
            user["artifacts"] = new object[] { new Dictionary<string, object> { { "kind", "SAAR" }, { "filename", retryName }, { "path", retryOrganized["organized"] }, { "sha256", Sha256(PdfBytes()) } } };
            byte[] retryRequest = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", database }, { "csv", csv.Replace(autoPdf, retryName) } }));
            string retryDestination = Path.Combine(shared, (Convert.ToString(retryOrganized["organized"]) + ".zip").Replace('/', Path.DirectorySeparatorChar));Directory.CreateDirectory(Path.GetDirectoryName(retryDestination));File.WriteAllBytes(retryDestination, new byte[] { 9, 8, 7 });
            string priorManifestHash = Sha256(File.ReadAllBytes(Path.Combine(shared, "System", "information-system-user-tracker.json")));bool publicationFailed = false;
            try { storage.PublishWorkspace("layout", retryRequest); } catch (InvalidDataException error) { publicationFailed = error.Message.Contains("different shared evidence file"); }
            Assert(publicationFailed && Sha256(File.ReadAllBytes(Path.Combine(shared, "System", "information-system-user-tracker.json"))) == priorManifestHash && File.ReadAllBytes(retryDestination).SequenceEqual(new byte[] { 9, 8, 7 }), "A failed publication after compression must preserve the master JSON and conflicting shared evidence.");
            int originalsAfterFailure = Directory.Exists(originals) ? Directory.EnumerateFiles(originals).Count() : 0;Assert(!File.Exists(Path.Combine(incoming, retryName)) && originalsAfterFailure == originalCount && storage.ReadWorkingManifest("layout").Contains(retryName + ".zip"), "A failed upload must keep its prepared ZIP in the protected local workspace with updated local JSON without retaining the source PDF.");
            File.Delete(retryDestination);var retried = (Dictionary<string, object>)Json.DeserializeObject(storage.PublishWorkspace("layout", retryRequest));Assert(Convert.ToInt32(retried["compressedForPublication"]) == 0 && File.Exists(retryDestination) && (Directory.Exists(originals) ? Directory.EnumerateFiles(originals).Count() : 0) == originalsAfterFailure, "Retry must reuse the already verified local ZIP without recreating an original PDF.");
            cachedBytes = storage.ReadRelativeFile("layout", cachedPath);string mapText = File.ReadAllText(Path.Combine(workspace, "System", "workspace-evidence.json"));Assert(mapText.Contains("DPAPI-CurrentUser") && !mapText.Contains(autoPdf), "The local evidence routing map must be protected by Windows DPAPI.");
            storage.ReleaseLease("layout", "layout-session");
            string remapA = Path.Combine(parent, "workspace-watcher-remap-a"), remapB = Path.Combine(parent, "workspace-watcher-remap-b");Directory.CreateDirectory(remapA);Directory.CreateDirectory(remapB);
            Assert(storage.MapForFullSession("workspace-watcher-remap", remapA, "workspace-watcher-remap-session"), "The workspace-watcher remap test must acquire its first isolated mapping.");string oldRemapWorkspace = storage.LocalWorkspacePath("workspace-watcher-remap");storage.ReleaseLease("workspace-watcher-remap", "workspace-watcher-remap-session");
            Assert(storage.MapForFullSession("workspace-watcher-remap", remapB, "workspace-watcher-remap-session"), "The workspace-watcher remap test must acquire its replacement mapping.");string currentRemapWorkspace = storage.LocalWorkspacePath("workspace-watcher-remap");FieldInfo watcherRootsField = typeof(PortableStorage).GetField("workspaceStatusWatcherRoots", BindingFlags.Instance | BindingFlags.NonPublic);var watcherRoots = (Dictionary<string, string>)watcherRootsField.GetValue(storage);Assert(!String.Equals(oldRemapWorkspace, currentRemapWorkspace, StringComparison.OrdinalIgnoreCase) && String.Equals(watcherRoots["workspace-watcher-remap"], currentRemapWorkspace, StringComparison.OrdinalIgnoreCase), "Remapping a system must dispose its old local watcher and bind review tracking to the replacement workspace.");MethodInfo markWorkspaceChanged = typeof(PortableStorage).GetMethod("MarkLocalWorkspaceChanged", BindingFlags.Instance | BindingFlags.NonPublic);markWorkspaceChanged.Invoke(storage, new object[] { "workspace-watcher-remap", oldRemapWorkspace });Assert(!File.Exists(Path.Combine(oldRemapWorkspace, "System", "workspace-review-required.flag")), "A callback from the disposed watcher must not mark the prior workspace after remapping.");storage.ReleaseLease("workspace-watcher-remap", "workspace-watcher-remap-session");
        }
        using (var reopened = new PortableStorage("DOMAIN\\layout", cache))
        {
            reopened.MapReadOnly("layout", shared);Assert(reopened.ReadRelativeFile("layout", cachedPath).SequenceEqual(cachedBytes) && reopened.ReadRelativeFile("layout", retainedPath).Length > 0, "Staged and published evidence associations must remain readable after a launcher restart.");
        }
    }

    public static int Main(string[] args)
    {
        try { return RunTests(args); }
        catch (Exception error) { Console.Error.WriteLine(error);return 1; }
    }

    private static int RunTests(string[] args)
    {
        if (args.Length != 1) throw new ArgumentException("A test directory is required.");
        using (var auditTestKey = new RSACryptoServiceProvider(2048)) { auditTestKey.PersistKeyInCsp = false;PortableStorage.AuditSigningKeyOverrideForTests = auditTestKey.ExportCspBlob(true); }
        MethodInfo optionalQueryValue = typeof(TrackerContext).GetMethod("OptionalQueryValue", BindingFlags.NonPublic | BindingFlags.Static);
        Assert(optionalQueryValue != null, "The launcher must expose its optional archive request-value parser.");
        Assert(Convert.ToString(optionalQueryValue.Invoke(null, new object[] { "/api/storage/system/archive?path=file.pdf&filename=", "filename" })) == "", "An explicitly empty optional archive filename should use the source filename.");
        Assert(optionalQueryValue.Invoke(null, new object[] { "/api/storage/system/archive?path=file.pdf", "filename" }) == null, "A missing optional archive filename must not reject an otherwise valid archive request.");
        Assert(TrackerContext.ReadOnlyStorageActionAllowed("manifest", "GET") && TrackerContext.ReadOnlyStorageActionAllowed("operation-status", "GET") && TrackerContext.ReadOnlyStorageActionAllowed("file", "GET") && !TrackerContext.ReadOnlyStorageActionAllowed("file-location", "POST") && TrackerContext.ReadOnlyStorageActionAllowed("performance", "GET") && TrackerContext.ReadOnlyStorageActionAllowed("diagnostics", "GET") && TrackerContext.ReadOnlyStorageActionAllowed("audit-batch", "POST") && TrackerContext.ReadOnlyStorageActionAllowed("error-report", "POST") && TrackerContext.ReadOnlyStorageActionAllowed("backups", "GET") && TrackerContext.ReadOnlyStorageActionAllowed("restore-drill", "POST") && !TrackerContext.ReadOnlyStorageActionAllowed("restore", "POST") && !TrackerContext.ReadOnlyStorageActionAllowed("manifest", "POST") && !TrackerContext.ReadOnlyStorageActionAllowed("scan", "GET") && !TrackerContext.ReadOnlyStorageActionAllowed("evidence", "POST"), "Read-Only launcher enforcement should allow status lookup, verified backup inspection, non-destructive restore drills, operation reconciliation, sanitized diagnostics, local performance diagnostics, session/error logging, and auditing while rejecting restoration, File Explorer exposure, and every database, evidence, or Sync mutation.");
        string[] mutationActions = { "manifest", "csv", "state-commit", "workspace-publish", "sync-pipeline", "scan", "archive", "rework", "compress", "organize", "evidence", "evidence-pdf", "report", "restore", "restore-active" };
        foreach (string action in mutationActions) Assert(!TrackerContext.ReadOnlyStorageActionAllowed(action, action == "scan" ? "GET" : "POST") && TrackerContext.StorageActionRequiresLease(action, action == "scan" ? "GET" : "POST"), "Mutation policy drifted for " + action + ".");
        Assert(TrackerContext.StorageActionDisplayName("workspace-publish?ignored=1") == "workspace publish", "Busy-storage diagnostics should name the active operation without exposing query values.");
        Assert(!TrackerContext.ShutdownShouldExit("operator-logoff", TimeSpan.FromSeconds(30), true, false, false, false), "An active storage operation must receive its bounded graceful-shutdown window.");
        Assert(TrackerContext.ShutdownShouldExit("operator-logoff", TimeSpan.FromMinutes(2), true, false, false, false), "A hung storage operation must not keep the launcher alive beyond the hard shutdown deadline.");
        Assert(TrackerContext.ShutdownShouldExit("operator-logoff", TimeSpan.FromSeconds(1), false, true, true, true), "A fully finalized operator logoff should exit immediately after the browser confirms readiness.");
        Assert(TrackerContext.ShutdownShouldExit("operator-exit", TimeSpan.FromSeconds(2), false, true, true, false), "Tray Exit should close promptly after pending backups finish without waiting for a browser callback.");
        Assert(!TrackerContext.ShutdownShouldExit("idle", TimeSpan.FromMinutes(2), true, false, false, false) && TrackerContext.ShutdownShouldExit("idle", TimeSpan.FromMinutes(3), true, false, false, false), "Idle shutdown should retain the longer recovery window but still terminate deterministically.");
        Assert(TrackerContext.RequestBodyLimit("/api/storage/system/audit", "POST") == 8L * 1024 && TrackerContext.RequestBodyLimit("/api/storage/system/audit-batch", "POST") == 5L * 1024 * 1024 && TrackerContext.RequestBodyLimit("/api/storage/system/workspace-status", "POST") == 4L * 1024 && TrackerContext.RequestBodyLimit("/api/storage/system/workspace-recovery-reset", "POST") == 4L * 1024 && TrackerContext.RequestBodyLimit("/api/storage/system/evidence?ignored=1", "POST") == 110L * 1024 * 1024 && TrackerContext.RequestBodyLimit("/api/storage/system/scan", "POST") == 0 && TrackerContext.RequestBodyLimit("/api/storage/system/evidence", "GET") == 0, "Every launcher endpoint should have an explicit least-privilege request-body limit, independent of its query string.");
        Assert(PortableStorage.ValidApplicationVersion(PortableStorage.CurrentApplicationVersion) && PortableStorage.CompareApplicationVersions("1.3.17", "1.3.16") > 0, "The launcher must enforce a deterministic semantic client-version policy before allowing an older editor to overwrite a newer database.");
        string root = Path.GetFullPath(args[0]);
        Directory.CreateDirectory(root);
        string reparseRoot = Path.Combine(root, "reparse-path-test"), reparseChild = Path.Combine(reparseRoot, "junction"), reparseTarget = Path.Combine(reparseChild, "evidence.pdf");Directory.CreateDirectory(reparseChild);File.WriteAllBytes(reparseTarget, PdfBytes());bool reparseRejected = false;
        try { PortableStorage.ReparseTagOverrideForTests = path => String.Equals(path, reparseChild, StringComparison.OrdinalIgnoreCase) ? (uint?)0xA000000C : null;PortableStorage.EnsureReparseSafePath(reparseRoot, reparseTarget); }
        catch (UnauthorizedAccessException) { reparseRejected = true; }
        finally { PortableStorage.ReparseTagOverrideForTests = null; }
        Assert(reparseRejected, "Direct path operations must reject a symbolic-link or junction component even when lexical containment passes.");
        try { PortableStorage.ReparseTagOverrideForTests = path => String.Equals(path, reparseChild, StringComparison.OrdinalIgnoreCase) ? (uint?)0x9000001A : null;PortableStorage.EnsureReparseSafePath(reparseRoot, reparseTarget); }
        finally { PortableStorage.ReparseTagOverrideForTests = null; }
        RunStorageEnumerationFuzz(Path.GetDirectoryName(root));
        RunLocalDatabaseScanBoundary(Path.GetDirectoryName(root));
        RunLegacyWorkspaceRecovery(Path.GetDirectoryName(root));
        RunLocalWorkflowLayout(Path.GetDirectoryName(root));
        RunPublicationRecovery(Path.GetDirectoryName(root));
        RunPublicationCollisions(Path.GetDirectoryName(root));
        string compatibilityRoot = Path.Combine(root, "write-compatibility"), compatibilityCache = Path.Combine(root, "write-compatibility-mappings.json");
        Directory.CreateDirectory(compatibilityRoot);
        using (var compatibilityStorage = new PortableStorage("DOMAIN\\compatibility-operator", compatibilityCache))
        {
            Assert(compatibilityStorage.MapForFullSession("compatibility-key", compatibilityRoot, "compatibility-session"), "Full Access mapping should acquire its exclusive lease before initializing the selected folder, including on filesystems that require compatible buffered I/O.");
            var compatibilityDatabase = (Dictionary<string, object>)Json.DeserializeObject(Database("compatibility@example.mil"));((Dictionary<string, object>)((object[])compatibilityDatabase["systems"])[0])["organization"] = "SYSTEM-METADATA-ONLY";
            byte[] compatibilityState = Encoding.UTF8.GetBytes(Json.Serialize(new Dictionary<string, object> { { "database", compatibilityDatabase }, { "csv", "header\nvalue" } }));
            compatibilityStorage.PublishWorkspace("compatibility-key", compatibilityState);
            string protectedWorkspace = compatibilityStorage.LocalWorkspacePath("compatibility-key"), protectedDatabasePath = Path.Combine(protectedWorkspace, "System", "information-system-user-tracker.local.json"), protectedDatabaseText = File.ReadAllText(protectedDatabasePath, Encoding.UTF8);
            Assert(protectedDatabaseText.Contains("DPAPI-CurrentUser") && !protectedDatabaseText.Contains("compatibility@example.mil"), "The local working database must be protected with Windows DPAPI and must not expose user data as plaintext.");
            Assert(Directory.Exists(Path.Combine(protectedWorkspace, "Organizations", "GOV")) && !Directory.Exists(Path.Combine(protectedWorkspace, "Organizations", "SYSTEM-METADATA-ONLY")) && !Directory.Exists(Path.Combine(compatibilityRoot, "Organizations", "SYSTEM-METADATA-ONLY")), "The information-system Organization field must not create a local or shared organization folder; only actual user organizations or operator-created folders do.");
            Assert(!File.Exists(Path.Combine(protectedWorkspace, "System", "workspace-publication.json")), "A successful publication must remove its protected recovery journal.");
            var invalidEnvelope = (Dictionary<string, object>)Json.DeserializeObject(Encoding.UTF8.GetString(compatibilityState));
            var invalidDatabase = (Dictionary<string, object>)invalidEnvelope["database"];
            var invalidUsers = (object[])invalidDatabase["users"];
            ((Dictionary<string, object>)invalidUsers[0])["roles"] = new object[] { "Administrator" };
            bool invalidSchemaRejected = false;
            try { compatibilityStorage.SaveSystemState("compatibility-key", Encoding.UTF8.GetBytes(Json.Serialize(invalidEnvelope))); }
            catch (InvalidDataException) { invalidSchemaRejected = true; }
            Assert(invalidSchemaRejected, "The storage boundary must reject an unsupported user role before changing the protected local database.");
            var unsafePathEnvelope = (Dictionary<string, object>)Json.DeserializeObject(Encoding.UTF8.GetString(compatibilityState));
            var unsafePathUser = (Dictionary<string, object>)((object[])((Dictionary<string, object>)unsafePathEnvelope["database"])["users"])[0];
            unsafePathUser["artifacts"] = new object[] { new Dictionary<string, object> { { "kind", "SAAR" }, { "filename", "Shaw_Vivian_(GOV)_GEN_SAAR_24AUG2026.pdf.zip" }, { "path", "../outside.pdf.zip" }, { "source", "Sync" } } };
            bool unsafePathRejected = false;
            try { compatibilityStorage.SaveSystemState("compatibility-key", Encoding.UTF8.GetBytes(Json.Serialize(unsafePathEnvelope))); }
            catch (InvalidDataException) { unsafePathRejected = true; }
            Assert(unsafePathRejected, "The storage boundary must reject artifact traversal paths before changing the protected local database.");
            string publishedName = "Published_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf.zip";compatibilityStorage.StoreEvidence("compatibility-key", "GOV", "DoD Cyber Cert", publishedName, EvidenceZip(publishedName.Substring(0, publishedName.Length - 4), PdfBytes()));compatibilityStorage.PublishWorkspace("compatibility-key", compatibilityState);Dictionary<string, object> publishedScan = (Dictionary<string, object>)Json.DeserializeObject(compatibilityStorage.ScanWithJournal("compatibility-key", "publication-rules", true, "GOV", true));Dictionary<string, object> publishedItem = ((object[])publishedScan["items"]).Cast<Dictionary<string, object>>().Single(item => String.Equals(Convert.ToString(item["name"]), publishedName, StringComparison.Ordinal));string publishedRelative = Convert.ToString(publishedItem["path"], CultureInfo.InvariantCulture), publicationCatalog = Path.Combine(compatibilityRoot, "System", "Publication Receipts", "published-evidence.json"), publicationShardDirectory = Path.Combine(compatibilityRoot, "System", "Publication Receipts", "Organization Shards");Assert(publishedItem.ContainsKey("externalSharedAddition") && !Convert.ToBoolean(publishedItem["externalSharedAddition"], CultureInfo.InvariantCulture) && File.Exists(publicationCatalog) && File.ReadAllText(publicationCatalog).Contains("organization-sharded-v1") && Directory.EnumerateFiles(publicationShardDirectory, "published-*.json").Count() == 1, "Evidence copied and verified by local-workspace publication should retain an organization-sharded receipt and must not be flagged as a direct shared-drive addition.");
            string openedLocation = compatibilityStorage.EvidenceLocation("compatibility-key", publishedRelative), openedWorkspace = compatibilityStorage.LocalWorkspacePath("compatibility-key");Assert(File.Exists(openedLocation) && (openedLocation.StartsWith(compatibilityRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || openedLocation.StartsWith(openedWorkspace + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)), "Opening an evidence location should resolve the verified current file beneath the mapped or protected local root without reading it into the browser.");bool unsafeLocationRejected = false;try { compatibilityStorage.EvidenceLocation("compatibility-key", "../outside.pdf"); } catch (Exception error) { unsafeLocationRejected = error is UnauthorizedAccessException || error is InvalidDataException; }Assert(unsafeLocationRejected, "Opening an evidence location must reject traversal outside the mapped system folder.");
            compatibilityStorage.FinalizeMappedBackups();
            string compatibilityManifest = Path.Combine(compatibilityRoot, "System", "information-system-user-tracker.json"), compatibilityCsv = Path.Combine(compatibilityRoot, "System", "backup", "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".csv"), compatibilityLocalManifest = Path.Combine(protectedWorkspace, "System", "information-system-user-tracker.local.json");DateTime manifestWrite = File.GetLastWriteTimeUtc(compatibilityManifest), csvWrite = File.GetLastWriteTimeUtc(compatibilityCsv);string localManifestHash = Sha256(File.ReadAllBytes(compatibilityLocalManifest)), unchangedCommit = compatibilityStorage.SaveSystemState("compatibility-key", compatibilityState);
            Assert(unchangedCommit.Contains("\"unchanged\":true") && unchangedCommit.Contains("\"sharedCommitPending\":false") && File.GetLastWriteTimeUtc(compatibilityManifest) == manifestWrite && File.GetLastWriteTimeUtc(compatibilityCsv) == csvWrite && Sha256(File.ReadAllBytes(compatibilityLocalManifest)) == localManifestHash, "An unchanged database commit should not rewrite the protected local database, shared manifest, snapshot, or daily CSV backup.");
            compatibilityStorage.AppendAudit("compatibility-key", "COMPATIBILITY WRITE TEST");
            compatibilityStorage.ReleaseLease("compatibility-key", "compatibility-session");
        }
        Assert(File.Exists(Path.Combine(compatibilityRoot, "System", "information-system-user-tracker.json")) && File.Exists(Path.Combine(compatibilityRoot, "System", "information-system-user-tracker.json.sha256")) && !File.Exists(Path.Combine(compatibilityRoot, "information-system-user-tracker.json")) && File.Exists(Path.Combine(compatibilityRoot, "System", "backup", "user-tracker-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".csv")) && Directory.EnumerateFiles(Path.Combine(compatibilityRoot, "System", "Audit Logs"), "audit-*.jsonl").Any(), "Compatible buffered I/O should preserve the manifest, live checksum, backup, and audit writes beneath the System support folder.");
        string readOnlyRoot = Path.Combine(root, "read-only-mapping"), readOnlySystem = Path.Combine(readOnlyRoot, "System"), readOnlyCache = Path.Combine(root, "read-only-mappings.json");Directory.CreateDirectory(readOnlySystem);File.WriteAllText(Path.Combine(readOnlySystem, "information-system-user-tracker.json"), Database("reader@example.mil"), Encoding.UTF8);
        using (var readOnlyStorage = new PortableStorage("DOMAIN\\reader", readOnlyCache))
        {
            readOnlyStorage.MapReadOnly("read-only-key", readOnlyRoot);
            Assert(readOnlyStorage.ReadManifest("read-only-key").Contains("reader@example.mil"), "Read-Only mapping should expose the existing validated manifest.");
        }
        Assert(!Directory.Exists(Path.Combine(readOnlyRoot, "Organizations")) && !Directory.Exists(Path.Combine(readOnlyRoot, "Template")) && !Directory.Exists(Path.Combine(readOnlyRoot, "System", "backup")) && !File.Exists(Path.Combine(readOnlySystem, "information-system-user-tracker.json.sha256")), "Read-Only mapping must not initialize, migrate, repair, checksum, or reorganize the selected shared folder.");
        string legacyCache = Path.Combine(root, "legacy-folder-mappings.json");
        File.WriteAllText(legacyCache, "{\"version\":1,\"lastSystemId\":\"legacy\",\"mappings\":[{\"systemId\":\"legacy\",\"path\":\"" + compatibilityRoot.Replace("\\", "\\\\") + "\"}]}", Encoding.UTF8);
        using (var legacyStorage = new PortableStorage("DOMAIN\\operator", legacyCache)) Assert(!legacyStorage.CachedMappings().Contains("legacy"), "Version-1 development mapping caches should be ignored so a clean update cannot restore stale test systems.");
        string localCacheRoot = Path.Combine(Path.GetDirectoryName(root), Path.GetFileName(root) + "-local-cache"), mappingCache = Path.Combine(localCacheRoot, "local-folder-mappings.json"), performanceCacheRoot = Path.Combine(localCacheRoot, "performance-cache");
        string legacyAuditDirectory = Path.Combine(root, "Audit Logs");Directory.CreateDirectory(legacyAuditDirectory);File.WriteAllText(Path.Combine(legacyAuditDirectory, "audit-2020-01-01.txt"), "legacy audit record", Encoding.UTF8);
        string legacyErrorDirectory = Path.Combine(root, "Error Reports");Directory.CreateDirectory(legacyErrorDirectory);File.WriteAllText(Path.Combine(legacyErrorDirectory, "legacy-error.txt"), "legacy error record", Encoding.UTF8);
        File.WriteAllText(Path.Combine(root, "information-system-user-tracker.json"), Database("legacy-layout@example.mil"), Encoding.UTF8);
        File.WriteAllText(Path.Combine(root, "tracker-document-renamer-queue.json"), "{\"version\":1,\"items\":[]}", Encoding.UTF8);
        File.WriteAllText(Path.Combine(root, "tracker-active-session.json"), "{\"active\":true}", Encoding.UTF8);
        var storage = new PortableStorage("DOMAIN\\operator", mappingCache);
        storage.Map("mapping-key", root);
        string syncCheckpoint = Json.Serialize(new Dictionary<string, object> { { "version", 1 }, { "systemId", "mapping-key" }, { "runId", "11111111-1111-4111-8111-111111111111" }, { "mode", "Daily Sync" }, { "scope", "Entire System" }, { "stage", "Discovery" }, { "startedAtUtc", "2026-10-21T12:00:00.000Z" }, { "updatedAtUtc", "2026-10-21T12:01:00.000Z" }, { "processed", 10 }, { "total", 20 }, { "message", "Discovery in progress." }, { "recoverable", true } });
        Assert(storage.SaveSyncJob("mapping-key", Encoding.UTF8.GetBytes(syncCheckpoint)).Contains("\"saved\":true") && storage.ReadSyncJob("mapping-key").Contains("\"stage\":\"Discovery\""), "The DPAPI-protected Sync checkpoint should round-trip through strict validation.");storage.ClearSyncJob("mapping-key");Assert(storage.ReadSyncJob("mapping-key").Contains("\"checkpoint\":null"), "Clearing a completed Sync checkpoint should be idempotent.");
        var qualification = (Dictionary<string, object>)Json.DeserializeObject(storage.RunNetworkQualification("mapping-key"));Assert(Convert.ToBoolean(qualification["sha256Verified"]) && Convert.ToInt64(qualification["payloadBytes"], CultureInfo.InvariantCulture) == 65536 && !Directory.EnumerateFiles(Path.Combine(root, "System", "Storage Transactions", "Network Qualification"), ".raptor-probe-*", SearchOption.TopDirectoryOnly).Any(), "Network qualification should verify bounded storage operations and remove every probe file.");
        Assert(!File.Exists(Path.Combine(root, "information-system-user-tracker.json")) && File.Exists(Path.Combine(root, "System", "information-system-user-tracker.json")) && !File.Exists(Path.Combine(root, "tracker-document-renamer-queue.json")) && File.Exists(Path.Combine(root, "System", "tracker-document-renamer-queue.json")) && !File.Exists(Path.Combine(root, "tracker-active-session.json")) && File.Exists(Path.Combine(root, "System", "tracker-active-session.json")), "Mapping should migrate legacy operational JSON files into System without losing them.");
        Assert(Directory.Exists(Path.Combine(root, "Organizations")), "Mapping should create the top-level Organizations folder.");
        string templateDirectory = Path.Combine(root, "Template"), agreementTemplate = Path.Combine(templateDirectory, "Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf"), placeholderQualificationMemo = Path.Combine(templateDirectory, "8140_Qualification_Memo DDMMMYYYY.pdf"), olderQualificationMemo = Path.Combine(templateDirectory, "8140_Qualification_Memo 01JAN2026.pdf"), currentQualificationMemo = Path.Combine(templateDirectory, "8140_Qualification_Memo_26AUG2026.pdf");
        Assert(Directory.Exists(templateDirectory), "Mapping should create the top-level Template folder.");
        File.WriteAllBytes(Path.Combine(templateDirectory, "Ignore_Me.pdf"), PdfBytes());
        bool missingAgreementTemplate = false;try { storage.ResolveUserAgreementTemplate("mapping-key"); } catch (FileNotFoundException) { missingAgreementTemplate = true; }
        Assert(missingAgreementTemplate, "Unrelated Template-folder files must not be selected as the User Agreement attachment.");
        File.WriteAllBytes(agreementTemplate, PdfBytes());
        Assert(String.Equals(storage.ResolveUserAgreementTemplate("mapping-key"), agreementTemplate, StringComparison.OrdinalIgnoreCase), "Only the exact User Agreement template filename should resolve for Outlook attachment.");
        bool missingQualificationMemo = false;try { storage.Resolve8140QualificationMemoTemplate("mapping-key"); } catch (FileNotFoundException) { missingQualificationMemo = true; }
        Assert(missingQualificationMemo, "Unrelated Template-folder files must not be selected as the 8140 Qualification Memo attachment.");
        File.WriteAllBytes(placeholderQualificationMemo, PdfBytes());
        Assert(String.Equals(storage.Resolve8140QualificationMemoTemplate("mapping-key"), placeholderQualificationMemo, StringComparison.OrdinalIgnoreCase), "The displayed literal 8140 template placeholder filename should remain a usable fallback.");
        File.WriteAllBytes(olderQualificationMemo, PdfBytes());File.WriteAllBytes(currentQualificationMemo, PdfBytes());
        Assert(String.Equals(storage.Resolve8140QualificationMemoTemplate("mapping-key"), currentQualificationMemo, StringComparison.OrdinalIgnoreCase), "The newest dated 8140 Qualification Memo template should resolve across accepted date separators and take precedence over the literal placeholder.");
        string stagedQualificationMemo = storage.StageOutlookTemplateAttachment("mapping-key", "8140-qualification-memo");
        Assert(File.Exists(stagedQualificationMemo) && !stagedQualificationMemo.StartsWith(root, StringComparison.OrdinalIgnoreCase) && String.Equals(Path.GetFileName(stagedQualificationMemo), Path.GetFileName(currentQualificationMemo), StringComparison.OrdinalIgnoreCase) && File.ReadAllBytes(stagedQualificationMemo).SequenceEqual(File.ReadAllBytes(currentQualificationMemo)), "Outlook template attachments should be copied to a verified local temporary path while preserving the visible filename.");
        string stagedQualificationDirectory = Path.GetDirectoryName(stagedQualificationMemo);File.Delete(stagedQualificationMemo);Directory.Delete(stagedQualificationDirectory, false);
        string invalidQualificationMemo = Path.Combine(templateDirectory, "8140_Qualification_Memo-27AUG2026.pdf");File.WriteAllText(invalidQualificationMemo, "not a pdf", Encoding.UTF8);bool rejectedInvalidQualificationMemo = false;
        try { storage.Resolve8140QualificationMemoTemplate("mapping-key"); } catch (InvalidDataException error) { rejectedInvalidQualificationMemo = error.Message.IndexOf("PDF", StringComparison.OrdinalIgnoreCase) >= 0; }
        Assert(rejectedInvalidQualificationMemo, "A newer but unreadable 8140 template must fail with actionable PDF validation detail instead of silently attaching an older memo.");File.Delete(invalidQualificationMemo);
        Assert(storage.CreateOrganization("mapping-key", "GOV").Contains("\"organization\":\"GOV\"") && storage.ListOrganizations("mapping-key").Contains("GOV"), "The launcher should create and list organization folders beneath Organizations.");
        string localOrganizationDirectory = Path.Combine(storage.LocalWorkspacePath("mapping-key"), "Organizations", "GOV");
        foreach (string documentFolder in new[] { "GOV Rework", "GOV Complete" })
            Assert(Directory.Exists(Path.Combine(localOrganizationDirectory, documentFolder)), "Creating an organization should create its local organization-prefixed " + documentFolder + " folder.");
        Assert(!Directory.Exists(Path.Combine(root, "Organizations", "GOV", "GOV Complete")), "The Complete folder must exist only in the protected local workspace and must never be created on the shared drive.");
        string recoveryName = "Shaw_Vivian_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf.zip", recoveryArchive = Path.Combine(root, "Organizations", "GOV", "GOV Archive", "2026-09-10"), recoverySource = Path.Combine(recoveryArchive, recoveryName);Directory.CreateDirectory(recoveryArchive);File.WriteAllBytes(recoverySource, EvidenceZip(recoveryName.Substring(0, recoveryName.Length - 4), PdfBytes()));
        string recoveryRequest = Json.Serialize(new Dictionary<string, object> { { "items", new object[] { new Dictionary<string, object> { { "userId", "user-1" }, { "organization", "GOV" }, { "kind", "DoD Cyber Cert" }, { "filename", recoveryName }, { "path", "Organizations/GOV/GOV DoD Cyber Cert/" + recoveryName } } } } });
        var recoveryResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.RestoreActiveEvidence("mapping-key", Encoding.UTF8.GetBytes(recoveryRequest)));object[] recoveredEvidence = (object[])recoveryResponse["restored"];
        Assert(recoveredEvidence.Length == 1 && !File.Exists(recoverySource) && File.Exists(Path.Combine(root, "Organizations", "GOV", "GOV DoD Cyber Cert", recoveryName)), "Evidence still associated with an active user should be restored from Archive to its organization-prefixed canonical document-type folder.");
        bool rejectedReservedOrganization = false;try { storage.CreateOrganization("mapping-key", "SAAR"); } catch (InvalidDataException) { rejectedReservedOrganization = true; }
        Assert(rejectedReservedOrganization && !Directory.Exists(Path.Combine(root, "Organizations", "SAAR")), "Document-type folders must not be accepted as organizations.");
        bool rejectedDeviceOrganization = false;try { storage.CreateOrganization("mapping-key", "CON"); } catch (InvalidDataException) { rejectedDeviceOrganization = true; }
        Assert(rejectedDeviceOrganization, "Reserved Windows device names must not be accepted as organizations.");
        Assert(!Directory.Exists(legacyAuditDirectory) && File.Exists(Path.Combine(root, "System", "Audit Logs", "audit-2020-01-01.txt")), "Mapping should migrate legacy support folders beneath the top-level System folder without losing their contents.");
        Assert(!Directory.Exists(legacyErrorDirectory) && File.Exists(Path.Combine(root, "System", "Error Reports", "legacy-error.txt")), "Mapping should migrate legacy error reports beneath the top-level System folder without losing them.");
        Assert(!Directory.EnumerateFiles(root, ".isut-map-probe-*", SearchOption.TopDirectoryOnly).Any(), "A successful mapping compatibility probe should remove its temporary file.");
        var competingStorage = new PortableStorage("DOMAIN\\second-operator", mappingCache);
        competingStorage.Map("mapping-key", root);

        storage.SaveManifest("mapping-key", DatabaseWithLegacyChangeArrays("first@example.mil"));
        string repairedLegacyHistory = storage.ReadManifest("mapping-key");
        Assert(repairedLegacyHistory.Contains("\"files\":[]") && repairedLegacyHistory.Contains("\"rolesBefore\":[]") && repairedLegacyHistory.Contains("\"rolesAfter\":[]"), "Storage verification must repair historical change entries that predate the non-identity array fields instead of blocking Sync.");
        storage.SaveManifest("mapping-key", Database("first@example.mil"));
        string protectedLocalMappings = storage.CachedMappings(false, true);
        Assert(protectedLocalMappings.Contains("\"source\":\"local-cache\"") && protectedLocalMappings.Contains("first@example.mil") && Directory.EnumerateFiles(performanceCacheRoot, "verified-manifest.cache", SearchOption.AllDirectories).Any(), "A verified manifest save should refresh the Windows-user-protected local read cache without requiring shared-folder initialization.");
        string manifestPathForLockTest = Path.Combine(root, "System", "information-system-user-tracker.json");
        string manifestChecksumPath = manifestPathForLockTest + ".sha256", manifestHash = Sha256(File.ReadAllBytes(manifestPathForLockTest));
        string manifestCatalog = File.ReadAllText(manifestPathForLockTest, Encoding.UTF8), databaseShardDirectory = Path.Combine(root, "System", "Database Shards");
        Assert(manifestCatalog.Contains("\"storageFormat\":\"organization-sharded-v1\"") && manifestCatalog.Contains("\"userShards\"") && !manifestCatalog.Contains("first@example.mil") && Directory.EnumerateFiles(databaseShardDirectory, "org-*.json", SearchOption.AllDirectories).Any(path => File.ReadAllText(path, Encoding.UTF8).Contains("first@example.mil")), "The authoritative database should use a compact catalog and organization-scoped record shards while preserving the logical read contract.");
        storage.SaveManifest("mapping-key", MultiOrganizationDatabase());
        Dictionary<string, object> orderedDatabase = (Dictionary<string, object>)Json.DeserializeObject(storage.ReadManifest("mapping-key"));object[] orderedUsers = (object[])orderedDatabase["users"];
        Assert(String.Join(",", orderedUsers.Cast<Dictionary<string, object>>().Select(user => Convert.ToString(user["email"], CultureInfo.InvariantCulture))) == "ordered0@example.mil,ordered1@example.mil,ordered2@example.mil,ordered3@example.mil,ordered4@example.mil" && Directory.EnumerateFiles(databaseShardDirectory, "org-*.json", SearchOption.AllDirectories).Count() >= 3, "Organization sharding must preserve the original logical user order across interleaved organizations.");
        Dictionary<string, object> firstMultiCatalog = (Dictionary<string, object>)Json.DeserializeObject(File.ReadAllText(manifestPathForLockTest, Encoding.UTF8));var firstShardPaths = ((object[])firstMultiCatalog["userShards"]).Cast<Dictionary<string, object>>().ToDictionary(reference => Convert.ToString(reference["organization"], CultureInfo.InvariantCulture), reference => Convert.ToString(reference["file"], CultureInfo.InvariantCulture), StringComparer.OrdinalIgnoreCase);
        storage.SaveManifest("mapping-key", MultiOrganizationDatabase("ordered1-updated@example.mil"));Dictionary<string, object> secondMultiCatalog = (Dictionary<string, object>)Json.DeserializeObject(File.ReadAllText(manifestPathForLockTest, Encoding.UTF8));var secondShardPaths = ((object[])secondMultiCatalog["userShards"]).Cast<Dictionary<string, object>>().ToDictionary(reference => Convert.ToString(reference["organization"], CultureInfo.InvariantCulture), reference => Convert.ToString(reference["file"], CultureInfo.InvariantCulture), StringComparer.OrdinalIgnoreCase);
        Assert(firstShardPaths["GOV"] == secondShardPaths["GOV"] && firstShardPaths["NGC"] == secondShardPaths["NGC"] && firstShardPaths["LM"] != secondShardPaths["LM"] && Directory.EnumerateFiles(databaseShardDirectory, "org-*.json", SearchOption.TopDirectoryOnly).Count() == 3, "A record change in one organization should transfer only that content-addressed organization shard and reuse the others.");
        storage.SaveManifest("mapping-key", Database("first@example.mil"));
        manifestHash = Sha256(File.ReadAllBytes(manifestPathForLockTest));
        Assert(File.Exists(manifestChecksumPath) && File.ReadAllText(manifestChecksumPath, Encoding.ASCII).Trim() == manifestHash + "  information-system-user-tracker.json", "Every live database save should create a matching SHA-256 sidecar.");
        bool manifestChecksumInterruptionObserved = false;try { PortableStorage.FailAfterStageForTests = "manifest-write-before-checksum";storage.SaveManifest("mapping-key", Database("interrupted@example.mil")); } catch (IOException) { manifestChecksumInterruptionObserved = true; } finally { PortableStorage.FailAfterStageForTests = null; }
        Assert(manifestChecksumInterruptionObserved, "The manifest integrity recovery test must interrupt after the database write and before its checksum write.");storage.Map("mapping-key", root);manifestHash = Sha256(File.ReadAllBytes(manifestPathForLockTest));Assert(File.ReadAllText(manifestChecksumPath, Encoding.ASCII).Trim() == manifestHash + "  information-system-user-tracker.json" && !Directory.EnumerateFiles(Path.Combine(root, "System", "Storage Transactions"), "transaction-*.json").Any(), "Mapping should recover an interrupted database save by rebuilding the checksum for the verified transaction destination.");
        var manifestBlocker = new FileStream(manifestPathForLockTest, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        var releaseManifestBlocker = new Thread(new ThreadStart(delegate { Thread.Sleep(100); manifestBlocker.Dispose(); }));
        releaseManifestBlocker.Start();
        storage.SaveManifest("mapping-key", Database("first@example.mil"));
        releaseManifestBlocker.Join();
        Assert(storage.ReadManifest("mapping-key").Contains("first@example.mil") && !Directory.EnumerateFiles(root, ".isut-*", SearchOption.TopDirectoryOnly).Any(), "A brief SMB-style replacement lock should be retried without changing or stranding the sharded manifest.");
        string cachedFile = File.ReadAllText(mappingCache, Encoding.UTF8);
        Assert(cachedFile.Contains("\"version\":2") && cachedFile.Contains("mapping-key") && cachedFile.Contains(root.Replace("\\", "\\\\")) && !cachedFile.Contains("first@example.mil"), "The local cache should contain only current-version mapping metadata, not operational user records.");
        var restoredStorage = new PortableStorage("DOMAIN\\operator", mappingCache);
        string restoredMappings = restoredStorage.CachedMappings();
        Assert(restoredMappings.Contains("\"storageId\":\"mapping-key\"") && restoredMappings.Contains("\"systemId\":\"system-1\"") && restoredMappings.Contains("first@example.mil"), "A new launcher should reload the current manifest through its cached folder mapping.");
        restoredStorage.Dispose();
        storage.SaveCsv("mapping-key", Encoding.UTF8.GetBytes("header\nvalue"));
        storage.FinalizeMappedBackups();
        string firstList = storage.ListBackups("mapping-key", "system-1");
        object[] firstItems = (object[])Json.DeserializeObject(firstList);
        Assert(firstItems.Length == 1, "The first database save should create one snapshot.");
        string firstFilename = Convert.ToString(((Dictionary<string, object>)firstItems[0])["filename"]);
        Assert(firstFilename.EndsWith(".json.gz", StringComparison.OrdinalIgnoreCase) && Convert.ToBoolean(((Dictionary<string, object>)firstItems[0])["valid"]), "The first compressed snapshot should verify.");
        string drill = storage.RestoreDrill("mapping-key", "system-1", firstFilename);
        Assert(drill.Contains("\"healthy\":true") && drill.Contains("\"nonDestructive\":true") && drill.Contains("\"userCount\":1") && storage.ReadManifest("mapping-key").Contains("first@example.mil"), "The restore drill should verify and reconstruct a snapshot without changing the live manifest.");
        byte[] queueBytes = Encoding.UTF8.GetBytes("{\"version\":1,\"items\":[]}");
        storage.SaveRenamerQueue("mapping-key", queueBytes);
        Assert(storage.ReadRenamerQueue("mapping-key").Contains("\"version\":1") && File.Exists(Path.Combine(root, "System", "tracker-document-renamer-queue.json")) && !File.Exists(Path.Combine(root, "tracker-document-renamer-queue.json")) && !storage.Scan("mapping-key", "legacy", true).Contains("tracker-document-renamer-queue.json"), "The resumable renamer queue should round-trip beneath System and remain excluded from evidence scans.");
        storage.ClearRenamerQueue("mapping-key");
        Assert(storage.ReadRenamerQueue("mapping-key") == "null", "Clearing the resumable renamer queue should be idempotent.");

        storage.SaveManifest("mapping-key", Database("second@example.mil"));
        storage.FinalizeMappedBackups();
        object[] secondItems = (object[])Json.DeserializeObject(storage.ListBackups("mapping-key", "system-1"));
        Assert(secondItems.Length == 2, "A distinct database state should create a second snapshot.");
        string restored = storage.Restore("mapping-key", "system-1", firstFilename);
        Assert(restored.Contains("first@example.mil") && !restored.Contains("second@example.mil") && File.ReadAllText(manifestChecksumPath, Encoding.ASCII).Trim() == Sha256(File.ReadAllBytes(manifestPathForLockTest)) + "  information-system-user-tracker.json", "Restore should replace the manifest with the selected snapshot and its matching live checksum.");

        byte[] storedEvidenceBytes = EvidenceZip("Shaw_Vivian_SAAR_24AUG2026.pdf", PdfBytes());
        string evidence = storage.StoreEvidence("mapping-key", "GOV", "SAAR", "Shaw_Vivian_SAAR_24AUG2026.pdf.zip", storedEvidenceBytes);
        Assert(evidence.EndsWith(".zip", StringComparison.OrdinalIgnoreCase), "Evidence should retain a ZIP filename.");
        string evidenceReceipt = storage.VerifyStoredEvidence("mapping-key", "GOV", "SAAR", evidence, Sha256(storedEvidenceBytes));
        Assert(evidenceReceipt.Contains("\"stored\":true") && evidenceReceipt.Contains("Organizations/GOV/GOV SAAR/") && evidenceReceipt.Contains(Sha256(storedEvidenceBytes)), "A completed manual evidence write should expose an exact organization-prefixed path and SHA-256 receipt for late-response reconciliation.");
        Assert(storage.VerifyStoredEvidence("mapping-key", "GOV", "SAAR", evidence, new string('0', 64)).Contains("\"stored\":false"), "A receipt must not accept different content at the same evidence path.");
        string evidenceRelativePath = Path.Combine("Organizations", "GOV", "GOV SAAR", evidence).Replace(Path.DirectorySeparatorChar, '/');
        var evidenceExists = (Dictionary<string, object>)Json.DeserializeObject(storage.EvidenceExists("mapping-key", evidenceRelativePath));
        Assert(Convert.ToBoolean(evidenceExists["exists"], CultureInfo.InvariantCulture) && Convert.ToInt64(evidenceExists["size"], CultureInfo.InvariantCulture) == storedEvidenceBytes.LongLength, "Metadata-only evidence verification should resolve staged aliases without reading the file payload.");
        var evidenceMissing = (Dictionary<string, object>)Json.DeserializeObject(storage.EvidenceExists("mapping-key", "Organizations/GOV/GOV Archive/2000-01-01/missing.pdf.zip"));
        Assert(!Convert.ToBoolean(evidenceMissing["exists"], CultureInfo.InvariantCulture), "Metadata-only evidence verification should report a previously moved or absent Archive file without throwing.");
        string localEvidenceRoot = storage.LocalWorkspacePath("mapping-key");
        string identityEditSourceName = "Oldname_Alex_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf.zip", identityEditTargetName = "Newname_Alex_(EDITORG)_DoD_Cyber_Cert_24AUG2026.pdf.zip";
        byte[] identityEditBytes = EvidenceZip("Oldname_Alex_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf", PdfBytes());storage.StoreEvidence("mapping-key", "GOV", "DoD Cyber Cert", identityEditSourceName, identityEditBytes);
        string identityEditSourceRelative = Path.Combine("Organizations", "GOV", "GOV DoD Cyber Cert", identityEditSourceName), identityEditTargetRelative = Path.Combine("Organizations", "EDITORG", "EDITORG DoD Cyber Cert", identityEditTargetName);
        string identityEditSourcePhysical = Path.Combine(localEvidenceRoot, "Organizations", "GOV", identityEditSourceName), identityEditTargetPhysical = Path.Combine(localEvidenceRoot, "Organizations", "EDITORG", identityEditTargetName);
        var identityEditResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.RelabelUserEvidence("mapping-key", identityEditSourceRelative, "EDITORG", "DoD Cyber Cert", identityEditTargetName));
        Assert(!File.Exists(identityEditSourcePhysical) && File.Exists(identityEditTargetPhysical) && identityEditBytes.SequenceEqual(File.ReadAllBytes(identityEditTargetPhysical)) && Convert.ToString(identityEditResponse["path"]).Replace('\\','/') == identityEditTargetRelative.Replace('\\','/'), "Editing a user identity should transactionally preserve and move active evidence into the new organization and canonical filename.");
        Assert(!Directory.EnumerateFiles(Path.Combine(localEvidenceRoot, "System", "Storage Transactions"), "transaction-*.json").Any(), "A completed local-workspace relabel must close its short-path recovery journal.");
        string identityEditCollisionName = "Collision_User_(EDITORG)_DoD_Cyber_Cert_24AUG2026.pdf.zip", identityEditCollisionRelative = Path.Combine("Organizations", "EDITORG", "EDITORG DoD Cyber Cert", identityEditCollisionName);storage.StoreEvidence("mapping-key", "EDITORG", "DoD Cyber Cert", identityEditCollisionName, EvidenceZip("Collision_User_(EDITORG)_DoD_Cyber_Cert_24AUG2026.pdf", PdfBytes()));
        var identityEditCollision = (Dictionary<string, object>)Json.DeserializeObject(storage.RelabelUserEvidence("mapping-key", identityEditTargetRelative, "EDITORG", "DoD Cyber Cert", identityEditCollisionName));
        Assert(Convert.ToBoolean(identityEditCollision["collision"]) && File.Exists(LocalEvidenceFile(storage, "mapping-key", identityEditTargetRelative)) && File.Exists(LocalEvidenceFile(storage, "mapping-key", identityEditCollisionRelative)), "A user-information edit collision must preserve both files and stop before overwriting evidence.");
        string localGovIncoming = Path.Combine(localEvidenceRoot, "Organizations", "GOV");File.WriteAllText(Path.Combine(localGovIncoming, "operator-notes.txt"), "This non-evidence file must not require metadata validation.", Encoding.UTF8);
        string encryptedEvidenceName = "Encrypted_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf", encryptedEvidencePath = Path.Combine(localGovIncoming, encryptedEvidenceName);File.WriteAllBytes(encryptedEvidencePath, EncryptedPdfBytes());
        var dailyScanEnvelope = (Dictionary<string, object>)Json.DeserializeObject(storage.ScanWithJournal("mapping-key", "rules-1", false, null, false));string scan = Json.Serialize((object[])dailyScanEnvelope["items"]);
        Assert(scan.Contains("Shaw_Vivian_SAAR_24AUG2026.pdf.zip") && scan.Contains(encryptedEvidenceName) && scan.Contains("\"accepted\":true") && scan.Contains("\"unchanged\":false"), "Daily Sync should validate new local organization-root or Rework evidence without rescanning manually stored canonical evidence. Result: " + scan);
        Dictionary<string, object> encryptedEvidenceItem = ((object[])Json.DeserializeObject(scan)).Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == encryptedEvidenceName);
        Assert(Convert.ToBoolean(encryptedEvidenceItem["accepted"]) && Convert.ToBoolean(encryptedEvidenceItem["encryptedPdf"]), "The launcher should structurally validate and explicitly identify an encrypted PDF in one pass.");
        string excludedArchiveDirectory = Path.Combine(root, "Organizations", "GOV", "GOV Archive");Directory.CreateDirectory(excludedArchiveDirectory);File.WriteAllBytes(Path.Combine(excludedArchiveDirectory, "Archived_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf.zip"), EvidenceZip("Archived_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf", PdfBytes()));
        var locationPayload = (Dictionary<string, object>)Json.DeserializeObject(storage.ListEvidenceLocations("mapping-key"));object[] locationItems = (object[])locationPayload["items"];
        var archivedLocationPayload = (Dictionary<string, object>)Json.DeserializeObject(storage.ListArchivedEvidenceLocations("mapping-key", "GOV"));object[] archivedLocationItems = (object[])archivedLocationPayload["items"];
        Assert(archivedLocationItems.Length == 0, "Routine Archive locations must not enumerate shared archives to reconstruct disabled-user associations.");
        Assert(locationItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip" && Convert.ToInt64(item["size"]) > 0 && Convert.ToInt64(item["lastModifiedUnixMs"]) > 0), "Metadata-only location refresh should return evidence paths, sizes, and modified times without content validation.");
        Assert(!locationItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["name"]) == "operator-notes.txt"), "Metadata-only location refresh should omit non-evidence files.");
        Assert(Convert.ToInt32(locationPayload["skippedZips"]) >= 1, "Metadata-only location refresh should report skipped ZIP files and excluded archive trees for Document Renamer transparency.");
        storage.CreateOrganization("mapping-key", "NGC");string ngcTargetName = "Target_User_(NGC)_DoD_Cyber_Cert_24AUG2026.pdf", sharedNgcDirectory = Path.Combine(root, "Organizations", "NGC"), ngcTargetPath = Path.Combine(sharedNgcDirectory, ngcTargetName);Directory.CreateDirectory(sharedNgcDirectory);File.WriteAllBytes(ngcTargetPath, PdfBytes());
        string fullScanSaarName = "Fullscan_User_(GOV)_GEN_SAAR_24AUG2026.pdf", fullScanSaarPath = Path.Combine(root, "Organizations", "GOV", fullScanSaarName);File.WriteAllBytes(fullScanSaarPath, PdfBytes());
        var fullScopeScan = (Dictionary<string, object>)Json.DeserializeObject(storage.ScanWithJournal("mapping-key", "scope-parity-rules", true, null));object[] fullScopeItems = (object[])fullScopeScan["items"];
        var targetedScopeScan = (Dictionary<string, object>)Json.DeserializeObject(storage.ScanWithJournal("mapping-key", "scope-parity-rules", true, "GOV"));object[] targetedScopeItems = (object[])targetedScopeScan["items"];
        Assert(fullScopeItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["name"]) == fullScanSaarName && Convert.ToBoolean(item["accepted"])) && targetedScopeItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["name"]) == fullScanSaarName && Convert.ToBoolean(item["accepted"])), "Full-system and targeted organization scans must both discover a valid loose SAAR placed at the top level of Organizations/GOV on their first pass.");
        Assert(!PortableStorage.ReparseTagMayEscapeMappedTree(0x9000001A) && PortableStorage.ReparseTagMayEscapeMappedTree(0xA000000C) && PortableStorage.ReparseTagMayEscapeMappedTree(0xA0000003), "Cloud placeholder reparse tags must remain scannable while symbolic-link and mount-point name surrogates remain blocked.");
        var govScopedScan = (Dictionary<string, object>)Json.DeserializeObject(storage.ScanWithJournal("mapping-key", "targeted-rules", false, "GOV", false));object[] govScopedItems = (object[])govScopedScan["items"];
        Assert(govScopedItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["name"]) == encryptedEvidenceName) && !govScopedItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["name"]) == ngcTargetName), "An organization-targeted Daily Sync should enumerate only the selected local organization root and Rework folder.");
        var ngcScopedLocations = (Dictionary<string, object>)Json.DeserializeObject(storage.ListEvidenceLocations("mapping-key", "NGC", true));object[] ngcLocationItems = (object[])ngcScopedLocations["items"];
        Assert(ngcLocationItems.Length == 1 && Convert.ToString(((Dictionary<string, object>)ngcLocationItems[0])["name"]) == ngcTargetName, "An organization-targeted location refresh should not enumerate a sibling organization.");
        bool rejectedUnsafeScope = false;try { storage.ScanWithJournal("mapping-key", "targeted-rules", false, "NGC/DoD Cyber Cert"); } catch (InvalidDataException) { rejectedUnsafeScope = true; }
        Assert(rejectedUnsafeScope, "Targeted Sync must reject document-type subfolders and arbitrary paths as organization scope values.");
        Dictionary<string, object> ignoredNonEvidence = ((object[])Json.DeserializeObject(scan)).Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "operator-notes.txt");
        Assert(Convert.ToInt64(ignoredNonEvidence["size"]) == 0 && !Convert.ToBoolean(ignoredNonEvidence["accepted"]), "Sync should classify irrelevant extensions without requesting provider metadata for them.");
        try
        {
            PortableStorage.ForceNativeEnumerationForTests = true;
            var nativeScanEnvelope = (Dictionary<string, object>)Json.DeserializeObject(storage.ScanWithJournal("mapping-key", "rules-native", false, null, false));object[] nativeScanItems = (object[])nativeScanEnvelope["items"];
            Assert(nativeScanItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["name"]) == encryptedEvidenceName && Convert.ToBoolean(item["accepted"])), "The native Windows fallback should enumerate and validate local organization-root or Rework evidence files.");
            Assert(nativeScanItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["name"]) == "operator-notes.txt" && !Convert.ToBoolean(item["accepted"])), "The native Windows fallback should enumerate non-evidence files for review without accepting them.");
        }
        finally { PortableStorage.ForceNativeEnumerationForTests = false; }
        string sharedSyncIndexDirectory = Path.Combine(root, "System", "Sync Index");
        Assert(Directory.Exists(sharedSyncIndexDirectory) && Directory.EnumerateFiles(sharedSyncIndexDirectory, "index-*.json", SearchOption.TopDirectoryOnly).Any() && Directory.EnumerateFiles(sharedSyncIndexDirectory, "index-*.json.sha256", SearchOption.TopDirectoryOnly).Any() && !File.Exists(Path.Combine(root, "tracker-sync-index.json")), "A successful scan should store checksum-protected organization-sharded Sync indexes beneath System.");
        Assert(Directory.EnumerateFiles(performanceCacheRoot, "index-*.json", SearchOption.AllDirectories).Any(), "A successful scan should mirror verified Sync-index shards into the per-Windows-user local performance cache.");
        string evidencePath = LocalEvidenceFile(storage, "mapping-key", Path.Combine("Organizations", "GOV", "GOV SAAR", evidence)), sharedEvidencePath = Path.Combine(root, "Organizations", "GOV", "GOV SAAR", evidence);Directory.CreateDirectory(Path.GetDirectoryName(sharedEvidencePath));File.WriteAllBytes(sharedEvidencePath, storedEvidenceBytes);File.WriteAllBytes(evidencePath, storedEvidenceBytes);
        storage.Scan("mapping-key", "rules-1", false);
        object[] cachedScanItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", false));
        Dictionary<string, object> cachedEvidenceItem = cachedScanItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
        Assert(Convert.ToBoolean(cachedEvidenceItem["unchanged"]), "A later scan should skip unchanged evidence content validation.");
        File.SetLastWriteTimeUtc(evidencePath, File.GetLastWriteTimeUtc(evidencePath).AddSeconds(2));
        object[] changedScanItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", false));
        Dictionary<string, object> changedEvidenceItem = changedScanItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
        Assert(!Convert.ToBoolean(changedEvidenceItem["unchanged"]), "A changed modification timestamp should force evidence revalidation.");
        var crossComputerStorage = new PortableStorage("DOMAIN\\other-computer", mappingCache);crossComputerStorage.Map("mapping-key", root);
        object[] crossComputerItems = (object[])Json.DeserializeObject(crossComputerStorage.Scan("mapping-key", "rules-1", false));
        Dictionary<string, object> crossComputerEvidence = crossComputerItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
        Assert(Convert.ToBoolean(crossComputerEvidence["unchanged"]), "The local Sync index should accelerate another launcher using the same protected workspace.");crossComputerStorage.Dispose();
        using (var evidenceBlocker = new FileStream(evidencePath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        using (var sharedEvidenceBlocker = new FileStream(sharedEvidencePath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            Dictionary<string, object> cachedWhileLocked = ((object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", false))).Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
            Assert(Convert.ToBoolean(cachedWhileLocked["accepted"]) && Convert.ToBoolean(cachedWhileLocked["unchanged"]), "An unchanged cached file should not be reopened during incremental Sync.");
            Dictionary<string, object> forcedWhileLocked = ((object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", true))).Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
            Assert(!Convert.ToBoolean(forcedWhileLocked["accepted"]) && !Convert.ToBoolean(forcedWhileLocked["unchanged"]), "Full Rescan should reopen evidence and report a transient exclusive file lock.");
        }
        File.SetLastWriteTimeUtc(evidencePath, File.GetLastWriteTimeUtc(evidencePath).AddSeconds(2));
        Dictionary<string, object> recoveredAfterLock = ((object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", false))).Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip");
        Assert(Convert.ToBoolean(recoveredAfterLock["accepted"]) && !Convert.ToBoolean(recoveredAfterLock["unchanged"]), "A transient read failure must not be cached after the file becomes available.");
        object[] fullScanItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-1", true));
        Assert(!Convert.ToBoolean(fullScanItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip")["unchanged"]), "Full Rescan should ignore the shared Sync index.");
        object[] changedRuleItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-2", false));
        Assert(!Convert.ToBoolean(changedRuleItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip")["unchanged"]), "A rule-set change should invalidate the shared Sync index.");
        foreach (string checksumPath in Directory.EnumerateFiles(Path.Combine(localEvidenceRoot, "System", "Sync Index"), "index-*.json.sha256", SearchOption.TopDirectoryOnly)) File.WriteAllText(checksumPath, new string('0', 64) + "  " + Path.GetFileNameWithoutExtension(checksumPath) + "\n", Encoding.ASCII);
        object[] damagedIndexItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "rules-2", false));
        Assert(!Convert.ToBoolean(damagedIndexItems.Cast<Dictionary<string, object>>().First(item => Convert.ToString(item["name"]) == "Shaw_Vivian_SAAR_24AUG2026.pdf.zip")["unchanged"]), "A damaged Sync-index checksum should fall back to full validation.");
        Assert(!cachedScanItems.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["path"]).IndexOf("Sync Index", StringComparison.OrdinalIgnoreCase) >= 0), "Sync-index shards must be excluded from evidence results. Paths: " + String.Join(" | ", cachedScanItems.Cast<Dictionary<string, object>>().Select(item => Convert.ToString(item["path"])).Where(path => path.IndexOf("Sync Index", StringComparison.OrdinalIgnoreCase) >= 0).Take(10)));
        string alternateDateEvidence = storage.StoreEvidence("mapping-key", "GOV", "User Agreement", "Shaw_Vivian_GEN_User_Agreement_20260826.pdf.zip", EvidenceZip("Shaw_Vivian_GEN_User_Agreement_20260826.pdf", PdfBytes()));
        string alternateDateRelative = Path.Combine("Organizations", "GOV", "GOV User Agreement", alternateDateEvidence), alternateDatePath = LocalEvidenceFile(storage, "mapping-key", alternateDateRelative), normalizedDateName = "Shaw_Vivian_(GOV)_GEN_User_Agreement_26AUG2026.pdf.zip";byte[] alternateDateBytes = File.ReadAllBytes(alternateDatePath);
        var normalizedDateResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.NormalizeEvidenceFilename("mapping-key", alternateDateRelative, normalizedDateName));
        string normalizedDatePath = LocalEvidenceFile(storage, "mapping-key", Path.Combine("Organizations", "GOV", "GOV User Agreement", normalizedDateName));
        Assert(!File.Exists(alternateDatePath) && File.Exists(normalizedDatePath) && alternateDateBytes.SequenceEqual(File.ReadAllBytes(normalizedDatePath)) && Convert.ToString(normalizedDateResponse["renamed"]).EndsWith(normalizedDateName), "Filename normalization should apply the folder organization and standard date without changing any file bytes.");
        storage.StoreEvidence("mapping-key", "GOV", "User Agreement", alternateDateEvidence, alternateDateBytes);
        var collisionResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.NormalizeEvidenceFilename("mapping-key", alternateDateRelative, normalizedDateName));
        Assert(Convert.ToBoolean(collisionResponse["collision"]) && File.Exists(alternateDatePath) && File.Exists(normalizedDatePath), "A normalization collision should preserve both files and return it for duplicate review instead of aborting Sync.");
        string conflictArchiveName = "Shaw_Vivian_(GOV)_GEN_User_Agreement_26AUG2026_CONFLICT_ABCDEF12.pdf.zip", conflictArchiveResult = storage.ArchiveEvidence("mapping-key", alternateDateRelative, conflictArchiveName), conflictArchiveRelative = Convert.ToString(((Dictionary<string, object>)Json.DeserializeObject(conflictArchiveResult))["archived"]);
        Assert(Path.GetFileName(conflictArchiveRelative).IndexOf("CONFLICT_ABCDEF12", StringComparison.OrdinalIgnoreCase) >= 0 && File.Exists(LocalEvidenceFile(storage, "mapping-key", conflictArchiveRelative)), "A non-authoritative same-name conflict should retain its traceable conflict identifier in the organization Archive even when the path must be shortened safely: " + conflictArchiveRelative);
        bool rejectedArchiveExtension = false;
        try { storage.ArchiveEvidence("mapping-key", Path.Combine("Organizations", "GOV", "GOV User Agreement", normalizedDateName), "unsafe-conflict.exe"); } catch (InvalidDataException) { rejectedArchiveExtension = true; }
        Assert(rejectedArchiveExtension && File.Exists(normalizedDatePath), "A requested collision archive name must preserve the PDF or ZIP evidence extension and leave the source unchanged when rejected.");
        string reworkCollisionDirectory = Path.Combine(root, "Organizations", "GOV", "GOV Rework");Directory.CreateDirectory(reworkCollisionDirectory);string reworkCollisionName = "Shaw_Vivian_(GOV)_GEN_User_Agreement_27AUG2026.pdf.zip", reworkCollisionPath = Path.Combine(reworkCollisionDirectory, reworkCollisionName), reworkCollisionRelative = Path.Combine("Organizations", "GOV", "GOV Rework", reworkCollisionName);File.WriteAllBytes(reworkCollisionPath, EvidenceZip(reworkCollisionName.Substring(0, reworkCollisionName.Length - 4), PdfBytes()));bool ordinaryReworkArchiveRejected = false;
        try { storage.ArchiveEvidence("mapping-key", reworkCollisionRelative); } catch (InvalidDataException) { ordinaryReworkArchiveRejected = true; }
        Assert(ordinaryReworkArchiveRejected && File.Exists(reworkCollisionPath), "Ordinary archive requests must not move files out of managed Rework storage.");
        var reworkCollisionArchive = (Dictionary<string, object>)Json.DeserializeObject(storage.ArchiveEvidence("mapping-key", reworkCollisionRelative, null, true));string reworkCollisionArchivedRelative = Convert.ToString(reworkCollisionArchive["archived"]);
        Assert(!File.Exists(reworkCollisionPath) && reworkCollisionArchivedRelative.StartsWith("Organizations/GOV/GOV Archive/", StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(root, reworkCollisionArchivedRelative.Replace('/', Path.DirectorySeparatorChar))), "Operator-approved collision cleanup should transactionally archive a verified loser from its organization Rework folder.");
        string protectedSupportDirectory = Path.Combine(root, "System", "Reports");Directory.CreateDirectory(protectedSupportDirectory);string protectedSupportName = "support.pdf", protectedSupportPath = Path.Combine(protectedSupportDirectory, protectedSupportName);File.WriteAllBytes(protectedSupportPath, PdfBytes());bool protectedSupportRejected = false;
        try { storage.ArchiveEvidence("mapping-key", Path.Combine("System", "Reports", protectedSupportName), null, true); } catch (InvalidDataException) { protectedSupportRejected = true; }
        Assert(protectedSupportRejected && File.Exists(protectedSupportPath), "The collision-cleanup exception must remain limited to organization Rework evidence and reject protected System files.");
        bool rejectedUnsafeRename = false;
        try { storage.NormalizeEvidenceFilename("mapping-key", Path.Combine("Organizations", "GOV", "GOV User Agreement", normalizedDateName), "..\\escape.zip"); } catch (InvalidDataException) { rejectedUnsafeRename = true; }
        Assert(rejectedUnsafeRename, "Date normalization should reject an unsafe target filename.");
        string olderEvidence = storage.StoreEvidence("mapping-key", "GOV", "SAAR", "Shaw_Vivian_SAAR_24AUG2025.pdf.zip", EvidenceZip("Shaw_Vivian_SAAR_24AUG2025.pdf", PdfBytes()));
        string olderRelative = Path.Combine("Organizations", "GOV", "GOV SAAR", olderEvidence), archiveResult = storage.ArchiveEvidence("mapping-key", olderRelative);
        var archiveResponse = (Dictionary<string, object>)Json.DeserializeObject(archiveResult);
        string archivedRelative = Convert.ToString(archiveResponse["archived"]), archivedPath = LocalEvidenceFile(storage, "mapping-key", archivedRelative), olderPhysical = Path.Combine(localEvidenceRoot, "Organizations", "GOV", olderEvidence);
        Assert(!File.Exists(olderPhysical) && File.Exists(archivedPath) && archivedRelative.StartsWith("Organizations/GOV/GOV SAAR Archive/", StringComparison.OrdinalIgnoreCase), "Approved SAAR cleanup should move the local access-request record into the permanent organization SAAR Archive without deleting it.");
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
        string looseRelative = Path.Combine("Organizations", "GOV", "GOV User Agreement", "Shaw_Vivian_GEN_User_Agreement_24AUG2026.pdf"), loosePath = Path.Combine(localEvidenceRoot, looseRelative);
        Directory.CreateDirectory(Path.GetDirectoryName(loosePath));File.WriteAllBytes(loosePath, PdfBytes());
        var compressionResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.CompressEvidence("mapping-key", looseRelative));
        string compressedRelative = Convert.ToString(compressionResponse["compressed"]), compressedPath = LocalEvidenceFile(storage, "mapping-key", compressedRelative);
        Assert(!File.Exists(loosePath) && File.Exists(compressedPath) && Convert.ToBoolean(compressionResponse["sourceRemoved"]) && !Convert.ToBoolean(compressionResponse["sourcePreserved"]), "Validated local compression should create and verify the ZIP before deleting its source PDF.");
        string repeatedCompression = storage.CompressEvidence("mapping-key", looseRelative);
        Assert(repeatedCompression.Contains("\"alreadyCompleted\":true") && repeatedCompression.Contains("Shaw_Vivian_GEN_User_Agreement_24AUG2026.pdf.zip"), "A repeated cleanup request should recognize the validated ZIP instead of reporting its removed PDF as missing.");
        using (var compressedStream = File.OpenRead(compressedPath))
        using (var compressedArchive = new ZipArchive(compressedStream, ZipArchiveMode.Read))
            Assert(compressedArchive.Entries.Count == 1 && compressedArchive.Entries[0].FullName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase), "Cleanup compression should create a ZIP containing exactly one PDF.");
        Assert(storage.ListEvidenceLocations("mapping-key").Contains("Shaw_Vivian_GEN_User_Agreement_24AUG2026.pdf.zip"), "The compressed local evidence should remain available to metadata refresh and publication without requiring a shared-drive rescan.");
        string exactCoexistRelative = Path.Combine("Organizations", "GOV", "GOV DoD Cyber Cert", "Exact_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf"), exactCoexistPath = Path.Combine(localEvidenceRoot, exactCoexistRelative), exactZipPath = exactCoexistPath + ".zip", completeOriginalDirectory = Path.Combine(localEvidenceRoot, "Organizations", "GOV", "GOV Complete", "Original PDFs");int completeOriginalCount = Directory.Exists(completeOriginalDirectory) ? Directory.EnumerateFiles(completeOriginalDirectory, "*.pdf", SearchOption.TopDirectoryOnly).Count() : 0;
        Directory.CreateDirectory(Path.GetDirectoryName(exactCoexistPath));File.WriteAllBytes(exactCoexistPath, PdfBytes());File.WriteAllBytes(exactZipPath, EvidenceZip(Path.GetFileName(exactCoexistPath), PdfBytes()));
        string exactCoexistResult = storage.CompressEvidence("mapping-key", exactCoexistRelative);
        Assert(exactCoexistResult.Contains("\"alreadyCompleted\":true") && exactCoexistResult.Contains("\"sourceRemoved\":true") && !File.Exists(exactCoexistPath) && File.Exists(exactZipPath) && (Directory.Exists(completeOriginalDirectory) ? Directory.EnumerateFiles(completeOriginalDirectory, "*.pdf", SearchOption.TopDirectoryOnly).Count() : 0) == completeOriginalCount, "A matching loose PDF and existing verified ZIP should complete idempotently while deleting the redundant source PDF.");
        string conflictRelative = Path.Combine("Organizations", "GOV", "GOV DoD Cyber Cert", "Conflict_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf"), conflictPath = Path.Combine(localEvidenceRoot, conflictRelative), conflictZipPath = conflictPath + ".zip";
        byte[] alternatePdf = Encoding.ASCII.GetBytes("%PDF-1.4\n% alternate evidence\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");File.WriteAllBytes(conflictPath, PdfBytes());File.WriteAllBytes(conflictZipPath, EvidenceZip(Path.GetFileName(conflictPath), alternatePdf));bool compressionCollisionObserved = false;
        try { storage.CompressEvidence("mapping-key", conflictRelative); } catch (IOException error) { compressionCollisionObserved = error.Message.Contains("collision review"); }
        Assert(compressionCollisionObserved && File.Exists(conflictPath) && File.Exists(conflictZipPath), "Different PDFs sharing one compression destination must both remain intact for collision review.");
        string longCompressionDirectory = Path.Combine(localEvidenceRoot, "Organizations", "GOV", "GOV User Agreement");
        Directory.CreateDirectory(longCompressionDirectory);
        string longCompressionPrefix = "Shaw_Vivian_GEN_User_Agreement_", longCompressionSuffix = "_24AUG2026.pdf";
        int longCompressionFill = Math.Max(1, 235 - longCompressionDirectory.Length - 1 - longCompressionPrefix.Length - longCompressionSuffix.Length);
        string longCompressionName = longCompressionPrefix + new string('X', longCompressionFill) + longCompressionSuffix, longCompressionPath = Path.Combine(longCompressionDirectory, longCompressionName), longCompressionRelative = Path.Combine("Organizations", "GOV", "GOV User Agreement", longCompressionName);
        Assert(longCompressionPath.Length >= 230 && longCompressionPath.Length < 248, "The long-path compression regression fixture should approach the legacy Windows limit without exceeding the source-file limit.");
        File.WriteAllBytes(longCompressionPath, PdfBytes());
        var longCompressionResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.CompressEvidence("mapping-key", longCompressionRelative));
        string longCompressedRelative = Convert.ToString(longCompressionResponse["compressed"]), longCompressedPath = LocalEvidenceFile(storage, "mapping-key", longCompressedRelative);
        Assert(!File.Exists(longCompressionPath) && File.Exists(longCompressedPath), "Local compression should use a short temporary name and delete the source only after ZIP verification without exceeding the Windows path limit.");

        string longEvidenceDirectory = Path.Combine(localEvidenceRoot, "Organizations", "GOV"), longEvidencePrefix = "Shaw_Vivian_GEN_User_Agreement_", longEvidenceSuffix = "_24AUG2026.pdf.zip";
        int longEvidenceFill = Math.Max(1, 235 - longEvidenceDirectory.Length - 1 - longEvidencePrefix.Length - longEvidenceSuffix.Length);
        string longEvidenceName = longEvidencePrefix + new string('Y', longEvidenceFill) + longEvidenceSuffix, longEvidencePdfName = longEvidenceName.Substring(0, longEvidenceName.Length - 4);
        string storedLongEvidence = storage.StoreEvidence("mapping-key", "GOV", "User Agreement", longEvidenceName, EvidenceZip(longEvidencePdfName, PdfBytes())), storedLongEvidencePath = Path.Combine(longEvidenceDirectory, storedLongEvidence);
        Assert(storedLongEvidencePath.Length >= 230 && File.Exists(storedLongEvidencePath), "Atomic evidence storage should use short temporary and rollback names near the Windows path limit.");
        string manualStagingRoot = Convert.ToString(typeof(PortableStorage).GetMethod("LocalPerformanceCacheDirectory", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(storage, new object[] { root, "Manual Evidence Staging" }));
        Assert(Path.Combine(manualStagingRoot, new string('a', 32), longEvidenceName).Length >= 260, "The PDF upload regression must exceed MAX_PATH if staging repeats the full evidence filename.");
        var longPdfUpload = (Dictionary<string, object>)Json.DeserializeObject(storage.StoreEvidencePdf("mapping-key", "GOV", "User Agreement", longEvidenceName, PdfBytes()));
        using (var longPdfZip = ZipFile.OpenRead(storedLongEvidencePath)) Assert(longPdfZip.Entries.Count == 1 && longPdfZip.Entries[0].FullName == longEvidencePdfName && Convert.ToString(longPdfUpload["filename"]) == longEvidenceName && storage.VerifyStoredEvidencePdf("mapping-key", "GOV", "User Agreement", longEvidenceName, Sha256(PdfBytes())).Contains("\"stored\":true"), "PDF upload must use short staging names while preserving the full canonical PDF name inside the verified ZIP.");
        File.WriteAllText(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.txt"), "not evidence");
        File.WriteAllBytes(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf"), Encoding.ASCII.GetBytes("not a pdf"));
        scan = storage.Scan("mapping-key", "legacy", true);
        object[] scannedItems = (object[])Json.DeserializeObject(scan);
        Dictionary<string, object> textItem = ItemNamed(scannedItems, "Shaw_Vivian_DOD_Cyber_24AUG2026.txt");
        Dictionary<string, object> fakePdfItem = ItemNamed(scannedItems, "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf");
        Assert(!Convert.ToBoolean(textItem["accepted"]) && Convert.ToString(textItem["error"]).Contains("Only PDF evidence"), "Directory scan should reject non-PDF evidence.");
        Assert(!Convert.ToBoolean(fakePdfItem["accepted"]), "Directory scan should reject a renamed non-PDF file.");
        string correctionRelative = "Shaw_Vivian_GEN_SAAR_24AUG2026.pdf", correctionPath = Path.Combine(root, correctionRelative);
        File.WriteAllBytes(correctionPath, Encoding.ASCII.GetBytes("correction required"));
        var reworkResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.MoveEvidenceToRework("mapping-key", correctionRelative));
        string reworkedRelative = Convert.ToString(reworkResponse["reworked"]), reworkedPath = Path.Combine(root, reworkedRelative.Replace('/', Path.DirectorySeparatorChar));
        string rootOrganization = new DirectoryInfo(root).Name;
        Assert(!File.Exists(correctionPath) && File.Exists(reworkedPath) && reworkedRelative.StartsWith(rootOrganization + " Rework/", StringComparison.OrdinalIgnoreCase), "A correction PDF at the organization root should move into that organization's named Rework folder even when its PDF bytes are invalid.");
        object[] correctionScanItems = (object[])Json.DeserializeObject(storage.Scan("mapping-key", "legacy", true));
        Dictionary<string, object> rejectedCorrection = ItemNamed(correctionScanItems, "Shaw_Vivian_GEN_SAAR_24AUG2026.pdf");
        Assert(!Convert.ToBoolean(rejectedCorrection["accepted"]) && Convert.ToString(rejectedCorrection["path"]).IndexOf(" Rework", StringComparison.OrdinalIgnoreCase) >= 0, "Sync should inspect Rework corrections and retain unreadable corrections there with a validation failure.");
        string nestedReworkDirectory = Path.Combine(root, "NGC", "Privileged", "Miller_Ava");
        Directory.CreateDirectory(nestedReworkDirectory);
        string nestedReworkName = "Miller_Ava_(NGC)_GEN_SAAR_24AUG2026.pdf", nestedReworkPath = Path.Combine(nestedReworkDirectory, nestedReworkName);
        File.WriteAllBytes(nestedReworkPath, Encoding.ASCII.GetBytes("correction required"));
        var nestedReworkResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.MoveEvidenceToRework("mapping-key", Path.Combine("NGC", "Privileged", "Miller_Ava", nestedReworkName)));
        string nestedReworkedRelative = Convert.ToString(nestedReworkResponse["reworked"]);
        Assert(nestedReworkedRelative.StartsWith("NGC/NGC Rework/", StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(root, nestedReworkedRelative.Replace('/', Path.DirectorySeparatorChar))), "A nested organization should receive its own organization-named Rework folder.");
        string localNgcRework = Path.Combine(localEvidenceRoot, "Organizations", "NGC", "NGC Rework");Directory.CreateDirectory(localNgcRework);
        string promotableCorrectionName = "Miller_Ava_(NGC)_User_Agreement_24AUG2026.pdf", promotableCorrectionPath = Path.Combine(localNgcRework, promotableCorrectionName);
        File.WriteAllBytes(promotableCorrectionPath, PdfBytes());
        object[] promotableScanItems = (object[])((Dictionary<string, object>)Json.DeserializeObject(storage.ScanWithJournal("mapping-key", "rework-mode-rules", false, null, false)))["items"];
        Dictionary<string, object> promotableCorrection = ItemNamed(promotableScanItems, promotableCorrectionName);
        Assert(Convert.ToBoolean(promotableCorrection["accepted"]) && Convert.ToString(promotableCorrection["path"]).IndexOf("NGC Rework", StringComparison.OrdinalIgnoreCase) >= 0, "Sync should validate a readable corrected PDF inside an organization Rework folder.");
        object[] repeatedDailyReworkScanItems = (object[])((Dictionary<string, object>)Json.DeserializeObject(storage.ScanWithJournal("mapping-key", "rework-mode-rules", false, null, false)))["items"];
        Dictionary<string, object> repeatedDailyReworkCorrection = ItemNamed(repeatedDailyReworkScanItems, promotableCorrectionName);
        Assert(Convert.ToBoolean(repeatedDailyReworkCorrection["unchanged"]), "Daily Sync should reuse validated unchanged Rework evidence for fast routine operation.");
        object[] fullDailyReworkScanItems = (object[])((Dictionary<string, object>)Json.DeserializeObject(storage.ScanWithJournal("mapping-key", "rework-mode-rules-v2", false, null, false)))["items"];
        Dictionary<string, object> fullyRevalidatedReworkCorrection = ItemNamed(fullDailyReworkScanItems, promotableCorrectionName);
        Assert(!Convert.ToBoolean(fullyRevalidatedReworkCorrection["unchanged"]), "A local rule-set change must revalidate unchanged Rework evidence for recovery.");
        var promotionResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.OrganizeEvidence("mapping-key", Convert.ToString(fullyRevalidatedReworkCorrection["path"]), "User Agreement"));
        string promotedRelative = Convert.ToString(promotionResponse["organized"]), promotedPath = LocalEvidenceFile(storage, "mapping-key", promotedRelative);
        Assert(promotedRelative.StartsWith("Organizations/NGC/NGC User Agreement/", StringComparison.OrdinalIgnoreCase) && File.Exists(promotedPath) && !File.Exists(promotableCorrectionPath), "A validated local Rework correction should move into its organization-prefixed canonical document-type folder with its source removed only after verification.");
        string invalidZipName = "Miller Ava (NGC) GEN SAAR 20260826.zip", invalidZipRelative = Path.Combine("NGC", "Privileged", "Miller_Ava", invalidZipName), invalidZipPath = Path.Combine(root, invalidZipRelative), embeddedPdfName = "Miller_Ava_(NGC)_GEN_SAAR_20260826.pdf";
        File.WriteAllBytes(invalidZipPath, EvidenceZip(embeddedPdfName, PdfBytes()));
        var extractedReworkResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.MoveEvidenceToRework("mapping-key", invalidZipRelative));
        string extractedReworkRelative = Convert.ToString(extractedReworkResponse["reworked"]), extractedReworkPath = Path.Combine(root, extractedReworkRelative.Replace('/', Path.DirectorySeparatorChar));
        Assert(Convert.ToBoolean(extractedReworkResponse["extracted"]) && File.Exists(invalidZipPath) && File.Exists(extractedReworkPath) && extractedReworkPath.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase), "An invalidly named one-PDF ZIP should be extracted to a loose PDF in the organization Rework folder while preserving the source ZIP.");
        Assert(File.ReadAllBytes(extractedReworkPath).SequenceEqual(PdfBytes()), "The Rework extraction must preserve the embedded PDF bytes exactly.");
        string interruptedZipName = "Miller Ava (NGC) User Agreement 20260827.zip", interruptedZipRelative = Path.Combine("NGC", "Privileged", "Miller_Ava", interruptedZipName), interruptedZipPath = Path.Combine(root, interruptedZipRelative), interruptedPdfName = "Miller_Ava_(NGC)_User_Agreement_20260827.pdf", interruptedPdfPath = Path.Combine(root, "NGC", "NGC Rework", interruptedPdfName);File.WriteAllBytes(interruptedZipPath, EvidenceZip(interruptedPdfName, PdfBytes()));bool reworkInterruptionObserved = false;
        try { PortableStorage.FailAfterStageForTests = "rework-extract-move";storage.MoveEvidenceToRework("mapping-key", interruptedZipRelative); } catch (IOException) { reworkInterruptionObserved = true; } finally { PortableStorage.FailAfterStageForTests = null; }
        Assert(reworkInterruptionObserved && File.Exists(interruptedZipPath) && File.Exists(interruptedPdfPath), "An interrupted ZIP extraction should retain the source while preserving the verified destination for transaction recovery.");
        storage.Scan("mapping-key", "legacy", true);
        Assert(File.Exists(interruptedZipPath) && File.Exists(interruptedPdfPath) && File.ReadAllBytes(interruptedPdfPath).SequenceEqual(PdfBytes()), "Transaction recovery should verify the extracted PDF while retaining the interrupted source ZIP.");
        string bulkUnarchiveDirectory = Path.Combine(root, "Bulk Unarchive"), nestedBulkUnarchiveDirectory = Path.Combine(bulkUnarchiveDirectory, "Nested");Directory.CreateDirectory(nestedBulkUnarchiveDirectory);
        string bulkZipOne = Path.Combine(bulkUnarchiveDirectory, "Shaw_Vivian_(GOV)_GEN_SAAR_24AUG2026.pdf.zip"), bulkZipTwo = Path.Combine(nestedBulkUnarchiveDirectory, "Miller_Ava_(NGC)_User_Agreement_24AUG2026.pdf.zip");File.WriteAllBytes(bulkZipOne, EvidenceZip("Shaw_Vivian_(GOV)_GEN_SAAR_24AUG2026.pdf", PdfBytes()));File.WriteAllBytes(bulkZipTwo, EvidenceZip("Miller_Ava_(NGC)_User_Agreement_24AUG2026.pdf", PdfBytes()));
        var unarchiveList = (Dictionary<string, object>)Json.DeserializeObject(storage.ListUnarchiveCandidates("mapping-key", new[] { bulkUnarchiveDirectory }, true));object[] unarchiveItems = (object[])unarchiveList["items"];
        Assert(unarchiveItems.Length == 2, "Bulk Unarchive should discover ZIP evidence recursively beneath the selected mapped-system folder.");
        string bulkRelativeOne = Path.Combine("Bulk Unarchive", Path.GetFileName(bulkZipOne));var unarchiveResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.UnarchiveEvidence("mapping-key", bulkRelativeOne));string unarchivedRelative = Convert.ToString(unarchiveResponse["unarchived"]), unarchivedPath = Path.Combine(root, unarchivedRelative.Replace('/', Path.DirectorySeparatorChar));
        Assert(File.Exists(bulkZipOne) && File.Exists(unarchivedPath) && File.ReadAllBytes(unarchivedPath).SequenceEqual(PdfBytes()) && !Convert.ToBoolean(unarchiveResponse["sourceRemoved"]), "Unarchive should preserve its source ZIP after the extracted PDF is validated and SHA-256 verified.");
        string reworkDirectory = Path.Combine(root, "NGC", "NGC Rework"), archiveDate = DateTime.UtcNow.Date.AddYears(-2).AddDays(-1).ToString("ddMMMyyyy", CultureInfo.InvariantCulture).ToUpperInvariant(), graceDate = DateTime.UtcNow.Date.AddYears(-1).AddDays(-60).ToString("ddMMMyyyy", CultureInfo.InvariantCulture).ToUpperInvariant(), supersededDate = DateTime.UtcNow.Date.AddYears(-6).ToString("ddMMMyyyy", CultureInfo.InvariantCulture).ToUpperInvariant(), currentDate = DateTime.UtcNow.Date.AddMonths(-6).ToString("ddMMMyyyy", CultureInfo.InvariantCulture).ToUpperInvariant(), oldSaarDate = DateTime.UtcNow.Date.AddYears(-8).ToString("ddMMMyyyy", CultureInfo.InvariantCulture).ToUpperInvariant();
        string oldReworkName = "Miller_Ava_(WRONG)_DoD_Cyber_Cert_" + archiveDate + ".pdf", graceReworkName = "Miller_Ava_(WRONG)_User_Agreement_" + graceDate + ".pdf", supersededReworkName = "Miller_Ava_(WRONG)_User_Agreement_" + supersededDate + ".pdf.zip", currentReworkName = "Miller_Ava_(WRONG)_DoD_Cyber_Cert_" + currentDate + ".pdf", oldSaarReworkName = "Miller_Ava_(WRONG)_PRIV_DTA_SAAR_" + oldSaarDate + ".pdf", oldYearOnlyName = "Miller_Ava_(WRONG)_DoD_Cyber_Cert_" + DateTime.UtcNow.Date.AddYears(-2).Year.ToString(CultureInfo.InvariantCulture) + ".pdf", currentYearOnlyName = "Miller_Ava_(WRONG)_DoD_Cyber_Cert_" + DateTime.UtcNow.Date.AddYears(-1).Year.ToString(CultureInfo.InvariantCulture) + ".pdf", disabledSaarName = "Miller_Ava_(NGC)_GEN_SAAR_DISABLED_" + currentDate + ".pdf", activeExpiredName = "Miller_Ava_(NGC)_User_Agreement_" + archiveDate + ".pdf", expired8570Name = "Miller_Ava_(NGC)_8570_Memo_" + archiveDate + ".pdf", grace8570Name = "Miller_Ava_(NGC)_8570_Memo_" + graceDate + ".pdf", misplacedDate = DateTime.UtcNow.Date.AddYears(-4).ToString("ddMMMyyyy", CultureInfo.InvariantCulture).ToUpperInvariant(), misplacedAgreementName = "Miller_Ava_(NGC)_User_Agreement_" + misplacedDate + ".pdf", misplacedDisabledSaarName = "Miller_Ava_(NGC)_GEN_SAAR_DISABLED_" + oldSaarDate + ".pdf";
        File.WriteAllBytes(Path.Combine(reworkDirectory, oldReworkName), Encoding.ASCII.GetBytes("old filename correction"));
        File.WriteAllBytes(Path.Combine(reworkDirectory, graceReworkName), Encoding.ASCII.GetBytes("evidence inside overdue grace period"));
        File.WriteAllBytes(Path.Combine(reworkDirectory, supersededReworkName), EvidenceZip(supersededReworkName.Substring(0, supersededReworkName.Length - 4), PdfBytes()));
        File.WriteAllBytes(Path.Combine(reworkDirectory, currentReworkName), Encoding.ASCII.GetBytes("current correction"));
        File.WriteAllBytes(Path.Combine(reworkDirectory, oldSaarReworkName), Encoding.ASCII.GetBytes("non-expiring SAAR correction"));
        string renamableReworkName = "Jones Maria (WRONG) DoD Cyber Cert " + currentDate + ".pdf", canonicalReworkName = "Jones_Maria_(NGC)_DoD_Cyber_Cert_" + currentDate + ".pdf", renamableReworkRelative = Path.Combine("NGC", "NGC Rework", renamableReworkName);
        File.WriteAllBytes(Path.Combine(reworkDirectory, renamableReworkName), PdfBytes());
        var normalizedReworkResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.NormalizeEvidenceFilename("mapping-key", renamableReworkRelative, canonicalReworkName));
        string normalizedReworkRelative = Convert.ToString(normalizedReworkResponse["renamed"]), normalizedReworkPath = Path.Combine(root, normalizedReworkRelative.Replace('/', Path.DirectorySeparatorChar));
        Assert(!File.Exists(Path.Combine(reworkDirectory, renamableReworkName)) && File.Exists(normalizedReworkPath), "Document Renamer should normalize a corrected loose PDF inside its organization's Rework folder without changing its contents.");
        var organizedReworkResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.OrganizeEvidence("mapping-key", normalizedReworkRelative, "DoD Cyber Cert"));
        string organizedReworkRelative = Convert.ToString(organizedReworkResponse["organized"]);
        Assert(organizedReworkRelative.StartsWith("NGC/NGC DoD Cyber Cert/", StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(root, organizedReworkRelative.Replace('/', Path.DirectorySeparatorChar))) && !File.Exists(normalizedReworkPath), "A normalized Rework PDF should promote into the organization's prefixed document-type folder after strict validation.");
        File.WriteAllBytes(Path.Combine(reworkDirectory, oldYearOnlyName), Encoding.ASCII.GetBytes("old year-only correction"));
        File.WriteAllBytes(Path.Combine(reworkDirectory, currentYearOnlyName), Encoding.ASCII.GetBytes("current year-only correction"));
        File.WriteAllBytes(Path.Combine(nestedReworkDirectory, disabledSaarName), Encoding.ASCII.GetBytes("disabled access request"));
        File.WriteAllBytes(Path.Combine(nestedReworkDirectory, activeExpiredName), Encoding.ASCII.GetBytes("expired active agreement"));
        File.WriteAllBytes(Path.Combine(nestedReworkDirectory, expired8570Name), Encoding.ASCII.GetBytes("expired legacy certification memo"));
        string legacy8570Folder = Path.Combine(root, "NGC", "8140 Certification Memo");Directory.CreateDirectory(legacy8570Folder);File.WriteAllBytes(Path.Combine(legacy8570Folder, grace8570Name), PdfBytes());
        string existingSupersededDirectory = Path.Combine(root, "NGC", "NGC Archive", "Superseded");Directory.CreateDirectory(existingSupersededDirectory);
        File.WriteAllBytes(Path.Combine(existingSupersededDirectory, misplacedAgreementName), Encoding.ASCII.GetBytes("incorrectly superseded agreement"));
        File.WriteAllBytes(Path.Combine(existingSupersededDirectory, misplacedDisabledSaarName), Encoding.ASCII.GetBytes("incorrectly superseded SAAR"));
        string looseArchiveDirectory = Path.Combine(root, "NGC", "NGC Archive", DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)), looseArchivePdf = "Miller_Ava_(NGC)_User_Agreement_24AUG2025.pdf";Directory.CreateDirectory(looseArchiveDirectory);File.WriteAllBytes(Path.Combine(looseArchiveDirectory, looseArchivePdf), PdfBytes());
        string permanentSaarDirectory = Path.Combine(root, "NGC", "NGC SAAR Archive"), loosePermanentSaar = "Miller_Ava_(NGC)_GEN_SAAR_24AUG2020.pdf", unrelatedPermanentArchiveFile = "Miller_Ava_(NGC)_User_Agreement_24AUG2020.pdf";Directory.CreateDirectory(permanentSaarDirectory);File.WriteAllBytes(Path.Combine(permanentSaarDirectory, loosePermanentSaar), PdfBytes());File.WriteAllBytes(Path.Combine(permanentSaarDirectory, unrelatedPermanentArchiveFile), PdfBytes());
        string rejectedExtension = Path.Combine(nestedReworkDirectory, "Miller_Ava_(NGC)_unsupported.docx");File.WriteAllText(rejectedExtension, "unsupported evidence format", Encoding.UTF8);
        string incompleteEvidence = Path.Combine(nestedReworkDirectory, "Miller_Ava_(NGC)_User_Agreement_INCOMPLETE.pdf");File.WriteAllBytes(incompleteEvidence, PdfBytes());
        var retentionResponse = (Dictionary<string, object>)Json.DeserializeObject(storage.ProcessReworkRetention("mapping-key"));object[] retentionMoves = (object[])retentionResponse["moved"];
        object[] retentionCompressed = (object[])retentionResponse["compressed"];
        object[] retentionDeleted = (object[])retentionResponse["deleted"], retentionPreserved = (object[])retentionResponse["preserved"];
        Assert(retentionMoves.Length >= 4, "Archive preflight should move disabled SAARs, repair misplaced archives, and reject unsupported active files without removing evidence solely because it is overdue.");
        Assert(retentionMoves.Cast<Dictionary<string, object>>().Any(item => Convert.ToString(item["bucket"]) == "Unaccepted File Format"), "An unsupported active file should be moved to the organization Rework folder and explicitly classified as an unaccepted format.");
        Assert(retentionCompressed.Length == 0 && File.Exists(Path.Combine(looseArchiveDirectory, looseArchivePdf)) && !File.Exists(Path.Combine(looseArchiveDirectory, looseArchivePdf + ".zip")) && File.Exists(Path.Combine(permanentSaarDirectory, loosePermanentSaar)) && !File.Exists(Path.Combine(permanentSaarDirectory, loosePermanentSaar + ".zip")), "Shared-drive Archive and SAAR Archive PDFs should be preserved without automatic network compression.");
        Assert(retentionDeleted.Length == 0 && retentionPreserved.Length == 1 && File.Exists(incompleteEvidence) && Convert.ToString(((Dictionary<string, object>)retentionPreserved[0])["sha256"]).Length == 64 && Convert.ToBoolean(((Dictionary<string, object>)retentionPreserved[0])["auditRecorded"]), "Operator-marked Incomplete evidence should be preserved and recorded immediately with its SHA-256 audit evidence.");
        Assert(File.Exists(Path.Combine(reworkDirectory, oldReworkName)), "Overdue Rework evidence should remain available for correction instead of being archived by age alone.");
        Assert(File.Exists(Path.Combine(reworkDirectory, supersededReworkName.Substring(0, supersededReworkName.Length - 4))), "Even very old Rework evidence should remain present after ZIP extraction until an explicit archive, duplicate-cleanup, disable, or delete action occurs.");
        Assert(File.Exists(Path.Combine(reworkDirectory, oldYearOnlyName)), "A year-only filename is incomplete and must stay in Rework instead of driving an Archive decision.");
        Assert(File.Exists(Path.Combine(root, "NGC", "NGC SAAR Archive", disabledSaarName)), "A SAAR with a standalone DISABLED filename marker should move to the permanent organization SAAR Archive before evidence validation.");
        Assert(File.Exists(Path.Combine(root, "NGC", "NGC SAAR Archive", misplacedDisabledSaarName)) && !File.Exists(Path.Combine(existingSupersededDirectory, misplacedDisabledSaarName)), "A SAAR previously placed in Superseded should be recovered into the permanent organization SAAR Archive.");
        Assert(File.Exists(Path.Combine(root, "NGC", "NGC Archive", DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), misplacedAgreementName)) && !File.Exists(Path.Combine(existingSupersededDirectory, misplacedAgreementName)), "Evidence less than five years old should be repaired out of Superseded into the dated organization Archive.");
        Assert(File.Exists(Path.Combine(nestedReworkDirectory, activeExpiredName)), "Overdue evidence in an active or Rework folder should remain present and be reported Overdue indefinitely.");
        Assert(File.Exists(Path.Combine(nestedReworkDirectory, expired8570Name)), "Legacy 8570 evidence should remain present when overdue instead of being archived by age alone.");
        Assert(File.Exists(Path.Combine(legacy8570Folder, grace8570Name)), "An overdue legacy 8570 file in the 8140 Certification Memo folder should remain active until explicitly replaced or archived.");
        Assert(File.Exists(Path.Combine(reworkDirectory, currentReworkName)) && File.Exists(Path.Combine(reworkDirectory, graceReworkName)) && File.Exists(Path.Combine(reworkDirectory, oldYearOnlyName)) && File.Exists(Path.Combine(reworkDirectory, currentYearOnlyName)) && File.Exists(Path.Combine(reworkDirectory, oldSaarReworkName)), "Current, overdue, incomplete year-only, and SAAR evidence must remain available for validation or correction regardless of age.");
        storage.ProcessReworkRetention("mapping-key", "legacy", false);storage.Scan("mapping-key", "legacy", false);
        var incrementalRetention = (Dictionary<string, object>)Json.DeserializeObject(storage.ProcessReworkRetention("mapping-key", "legacy", false));
        Assert(!Convert.ToBoolean(incrementalRetention["dailyFullSweep"]) && Convert.ToInt32(incrementalRetention["unchangedSkipped"]) > 0, "After the UTC-daily retention sweep, later Sync preflight runs should skip unchanged indexed evidence while continuing to inspect Rework.");
        string organizedSourceRelative = Path.Combine("Organizations", "GOV", "GOV SAAR", evidence), organizedResponseText = storage.OrganizeEvidence("mapping-key", organizedSourceRelative, "SAAR");var organizedResponse = (Dictionary<string, object>)Json.DeserializeObject(organizedResponseText);string organizedRelative = Convert.ToString(organizedResponse["organized"]);
        Assert(organizedRelative.StartsWith("Organizations/GOV/GOV SAAR/", StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(root, organizedRelative.Replace('/', Path.DirectorySeparatorChar))), "Accepted active evidence should remain in its organization-prefixed canonical document-type folder with content integrity preserved.");
        string postCleanupScan = storage.Scan("mapping-key", "legacy", true);
        Assert(!postCleanupScan.Contains(nestedArchiveName) && postCleanupScan.Contains(nestedReworkName), "Organization Archive folders must remain excluded while Rework corrections remain visible to later Sync validation.");
        Assert(!postCleanupScan.Contains(loosePermanentSaar) && !postCleanupScan.Contains(unrelatedPermanentArchiveFile), "Sync must exclude permanent SAAR Archive files from account-state discovery.");
        bool rejectedInvalidCompression = false;
        try { storage.CompressEvidence("mapping-key", "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf"); } catch (InvalidOperationException) { rejectedInvalidCompression = true; }
        Assert(rejectedInvalidCompression && File.Exists(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf")) && !File.Exists(Path.Combine(root, "Shaw_Vivian_DOD_Cyber_24AUG2026.pdf.zip")), "Shared-drive loose-PDF compression should be rejected while preserving the original network file.");
        bool rejectedFakeZip = false, rejectedNonPdfEntry = false;
        try { storage.StoreEvidence("mapping-key", "GOV", "DoD Cyber Cert", "fake.zip", new byte[] { 1, 2, 3 }); } catch (InvalidDataException) { rejectedFakeZip = true; }
        try { storage.StoreEvidence("mapping-key", "GOV", "DoD Cyber Cert", "text.zip", EvidenceZip("evidence.txt", Encoding.UTF8.GetBytes("text"))); } catch (InvalidDataException) { rejectedNonPdfEntry = true; }
        Assert(rejectedFakeZip, "Launcher storage should reject bytes that are not a ZIP.");
        Assert(rejectedNonPdfEntry, "Launcher storage should reject a ZIP containing a non-PDF file.");
        string reportResult = storage.StoreReport("mapping-key", "Compliance-Snapshot_TEST.pdf", PdfBytes());
        Assert(reportResult.Contains("\"sha256\"") && File.Exists(Path.Combine(root, "System", "Reports", "Compliance-Snapshot_TEST.pdf")) && File.Exists(Path.Combine(root, "System", "Reports", "Compliance-Snapshot_TEST.pdf.sha256")), "Compliance reports should be stored with a matching SHA-256 file.");
        string errorReportResult = storage.StoreErrorReport("mapping-key", "ERR-TEST.txt", "R.A.P.T.O.R. Error Entry\r\nDetails: simulated failure");
        string secondErrorReportResult = storage.StoreErrorReport("mapping-key", "ERR-SECOND.txt", "R.A.P.T.O.R. Error Entry\r\nDetails: second simulated failure");
        storage.StoreErrorReport("mapping-key", "ERR-PRIVATE.txt", "Report ID: ERR-PRIVATE\r\nContext: User evidence Sync failed for Shaw_Vivian_(GOV).pdf\r\nDetails: DOMAIN\\private-operator and private@example.mil at C:\\Sensitive\\Evidence");
        string dailyErrorName = "error-report-" + DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ".txt", dailyErrorPath = Path.Combine(root, "System", "Error Reports", dailyErrorName), dailyErrorText = File.ReadAllText(dailyErrorPath, Encoding.UTF8);
        Assert(errorReportResult.Contains("System/Error Reports/" + dailyErrorName) && secondErrorReportResult.Contains("System/Error Reports/" + dailyErrorName) && dailyErrorText.Contains("simulated failure") && dailyErrorText.Contains("second simulated failure") && Directory.EnumerateFiles(Path.Combine(root, "System", "Error Reports"), "error-report-*.txt").Count() == 1, "Plain-text error entries should append to one UTC-daily Notepad file beneath System/Error Reports.");
        string sanitizedDiagnostics = storage.ReadSanitizedDiagnostics("mapping-key");
        Assert(sanitizedDiagnostics.Contains("\"context\":\"Sync and Reconciliation\"") && sanitizedDiagnostics.Contains("\"errorEntries\":1") && !sanitizedDiagnostics.Contains("Shaw") && !sanitizedDiagnostics.Contains("private@example.mil") && !sanitizedDiagnostics.Contains("private-operator") && !sanitizedDiagnostics.Contains("Sensitive"), "Sanitized diagnostics should expose only fixed categories and counts, never raw error details, identities, filenames, email addresses, or paths.");

        string journalFirst = storage.ScanWithJournal("mapping-key", "journal-rules", true);var journalFirstObject = (Dictionary<string, object>)Json.DeserializeObject(journalFirst);string journalRun = Convert.ToString(journalFirstObject["runId"]);object[] journalFirstItems = (object[])journalFirstObject["items"];
        Assert(journalFirstItems.Cast<Dictionary<string, object>>().Any(item => item.ContainsKey("externalSharedAddition") && Convert.ToBoolean(item["externalSharedAddition"], CultureInfo.InvariantCulture)), "A full shared-folder scan should flag evidence that has no matching local-workspace publication receipt.");
        journalFirst = storage.ScanWithJournal("mapping-key", "journal-rules", false);journalRun = Convert.ToString(((Dictionary<string, object>)Json.DeserializeObject(journalFirst))["runId"]);
        string journalResumed = storage.ScanWithJournal("mapping-key", "journal-rules", false);var journalResumedObject = (Dictionary<string, object>)Json.DeserializeObject(journalResumed);
        Assert(journalRun == Convert.ToString(journalResumedObject["runId"]) && Convert.ToInt32(journalResumedObject["resumedFiles"]) > 0, "An uncommitted Sync journal should resume completed file validation after restart or reconnect.");
        storage.CommitSyncJournal("mapping-key", journalRun);Assert(storage.CommitSyncJournal("mapping-key", journalRun).Contains("\"committed\":true"), "Sync journal commit should be safely repeatable.");
        string incrementalScan = storage.ScanWithJournal("mapping-key", "journal-rules", false);var incrementalScanObject = (Dictionary<string, object>)Json.DeserializeObject(incrementalScan);string incrementalRun = Convert.ToString(incrementalScanObject["runId"]);object[] incrementalItems = (object[])incrementalScanObject["items"];
        var unchangedPaths = new HashSet<string>(incrementalItems.Cast<Dictionary<string, object>>().Where(item => item.ContainsKey("unchanged") && Convert.ToBoolean(item["unchanged"])).Select(item => Convert.ToString(item["path"])), StringComparer.OrdinalIgnoreCase);var incrementalJournalPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);string incrementalJournalPath = Directory.EnumerateFiles(performanceCacheRoot, "sync-" + incrementalRun + ".jsonl", SearchOption.AllDirectories).SingleOrDefault();Assert(!String.IsNullOrWhiteSpace(incrementalJournalPath), "The incremental Sync journal should be retained in the isolated local performance cache.");
        foreach (string line in File.ReadLines(incrementalJournalPath, Encoding.UTF8)) { var entry = (Dictionary<string, object>)Json.DeserializeObject(line);if (entry.ContainsKey("type") && Convert.ToString(entry["type"]) == "file" && entry.ContainsKey("path")) incrementalJournalPaths.Add(Convert.ToString(entry["path"])); }
        Assert(unchangedPaths.Count > 0 && !unchangedPaths.Overlaps(incrementalJournalPaths), "Unchanged indexed evidence should be returned from the fast metadata pass without two durable journal writes per file.");
        Assert(incrementalJournalPath.IndexOf(Path.Combine("performance-cache", ""), StringComparison.OrdinalIgnoreCase) >= 0 && !File.Exists(Path.Combine(root, "System", "Sync Journals", "sync-" + incrementalRun + ".jsonl")), "Resumable Sync journals should remain in the per-Windows-user local performance cache instead of adding per-file writes to the shared drive.");storage.CommitSyncJournal("mapping-key", incrementalRun);
        string interruptedRelative = Path.Combine("GOV", "Transaction_User_(GOV)_User_Agreement_24AUG2026.pdf"), interruptedPath = Path.Combine(root, interruptedRelative), interruptedTarget = "Transaction_User_(GOV)_User_Agreement_25AUG2026.pdf";Directory.CreateDirectory(Path.GetDirectoryName(interruptedPath));File.WriteAllBytes(interruptedPath, PdfBytes());
        bool interruptionObserved = false;try { PortableStorage.FailAfterStageForTests = "rename-move";storage.NormalizeEvidenceFilename("mapping-key", interruptedRelative, interruptedTarget); } catch (IOException) { interruptionObserved = true; } finally { PortableStorage.FailAfterStageForTests = null; }
        Assert(interruptionObserved, "The transaction recovery test must simulate a crash after a completed move.");storage.Map("mapping-key", root);Assert(!File.Exists(interruptedPath) && File.Exists(Path.Combine(Path.GetDirectoryName(interruptedPath), interruptedTarget)) && !Directory.EnumerateFiles(Path.Combine(root, "System", "Storage Transactions"), "transaction-*.json").Any(), "Mapping after an interrupted rename should reconcile the durable transaction without duplicating or losing the file.");
        string pendingRelative = Path.Combine("GOV", "Pending_User_(GOV)_DoD_Cyber_Cert_24AUG2026.pdf"), pendingPath = Path.Combine(localEvidenceRoot, pendingRelative);Directory.CreateDirectory(Path.GetDirectoryName(pendingPath));File.WriteAllBytes(pendingPath, PdfBytes());bool pendingInterrupted = false;try { PortableStorage.FailAfterStageForTests = "scan-file-pending";storage.ScanWithJournal("mapping-key", "pending-rules", false); } catch (IOException) { pendingInterrupted = true; } finally { PortableStorage.FailAfterStageForTests = null; }
        Assert(pendingInterrupted && storage.ScanWithJournal("mapping-key", "pending-rules", false).Contains("Pending_User"), "A crash after a pending Sync journal entry should resume and validate that file on the next run.");
        string auditDirectory = Path.Combine(root, "System", "Audit Logs");int auditBaseline = Directory.Exists(auditDirectory) ? Directory.EnumerateFiles(auditDirectory, "audit-*.jsonl").SelectMany(path => File.ReadLines(path, Encoding.UTF8)).Count() : 0;
        storage.AppendAudit("mapping-key", "TEST ACTION");
        storage.AppendAudit("mapping-key", "SECOND ACTION");
        storage.AppendAuditBatch("mapping-key", new[] { "BATCH ACTION ONE", "BATCH ACTION TWO", "BATCH ACTION THREE" });
        string auditPath = Directory.EnumerateFiles(auditDirectory, "audit-*.jsonl").SingleOrDefault();Assert(!String.IsNullOrWhiteSpace(auditPath), "The shared audit chain should contain exactly one current-day log.");
        var auditBlocker = new FileStream(auditPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        var releaseAuditBlocker = new Thread(new ThreadStart(delegate { Thread.Sleep(100); auditBlocker.Dispose(); }));
        releaseAuditBlocker.Start();
        storage.AppendAudit("mapping-key", "ACTION AFTER TRANSIENT FILE LOCK");
        releaseAuditBlocker.Join();
        string[] auditLines = File.ReadAllLines(auditPath, Encoding.UTF8);
        Assert(auditLines.Length == auditBaseline + 6, "Audit batching and a later append should preserve every explicit audit action after a brief shared-folder file lock clears without logging a deletion for preserved Incomplete evidence. Actual entries: " + auditLines.Length.ToString(CultureInfo.InvariantCulture));
        var firstAudit = (Dictionary<string, object>)Json.DeserializeObject(auditLines[0]);
        var secondAudit = (Dictionary<string, object>)Json.DeserializeObject(auditLines[1]);
        DateTimeOffset auditInstant;
        Assert(Convert.ToString(firstAudit["timestampUtc"]).EndsWith("Z") && DateTimeOffset.TryParse(Convert.ToString(firstAudit["timestampUtc"]), out auditInstant) && auditInstant.Offset == TimeSpan.Zero, "Audit timestamps should be unambiguous UTC ISO 8601 values.");
        Assert(Convert.ToInt64(firstAudit["sequence"]) == 1 && Convert.ToInt64(secondAudit["sequence"]) == 2, "Audit entries should use a continuous sequence.");
        Assert(Convert.ToString(secondAudit["previousHash"]) == Convert.ToString(firstAudit["entryHash"]), "Each audit entry should reference the previous entry hash.");
        string auditVerification = storage.VerifyAuditLogs("mapping-key");
        Assert(auditVerification.Contains("\"healthy\":true") && auditVerification.Contains("\"entries\":" + auditLines.Length.ToString(CultureInfo.InvariantCulture)) && auditVerification.Contains("\"anchorAlgorithm\":\"RSA-SHA256\""), "The intact batched audit hash chain and cryptographic audit head should verify.");
        string auditAnchorPath = Path.Combine(auditDirectory, "head-anchors.jsonl");Assert(File.Exists(auditAnchorPath) && File.ReadAllText(auditAnchorPath, Encoding.UTF8).Contains("\"publicKeyId\"") && File.ReadAllText(auditAnchorPath, Encoding.UTF8).Contains("\"signature\""), "Every committed audit head should have a shared RSA-SHA256 signature anchor.");byte[] intactAuditAnchors = File.ReadAllBytes(auditAnchorPath);string tamperedAnchorText = Encoding.UTF8.GetString(intactAuditAnchors).Replace("\"actor\":\"DOMAIN\\\\operator\"", "\"actor\":\"DOMAIN\\\\tampered\"");File.WriteAllText(auditAnchorPath, tamperedAnchorText, new UTF8Encoding(false));bool rejectedTamperedAnchor = false;try { storage.VerifyAuditLogs("mapping-key"); } catch (InvalidDataException) { rejectedTamperedAnchor = true; }Assert(rejectedTamperedAnchor, "Changing a signed audit-head anchor must fail verification.");File.WriteAllBytes(auditAnchorPath, intactAuditAnchors);Assert(storage.VerifyAuditLogs("mapping-key").Contains("\"healthy\":true"), "Restoring the intact signed audit-anchor chain should restore verification.");
        Assert(Directory.EnumerateFiles(performanceCacheRoot, "verified-audit-head.cache", SearchOption.AllDirectories).Any(), "A successful audit verification should save a Windows-user-protected incremental checkpoint outside the shared folder.");
        string auditView = storage.ReadAuditLogs("mapping-key");
        Assert(auditView.Contains("\"recent\"") && auditView.IndexOf("SECOND ACTION", StringComparison.Ordinal) < auditView.IndexOf("TEST ACTION", StringComparison.Ordinal), "The read-only audit view should return verified entries newest first.");
        string performanceReport = storage.ReadPerformanceDiagnostics("mapping-key");
        Assert(performanceReport.Contains("\"generatedAtUtc\"") && performanceReport.Contains("\"operations\"") && performanceReport.Contains("\"syncIndexShards\"") && performanceReport.Contains("\"databaseShards\":1") && performanceReport.Contains("\"manifestStorageFormat\":\"organization-sharded-v1\"") && performanceReport.Contains("\"localReadCacheAvailable\":true") && performanceReport.Contains("\"backupCompression\":\"GZip\"") && performanceReport.Contains("\"auditCheckpointAvailable\":true"), "The operator performance report should summarize bounded local timing diagnostics and optimization health without scanning evidence content.");

        Assert(storage.AcquireLease("mapping-key", "session-1"), "The first lease should be acquired.");
        Assert(!TrackerContext.StorageActionRequiresSerialization("lease-acquire") && !TrackerContext.StorageActionRequiresSerialization("lease-renew") && TrackerContext.StorageActionRequiresSerialization("lease-release") && !TrackerContext.StorageActionRequiresSerialization("workspace-status") && !TrackerContext.StorageActionRequiresSerialization("operation-status") && !TrackerContext.StorageActionRequiresSerialization("outlook-draft") && !TrackerContext.StorageActionRequiresSerialization("performance") && !TrackerContext.StorageActionRequiresSerialization("diagnostics") && TrackerContext.StorageActionRequiresSerialization("scan"), "Lease acquisition, renewal, operation reconciliation, constant-time local commit status, Outlook-draft, local performance-report, and sanitized diagnostic operations must remain available while a long storage operation is running, while lease release must wait behind that operation.");
        string receiptId = "22222222-2222-4222-8222-222222222222";storage.SaveOperationReceipt("mapping-key", receiptId, "state-commit", "{\"saved\":true}");string operationReceipt = storage.ReadOperationReceipt("mapping-key", receiptId);Assert(operationReceipt.Contains("\"completed\":true") && operationReceipt.Contains("\\\"saved\\\":true"), "A completed mutation must leave a protected local receipt so a dropped browser response can be reconciled without repeating the write.");
        Assert(storage.ReadOperationReceipt("mapping-key", "33333333-3333-4333-8333-333333333333").Contains("\"completed\":false"), "An unknown operation identity must report that no completion receipt exists.");
        string outlookHtml = TrackerContext.OutlookHtmlBody("Sir/Ma'am,\nhttps://www.cyber.mil/cyber-awareness-challenge\nhttps://www.cdse.edu/Training/eLearning/DS-IA112/\n\nIMPORTANT — REQUIRED FILE NAME\n\nFormat: Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf\nExample: Brown_Jacob_(LM)_User_Agreement_26AUG2026.pdf\n\nFiles that do not follow this naming standard may be returned for correction.\n\nIf you have already submitted this document, please let us know. <Review>");
        Assert(outlookHtml.Contains("background-color:#fff200") && outlookHtml.Contains("Last_First_(ORG)_User_Agreement_DDMMMYYYY.pdf") && outlookHtml.Contains("href=\"https://www.cyber.mil/cyber-awareness-challenge\"") && outlookHtml.Contains("href=\"https://www.cdse.edu/Training/eLearning/DS-IA112/\"") && outlookHtml.Contains("</span><br><br>If you have already submitted this document") && outlookHtml.Contains("&lt;Review&gt;") && !outlookHtml.Contains("<Review>"), "Outlook drafts should safely render clickable allowlisted training links, highlight only the filename instructions, and HTML-escape the remaining message.");
        string signedOutlookHtml = TrackerContext.OutlookHtmlWithSignature(outlookHtml, "<html><body><p>Configured Operator Signature</p></body></html>");
        Assert(signedOutlookHtml.Contains("Configured Operator Signature") && signedOutlookHtml.IndexOf("Configured Operator Signature", StringComparison.Ordinal) < signedOutlookHtml.IndexOf("</body>", StringComparison.OrdinalIgnoreCase), "Outlook drafts should retain the operator's configured signature inside the message body.");
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

        MethodInfo mergeWorkspace = typeof(PortableStorage).GetMethod("MergeLocalWorkspaceDatabase", BindingFlags.Instance | BindingFlags.NonPublic);
        Dictionary<string, object> mergeBase = (Dictionary<string, object>)Json.DeserializeObject(Database("base@example.mil")), mergeLocal = (Dictionary<string, object>)Json.DeserializeObject(Database("local@example.mil")), mergeShared = (Dictionary<string, object>)Json.DeserializeObject(Database("base@example.mil"));
        ((Dictionary<string, object>)((object[])mergeShared["systems"])[0])["name"] = "Shared System Name";
        Dictionary<string, object> mergedWorkspace = (Dictionary<string, object>)mergeWorkspace.Invoke(storage, new object[] { mergeBase, mergeLocal, mergeShared }), mergedSystem = (Dictionary<string, object>)((object[])mergedWorkspace["systems"])[0], mergedUser = (Dictionary<string, object>)((object[])mergedWorkspace["users"])[0];
        Assert(Convert.ToString(mergedSystem["name"]) == "Shared System Name" && Convert.ToString(mergedUser["email"]) == "local@example.mil", "Sequential Full Access editors must preserve non-conflicting local and shared record changes when rebasing onto the latest master.");
        Dictionary<string, object> conflictBase = (Dictionary<string, object>)Json.DeserializeObject(Database("base@example.mil")), conflictLocal = (Dictionary<string, object>)Json.DeserializeObject(Database("local@example.mil")), conflictShared = (Dictionary<string, object>)Json.DeserializeObject(Database("shared@example.mil"));bool mergeConflictRejected = false;
        try { mergeWorkspace.Invoke(storage, new object[] { conflictBase, conflictLocal, conflictShared }); } catch (TargetInvocationException error) { mergeConflictRejected = error.InnerException is InvalidDataException; }
        Assert(mergeConflictRejected, "Two editors changing the same record differently must fail closed for operator reconciliation instead of silently overwriting either record.");

        File.Delete(manifestChecksumPath);
        string verification = storage.VerifyLatest("mapping-key", "system-1");
        Assert(verification.Contains("\"healthy\":true") && verification.Contains("\"checksumInitialized\":true") && verification.Contains("\"manifest\":") && File.Exists(manifestChecksumPath), "Startup verification should establish a legacy live-database checksum only when the verified backup matches and return the already verified logical database without a second shared read.");
        string backupDirectoryForRecovery = Path.Combine(root, "System", "backup"), validBackupForRecovery = Directory.EnumerateFiles(backupDirectoryForRecovery, "user-tracker-*.json.gz").OrderByDescending(path => Path.GetFileName(path), StringComparer.Ordinal).First(), interruptedBackup = Path.Combine(backupDirectoryForRecovery, "user-tracker-9999-12-31T23-59-59-9999999Z.json.gz");File.Copy(validBackupForRecovery, interruptedBackup, true);
        string recoveredVerification = storage.VerifyLatest("mapping-key", "system-1");
        Assert(recoveredVerification.Contains("\"healthy\":true") && recoveredVerification.Contains("\"skippedBackupCount\":1") && recoveredVerification.Contains("newest valid verified backup"), "An interrupted newest backup without a SHA-256 sidecar must be skipped in favor of the newest valid verified backup instead of locking the operator out.");File.Delete(interruptedBackup);
        byte[] verifiedManifestBytes = File.ReadAllBytes(manifestPathForLockTest), verifiedChecksumBytes = File.ReadAllBytes(manifestChecksumPath);File.AppendAllText(manifestPathForLockTest, "tampered");bool rejectedTamperedManifest = false;
        try { storage.ReadManifest("mapping-key"); } catch (InvalidDataException) { rejectedTamperedManifest = true; }
        Assert(rejectedTamperedManifest, "A live database changed without a matching checksum must be rejected before it is read.");File.WriteAllBytes(manifestPathForLockTest, verifiedManifestBytes);File.WriteAllBytes(manifestChecksumPath, verifiedChecksumBytes);
        Dictionary<string, object> currentCatalog = (Dictionary<string, object>)Json.DeserializeObject(File.ReadAllText(manifestPathForLockTest, Encoding.UTF8));Dictionary<string, object> currentShardReference = (Dictionary<string, object>)((object[])currentCatalog["userShards"])[0];string currentShardPath = Path.Combine(root, "System", Convert.ToString(currentShardReference["file"], CultureInfo.InvariantCulture).Replace('/', Path.DirectorySeparatorChar));byte[] currentShardBytes = File.ReadAllBytes(currentShardPath);File.AppendAllText(currentShardPath, "tampered");bool rejectedTamperedShard = false;
        try { storage.VerifyLatest("mapping-key", "system-1"); } catch (InvalidDataException) { rejectedTamperedShard = true; }
        Assert(rejectedTamperedShard, "A modified organization shard must fail full storage verification even when the protected local read cache is fresh.");File.WriteAllBytes(currentShardPath, currentShardBytes);
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
        RunLauncherE2E(Path.GetDirectoryName(root));

        Console.WriteLine("Portable storage integration tests passed.");
        return 0;
    }
}
