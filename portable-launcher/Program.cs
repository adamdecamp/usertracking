using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed class TrackerContext : ApplicationContext
{
    private const int Port = 38473;
    private sealed class WebAsset { public byte[] Bytes; public string ContentType; }
    private readonly string user;
    private readonly byte[] indexHtml;
    private readonly Dictionary<string, WebAsset> assets;
    private readonly TcpListener listener;
    private readonly CancellationTokenSource stop = new CancellationTokenSource();
    private readonly SemaphoreSlim connections = new SemaphoreSlim(16, 16);
    private readonly NotifyIcon tray;
    private readonly Control dispatcher;
    private readonly PortableStorage storage;
    private readonly System.Windows.Forms.Timer lifecycleTimer;
    private readonly object lifecycleGate = new object();
    private DateTime lastActivityUtc = DateTime.UtcNow;
    private DateTime lastPresenceUtc = DateTime.UtcNow;
    private DateTime? shutdownRequestedUtc;
    private string shutdownReason;
    private bool backupClean = true;
    private bool shutdownReady;

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr windowHandle);

    public TrackerContext()
    {
        indexHtml = LoadResource("Tracker.Index");
        assets = LoadAssets();
        user = WindowsIdentity.GetCurrent().Name;
        storage = new PortableStorage(user);
        dispatcher = new Control();
        IntPtr dispatcherHandle = dispatcher.Handle;
        listener = new TcpListener(IPAddress.Loopback, Port);
        listener.Start();
        tray = new NotifyIcon { Icon = SystemIcons.Shield, Text = "Information System User Tracker", Visible = true };
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Tracker", null, delegate { OpenTracker(); });
        menu.Items.Add("Exit", null, delegate { RequestShutdown("operator-exit"); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { OpenTracker(); };
        lifecycleTimer = new System.Windows.Forms.Timer { Interval = 2000 };
        lifecycleTimer.Tick += delegate { EvaluateLifecycle(); };
        lifecycleTimer.Start();
        Task.Run((Func<Task>)ListenLoop);
        OpenTracker();
    }

    private void OpenTracker()
    {
        Process.Start(new ProcessStartInfo("http://localhost:" + Port + "/") { UseShellExecute = true });
    }

    private async Task ListenLoop()
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                var client = await listener.AcceptTcpClientAsync();
                await connections.WaitAsync();
                Task ignored = Task.Run(async delegate
                {
                    try { await Handle(client); }
                    finally { connections.Release(); }
                });
            }
            catch (ObjectDisposedException) { break; }
            catch (SocketException) { if (stop.IsCancellationRequested) break; }
        }
    }

    private async Task Handle(TcpClient client)
    {
        using (client)
        using (var stream = client.GetStream())
        {
            client.ReceiveTimeout = 30000; client.SendTimeout = 30000;
            string headerBlock = await ReadHeaderBlock(stream);
            if (String.IsNullOrEmpty(headerBlock)) return;
            string[] lines = headerBlock.Split(new[] { "\r\n" }, StringSplitOptions.None), parts = lines[0].Split(' ');
            if (parts.Length < 2 || (parts[0] != "GET" && parts[0] != "HEAD" && parts[0] != "POST")) { await Respond(stream, 405, "text/plain", Encoding.UTF8.GetBytes("Method Not Allowed"), false, "no-store"); return; }
            string host = null, origin = null; long contentLength = 0;
            for (int i = 1; i < lines.Length; i++) { string line = lines[i]; if (line.StartsWith("Host:", StringComparison.OrdinalIgnoreCase)) host = line.Substring(5).Trim(); if (line.StartsWith("Origin:", StringComparison.OrdinalIgnoreCase)) origin = line.Substring(7).Trim(); if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) Int64.TryParse(line.Substring(15).Trim(), out contentLength); }
            if (!String.Equals(host, "localhost:" + Port, StringComparison.OrdinalIgnoreCase) && !String.Equals(host, "127.0.0.1:" + Port, StringComparison.OrdinalIgnoreCase)) { await Respond(stream, 403, "text/plain", Encoding.UTF8.GetBytes("Forbidden"), parts[0] == "HEAD", "no-store"); return; }
            if (parts[0] == "POST" && !String.Equals(origin, "http://localhost:" + Port, StringComparison.OrdinalIgnoreCase) && !String.Equals(origin, "http://127.0.0.1:" + Port, StringComparison.OrdinalIgnoreCase)) { await Respond(stream, 403, "text/plain", Encoding.UTF8.GetBytes("Forbidden"), false, "no-store"); return; }
            if (contentLength < 0 || contentLength > 110L * 1024 * 1024) { await Respond(stream, 413, "text/plain", Encoding.UTF8.GetBytes("Request body is too large."), false, "no-store"); return; }
            byte[] requestBody = contentLength > 0 ? await ReadBody(stream, contentLength) : new byte[0];
            string target = parts[1], path = null;
            try { path = Uri.UnescapeDataString(target.Split('?')[0]); }
            catch (UriFormatException) { }
            if (path == null) { await Respond(stream, 400, "text/plain", Encoding.UTF8.GetBytes("Bad Request"), parts[0] == "HEAD", "no-store"); return; }
            if (path == "/api/session-user") { string json = "{\"user\":\"" + Json(user) + "\"}"; await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json), parts[0] == "HEAD", "no-store"); return; }
            if (path == "/api/mappings" && (parts[0] == "GET" || parts[0] == "HEAD")) { await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(storage.CachedMappings()), parts[0] == "HEAD", "no-store"); return; }
            if (path == "/api/activity" && parts[0] == "POST") { RecordActivity(); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/presence" && parts[0] == "POST") { RecordPresence(); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/backup-dirty" && parts[0] == "POST") { SetBackupClean(false); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/backup-complete" && parts[0] == "POST") { SetBackupClean(true); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/backup-failed" && parts[0] == "POST") { SetBackupClean(false); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/browser-closing" && parts[0] == "POST") { RequestShutdown("browser-closed"); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/logoff" && parts[0] == "POST") { RequestShutdown("operator-logoff"); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/shutdown-ready" && parts[0] == "POST") { MarkShutdownReady(); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/control" && (parts[0] == "GET" || parts[0] == "HEAD")) { await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(ControlJson()), parts[0] == "HEAD", "no-store"); return; }
            if (path.StartsWith("/api/storage/", StringComparison.Ordinal))
            {
                RecordActivity();
                string storageAction = "storage request";
                try
                {
                    string tail = path.Substring("/api/storage/".Length); int separator = tail.IndexOf('/');
                    if (separator <= 0) throw new InvalidDataException("The storage request is invalid.");
                    string systemId = tail.Substring(0, separator), action = tail.Substring(separator + 1), response; storageAction = action;
                    if (action == "select" && parts[0] == "POST")
                    {
                        string selected = await ChooseFolder();
                        if (selected == null) { await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"cancelled\":true}"), false, "no-store"); return; }
                        storage.Map(systemId, selected); string manifest = storage.ReadManifest(systemId);
                        response = "{\"cancelled\":false,\"folderName\":\"" + Json(storage.FolderName(systemId)) + "\",\"manifest\":" + (manifest ?? "null") + "}";
                    }
                    else if (action == "manifest" && parts[0] == "GET") response = storage.ReadManifest(systemId) ?? "null";
                    else if (action == "manifest" && parts[0] == "POST") response = storage.SaveManifest(systemId, Encoding.UTF8.GetString(requestBody));
                    else if (action == "csv" && parts[0] == "POST") response = "{\"saved\":\"" + Json(storage.SaveCsv(systemId, requestBody)) + "\"}";
                    else if (action == "backups" && parts[0] == "GET") response = storage.ListBackups(systemId, QueryValue(target, "logical"));
                    else if (action == "restore" && parts[0] == "POST") response = storage.Restore(systemId, QueryValue(target, "logical"), QueryValue(target, "file"));
                    else if (action == "restore-drill" && parts[0] == "POST") response = storage.RestoreDrill(systemId, QueryValue(target, "logical"), QueryValue(target, "file"));
                    else if (action == "verify" && parts[0] == "GET") response = storage.VerifyLatest(systemId, QueryValue(target, "logical"));
                    else if (action == "scan" && parts[0] == "GET") response = storage.Scan(systemId, QueryValue(target, "rules"), String.Equals(QueryValue(target, "full"), "1", StringComparison.Ordinal));
                    else if (action == "renamer-queue" && parts[0] == "GET") response = storage.ReadRenamerQueue(systemId);
                    else if (action == "renamer-queue" && parts[0] == "POST") response = storage.SaveRenamerQueue(systemId, requestBody);
                    else if (action == "renamer-queue" && parts[0] == "DELETE") response = storage.ClearRenamerQueue(systemId);
                    else if (action == "retention-status" && parts[0] == "GET") response = storage.RetentionStatus(systemId);
                    else if (action == "file" && parts[0] == "GET") { byte[] fileBytes = storage.ReadRelativeFile(systemId, QueryValue(target, "path")); await Respond(stream, 200, "application/octet-stream", fileBytes, false, "no-store"); return; }
                    else if (action == "archive" && parts[0] == "POST") response = storage.ArchiveEvidence(systemId, QueryValue(target, "path"));
                    else if (action == "rework" && parts[0] == "POST") response = storage.MoveEvidenceToRework(systemId, QueryValue(target, "path"));
                    else if (action == "compress" && parts[0] == "POST") response = storage.CompressEvidence(systemId, QueryValue(target, "path"));
                    else if (action == "normalize-date" && parts[0] == "POST") response = storage.NormalizeEvidenceFilename(systemId, QueryValue(target, "path"), QueryValue(target, "filename"));
                    else if (action == "evidence" && parts[0] == "POST") response = "{\"filename\":\"" + Json(storage.StoreEvidence(systemId, QueryValue(target, "organization"), QueryValue(target, "last"), QueryValue(target, "first"), QueryValue(target, "filename"), requestBody)) + "\"}";
                    else if (action == "report" && parts[0] == "POST") response = storage.StoreReport(systemId, QueryValue(target, "filename"), requestBody);
                    else if (action == "audit" && parts[0] == "POST") { storage.AppendAudit(systemId, Encoding.UTF8.GetString(requestBody)); response = "{\"ok\":true}"; }
                    else if (action == "audit-batch" && parts[0] == "POST") { storage.AppendAuditBatchJson(systemId, Encoding.UTF8.GetString(requestBody)); response = "{\"ok\":true}"; }
                    else if (action == "audit-verify" && parts[0] == "GET") response = storage.VerifyAuditLogs(systemId);
                    else if (action == "audit-view" && parts[0] == "GET") response = storage.ReadAuditLogs(systemId);
                    else if (action == "lease-acquire" && parts[0] == "POST") response = "{\"acquired\":" + (storage.AcquireLease(systemId, QueryValue(target, "session")) ? "true" : "false") + "}";
                    else if (action == "lease-renew" && parts[0] == "POST") response = "{\"renewed\":" + (storage.RenewLease(systemId, QueryValue(target, "session")) ? "true" : "false") + "}";
                    else if (action == "lease-release" && parts[0] == "POST") { storage.ReleaseLease(systemId, QueryValue(target, "session")); response = "{\"released\":true}"; }
                    else { await Respond(stream, 404, "text/plain", Encoding.UTF8.GetBytes("Not Found"), false, "no-store"); return; }
                    await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(response), false, "no-store"); return;
                }
                catch (Exception ex)
                {
                    string message = StorageError(ex, storageAction);
                    Respond(stream, 400, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(CleanError(message)), false, "no-store").GetAwaiter().GetResult(); return;
                }
            }
            WebAsset asset;
            if (assets.TryGetValue(path, out asset)) { await Respond(stream, 200, asset.ContentType, asset.Bytes, parts[0] == "HEAD", "public, max-age=31536000, immutable", "gzip"); return; }
            if (path == "/" || path == "/index.html" || !Path.HasExtension(path)) { await Respond(stream, 200, "text/html; charset=utf-8", indexHtml, parts[0] == "HEAD", "no-cache"); return; }
            await Respond(stream, 404, "text/plain", Encoding.UTF8.GetBytes("Not Found"), parts[0] == "HEAD", "no-store");
        }
    }

    private Task<string> ChooseFolder()
    {
        var result = new TaskCompletionSource<string>();
        dispatcher.BeginInvoke(new Action(delegate
        {
            try
            {
                using (var owner = new Form
                {
                    FormBorderStyle = FormBorderStyle.None,
                    Location = new Point(-32000, -32000),
                    Opacity = 0,
                    ShowInTaskbar = false,
                    Size = new Size(1, 1),
                    StartPosition = FormStartPosition.Manual,
                    TopMost = true
                })
                using (var dialog = new FolderBrowserDialog { Description = "Select the Shared Folder for This Information System", ShowNewFolderButton = true })
                {
                    owner.Show();
                    owner.Activate();
                    owner.BringToFront();
                    SetForegroundWindow(owner.Handle);
                    DialogResult selected = dialog.ShowDialog(owner);
                    result.SetResult(selected == DialogResult.OK ? dialog.SelectedPath : null);
                }
            }
            catch (Exception ex) { result.SetException(ex); }
        }));
        return result.Task;
    }

    private static async Task<string> ReadHeaderBlock(NetworkStream stream)
    {
        var bytes = new List<byte>(); int matched = 0;
        while (bytes.Count < 65536)
        {
            byte[] one = new byte[1]; int read = await stream.ReadAsync(one, 0, 1); if (read == 0) break;
            bytes.Add(one[0]);
            matched = (matched == 0 && one[0] == 13) || (matched == 2 && one[0] == 13) ? matched + 1 : (matched == 1 || matched == 3) && one[0] == 10 ? matched + 1 : one[0] == 13 ? 1 : 0;
            if (matched == 4) return Encoding.ASCII.GetString(bytes.ToArray(), 0, bytes.Count - 4);
        }
        throw new InvalidDataException("The HTTP request headers are invalid or too large.");
    }

    private static async Task<byte[]> ReadBody(NetworkStream stream, long length)
    {
        byte[] body = new byte[(int)length]; int offset = 0;
        while (offset < body.Length) { int read = await stream.ReadAsync(body, offset, body.Length - offset); if (read == 0) throw new EndOfStreamException("The request body ended unexpectedly."); offset += read; }
        return body;
    }

    private static string QueryValue(string target, string name)
    {
        int question = target.IndexOf('?'); if (question < 0) throw new InvalidDataException("A required request value is missing.");
        foreach (string pair in target.Substring(question + 1).Split('&')) { int equals = pair.IndexOf('='); if (equals >= 0 && Uri.UnescapeDataString(pair.Substring(0, equals)) == name) return Uri.UnescapeDataString(pair.Substring(equals + 1)); }
        throw new InvalidDataException("A required request value is missing.");
    }

    private static string CleanError(string value) { if (String.IsNullOrWhiteSpace(value)) return "The storage request failed."; string clean = value.Replace("\r", " ").Replace("\n", " ").Replace("\0", " ").Trim(); return clean.Length > 1200 ? clean.Substring(0, 1200) : clean; }
    private static string StorageError(Exception ex, string operation)
    {
        string stage = String.IsNullOrWhiteSpace(operation) ? "storage request" : operation.Replace('-', ' ');
        if (ex is PathTooLongException) return "Storage operation " + stage + " failed. PathTooLongException: The mapped folder path plus the evidence filename exceeds the Windows path limit. This build uses long-path support and short temporary names; if the error continues, map the share to a drive letter or shorten the folders above the evidence file.";
        string detail = "Storage operation " + stage + " failed. " + ex.GetType().Name + ": " + CleanError(ex.Message);
        if (ex is UnauthorizedAccessException) return detail + " Confirm that your Windows account has read, create, modify, delete, and rename permissions on the network share.";
        if (ex is DirectoryNotFoundException || ex is DriveNotFoundException) return detail + " The mapped network location is unavailable. Reconnect the drive or UNC share, then map the system folder again.";
        if (ex is IOException && ((ex.HResult & 0xffff) == 87 || ex.InnerException is IOException && (ex.InnerException.HResult & 0xffff) == 87)) return detail + " The selected filesystem rejected this operation even though the launcher used compatible buffered I/O. The operation name above identifies the failing stage.";
        if (ex is IOException) return detail + " The network share may be offline, reconnecting, or holding a file lock. Confirm connectivity and permissions, then retry; the app preserves the previous verified file when replacement cannot be completed.";
        return detail;
    }

    private void RecordActivity()
    {
        lock (lifecycleGate)
        {
            lastActivityUtc = DateTime.UtcNow;
            lastPresenceUtc = DateTime.UtcNow;
            // A new page load cancels a close signal caused by reload or in-app navigation.
            // Once the 60-minute idle shutdown starts, it is allowed to finish cleanly.
            if (shutdownReason == "browser-closed")
            {
                shutdownRequestedUtc = null;
                shutdownReason = null;
                shutdownReady = false;
            }
        }
    }

    private void RecordPresence() { lock (lifecycleGate) { lastPresenceUtc = DateTime.UtcNow; } }

    private void SetBackupClean(bool clean) { lock (lifecycleGate) { backupClean = clean; } }

    private void RequestShutdown(string reason)
    {
        bool finalizeNow;
        lock (lifecycleGate)
        {
            if (!shutdownRequestedUtc.HasValue) shutdownRequestedUtc = DateTime.UtcNow;
            shutdownReason = reason;
            shutdownReady = false;
            finalizeNow = backupClean;
        }
        if (finalizeNow) TryFinalizeBackups();
    }

    private void TryFinalizeBackups()
    {
        try { storage.FinalizeMappedBackups(); lock (lifecycleGate) backupClean = true; }
        catch { lock (lifecycleGate) backupClean = false; }
    }

    private void MarkShutdownReady()
    {
        lock (lifecycleGate)
        {
            shutdownReady = true;
        }
    }

    private string ControlJson()
    {
        lock (lifecycleGate)
        {
            return "{\"shutdownRequested\":" + (shutdownRequestedUtc.HasValue ? "true" : "false") + ",\"reason\":\"" + Json(shutdownReason ?? "") + "\",\"backupClean\":" + (backupClean ? "true" : "false") + "}";
        }
    }

    private void EvaluateLifecycle()
    {
        storage.ExpireLeases(TimeSpan.FromMinutes(3));
        bool shouldExit = false, finalize = false;
        lock (lifecycleGate)
        {
            DateTime now = DateTime.UtcNow;
            if (!shutdownRequestedUtc.HasValue && now - lastPresenceUtc >= TimeSpan.FromSeconds(90))
            {
                shutdownRequestedUtc = now;
                shutdownReason = "browser-closed";
                shutdownReady = false;
                finalize = true;
            }
            else if (!shutdownRequestedUtc.HasValue && now - lastActivityUtc >= TimeSpan.FromMinutes(60))
            {
                shutdownRequestedUtc = now;
                shutdownReason = "idle";
                shutdownReady = false;
                finalize = true;
            }
            if (shutdownRequestedUtc.HasValue)
            {
                TimeSpan waiting = now - shutdownRequestedUtc.Value;
                if (!backupClean && waiting >= TimeSpan.FromSeconds(8)) finalize = true;
                shouldExit = backupClean && (shutdownReady || ((shutdownReason == "browser-closed" || shutdownReason == "operator-exit" || shutdownReason == "operator-logoff") && waiting >= TimeSpan.FromSeconds(12)) || (shutdownReason == "idle" && waiting >= TimeSpan.FromSeconds(30)));
            }
        }
        if (finalize) TryFinalizeBackups();
        if (shouldExit) ExitThread();
    }

    private static async Task Respond(NetworkStream stream, int status, string type, byte[] body, bool head, string cache, string contentEncoding = null)
    {
        string reason = status == 200 ? "OK" : status == 400 ? "Bad Request" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : status == 413 ? "Payload Too Large" : "Method Not Allowed";
        string encodingHeader = String.IsNullOrEmpty(contentEncoding) ? "" : "Content-Encoding: " + contentEncoding + "\r\n";
        string headers = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length + "\r\n" + encodingHeader + "Cache-Control: " + cache + "\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nX-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Resource-Policy: same-origin\r\nPermissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'\r\nConnection: close\r\n\r\n";
        byte[] headerBytes = Encoding.ASCII.GetBytes(headers); await stream.WriteAsync(headerBytes, 0, headerBytes.Length); if (!head) await stream.WriteAsync(body, 0, body.Length);
    }

    private static string Json(string value) { return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", ""); }
    private static byte[] LoadResource(string name) { using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) { if (stream == null) throw new InvalidDataException("Embedded application resource is missing: " + name); using (var memory = new MemoryStream()) { stream.CopyTo(memory); return memory.ToArray(); } } }
    private static Dictionary<string, WebAsset> LoadAssets()
    {
        var result = new Dictionary<string, WebAsset>(StringComparer.Ordinal);
        string manifest = Encoding.UTF8.GetString(LoadResource("Tracker.AssetManifest"));
        foreach (string line in manifest.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            string[] fields = line.Split('\t');
            if (fields.Length != 3 || !fields[0].StartsWith("/assets/", StringComparison.Ordinal) || !fields[1].StartsWith("Tracker.Asset", StringComparison.Ordinal) || (fields[2] != "text/javascript; charset=utf-8" && fields[2] != "text/css; charset=utf-8")) throw new InvalidDataException("The embedded asset manifest is invalid.");
            result.Add(fields[0], new WebAsset { Bytes = LoadResource(fields[1]), ContentType = fields[2] });
        }
        if (result.Count == 0) throw new InvalidDataException("The embedded asset manifest contains no browser assets.");
        return result;
    }
    protected override void ExitThreadCore() { lifecycleTimer.Stop(); lifecycleTimer.Dispose(); TryFinalizeBackups(); storage.Dispose(); stop.Cancel(); listener.Stop(); tray.Visible = false; tray.Dispose(); dispatcher.Dispose(); base.ExitThreadCore(); }
}

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        try { Application.Run(new TrackerContext()); }
        catch (SocketException) { MessageBox.Show("The tracker is already running.", "Information System User Tracker", MessageBoxButtons.OK, MessageBoxIcon.Information); }
        catch (Exception ex) { MessageBox.Show(ex.Message, "Unable to Start Tracker", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
}
