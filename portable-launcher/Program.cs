using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
internal sealed class TrackerContext : ApplicationContext
{
    private const int DefaultPort = 38473;
    private const long KiB = 1024L;
    private const long MiB = 1024L * 1024L;
    private sealed class WebAsset { public byte[] Bytes; public string ContentType; }
    private readonly string user;
    private readonly string sessionToken;
    private readonly object sessionGate = new object();
    private string sessionAccessMode = "unselected";
    private readonly byte[] indexHtml;
    private readonly Dictionary<string, WebAsset> assets;
    private readonly TcpListener listener;
    private readonly CancellationTokenSource stop = new CancellationTokenSource();
    private readonly SemaphoreSlim connections = new SemaphoreSlim(16, 16);
    private readonly Dictionary<string, SemaphoreSlim> storageOperations = new Dictionary<string, SemaphoreSlim>(StringComparer.Ordinal);
    private readonly Dictionary<string, string> activeStorageOperationNames = new Dictionary<string, string>(StringComparer.Ordinal);
    private readonly object storageOperationsGate = new object();
    private readonly NotifyIcon tray;
    private readonly Control dispatcher;
    private readonly PortableStorage storage;
    private readonly int port;
    private readonly System.Windows.Forms.Timer lifecycleTimer;
    private readonly object lifecycleGate = new object();
    private DateTime lastActivityUtc = DateTime.UtcNow;
    private DateTime lastPresenceUtc = DateTime.UtcNow;
    private DateTime? shutdownRequestedUtc;
    private string shutdownReason;
    private bool backupClean = true;
    private bool shutdownReady;
    private bool shutdownFinalizationActive;
    private bool shutdownFinalizationComplete;
    private int shutdownFinalizationAttempts;
    private int exitStarted;
    private int activeStorageRequests;
    private bool longOperationActive;
    private DateTime lastLongOperationHeartbeatUtc = DateTime.MinValue;
    private int outlookDraftActive;
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr windowHandle);
    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint count, IntPtr filters);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
        void AddPlace(IShellItem item, int alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }
    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr bindContext, ref Guid handler, ref Guid interfaceId, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint displayNameType, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem item, uint hint, out int order);
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr bindContext, ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out IShellItem item);
    public TrackerContext()
    {
        indexHtml = LoadResource("Tracker.Index");
        assets = LoadAssets();
        user = WindowsIdentity.GetCurrent().Name;
        sessionToken = CreateSessionToken();
        storage = new PortableStorage(user);
        dispatcher = new Control();
        IntPtr dispatcherHandle = dispatcher.Handle;
        listener = new TcpListener(IPAddress.Loopback, DefaultPort);
        listener.Start();
        port = ((IPEndPoint)listener.LocalEndpoint).Port;
        Icon appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Shield;
        tray = new NotifyIcon { Icon = appIcon, Text = "R.A.P.T.O.R.", Visible = true };
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open R.A.P.T.O.R.", null, delegate { OpenTracker(); });
        menu.Items.Add("Exit", null, delegate { RequestShutdown("operator-exit"); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { OpenTracker(); };
        lifecycleTimer = new System.Windows.Forms.Timer { Interval = 2000 };
        lifecycleTimer.Tick += delegate { EvaluateLifecycle(); };
        lifecycleTimer.Start();
        Task.Run((Func<Task>)ListenLoop);
        OpenTracker();
    }
    // The build gate uses the real loopback listener and storage router without
    // opening a browser or installing a tray icon. This keeps the HTTP boundary,
    // origin/session enforcement, and failure recovery in the executable test path.
    internal TrackerContext(string e2eRoot)
    {
        indexHtml = Encoding.UTF8.GetBytes("<!doctype html><title>R.A.P.T.O.R. E2E</title>");
        assets = new Dictionary<string, WebAsset>(StringComparer.Ordinal);
        user = "RAPTOR\\E2E";
        sessionToken = CreateSessionToken();
        storage = new PortableStorage(user, Path.Combine(e2eRoot, "e2e-mappings.json"));
        dispatcher = null;
        listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        port = ((IPEndPoint)listener.LocalEndpoint).Port;
        tray = null;
        lifecycleTimer = null;
        OpenSession("full");
        string mapped = Path.Combine(e2eRoot, "mapped");Directory.CreateDirectory(mapped);
        if (!storage.MapForFullSession("e2e-system", mapped, "e2e-session")) throw new IOException("The E2E launcher could not acquire its test lease.");
        Task.Run((Func<Task>)ListenLoop);
    }
    internal int E2EPort { get { return port; } }
    internal string E2ESessionToken { get { return sessionToken; } }
    internal void StopE2E()
    {
        try { storage.ReleaseAllLeases();storage.Dispose(); } catch { }
        try { stop.Cancel();listener.Stop(); } catch { }
    }

    private void OpenTracker()
    {
        Process.Start(new ProcessStartInfo("http://localhost:" + port + "/#session=" + Uri.EscapeDataString(sessionToken)) { UseShellExecute = true });
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
                    catch (Exception error) { Program.WriteLocalError("Windows launcher request failure", error); }
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
            client.ReceiveTimeout = 120000; client.SendTimeout = 120000;
            string headerBlock = await ReadHeaderBlock(stream);
            if (String.IsNullOrEmpty(headerBlock)) return;
            string[] lines = headerBlock.Split(new[] { "\r\n" }, StringSplitOptions.None), parts = lines[0].Split(' ');
            if (parts.Length < 2 || (parts[0] != "GET" && parts[0] != "HEAD" && parts[0] != "POST" && parts[0] != "DELETE")) { await Respond(stream, 405, "text/plain", Encoding.UTF8.GetBytes("Method Not Allowed"), false, "no-store"); return; }
            string host = null, origin = null, operationId = null, presentedToken = null, leaseSession = null, transferEncoding = null; long contentLength = 0;bool contentLengthSeen = false, invalidContentLength = false;
            for (int i = 1; i < lines.Length; i++)
            {
                string line = lines[i];
                if (line.StartsWith("Host:", StringComparison.OrdinalIgnoreCase)) host = line.Substring(5).Trim();
                if (line.StartsWith("Origin:", StringComparison.OrdinalIgnoreCase)) origin = line.Substring(7).Trim();
                if (line.StartsWith("Transfer-Encoding:", StringComparison.OrdinalIgnoreCase)) transferEncoding = line.Substring(18).Trim();
                if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                {
                    long parsedLength;bool parsed = Int64.TryParse(line.Substring(15).Trim(), out parsedLength) && parsedLength >= 0;
                    if (!parsed || contentLengthSeen && contentLength != parsedLength) invalidContentLength = true;
                    else { contentLength = parsedLength;contentLengthSeen = true; }
                }
                if (line.StartsWith("X-Tracker-Operation-Id:", StringComparison.OrdinalIgnoreCase)) operationId = line.Substring(23).Trim();
                if (line.StartsWith("X-RAPTOR-Session-Token:", StringComparison.OrdinalIgnoreCase)) presentedToken = line.Substring(23).Trim();
                if (line.StartsWith("X-RAPTOR-Lease-Session:", StringComparison.OrdinalIgnoreCase)) leaseSession = line.Substring(23).Trim();
            }
            if (!String.Equals(host, "localhost:" + port, StringComparison.OrdinalIgnoreCase) && !String.Equals(host, "127.0.0.1:" + port, StringComparison.OrdinalIgnoreCase)) { await Respond(stream, 403, "text/plain", Encoding.UTF8.GetBytes("Forbidden"), parts[0] == "HEAD", "no-store"); return; }
            if ((parts[0] == "POST" || parts[0] == "DELETE") && !String.Equals(origin, "http://localhost:" + port, StringComparison.OrdinalIgnoreCase) && !String.Equals(origin, "http://127.0.0.1:" + port, StringComparison.OrdinalIgnoreCase)) { await Respond(stream, 403, "text/plain", Encoding.UTF8.GetBytes("Forbidden"), false, "no-store"); return; }
            string target = parts[1], path = null;
            try { path = Uri.UnescapeDataString(target.Split('?')[0]); }
            catch (UriFormatException) { }
            if (path == null) { await Respond(stream, 400, "text/plain", Encoding.UTF8.GetBytes("Bad Request"), parts[0] == "HEAD", "no-store"); return; }
            if (path.StartsWith("/api/", StringComparison.Ordinal) && !SessionTokenMatches(presentedToken)) { await Respond(stream, 401, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("The launcher session is missing or invalid. Reopen R.A.P.T.O.R. from its Windows launcher."), false, "no-store"); return; }
            if (invalidContentLength || !String.IsNullOrWhiteSpace(transferEncoding)) { await Respond(stream, 400, "text/plain", Encoding.UTF8.GetBytes("The request framing is invalid. Chunked transfer encoding is not accepted."), false, "no-store"); return; }
            long requestLimit = RequestBodyLimit(path, parts[0]);
            if (contentLength > requestLimit) { await Respond(stream, 413, "text/plain", Encoding.UTF8.GetBytes("Request body exceeds the limit for this endpoint."), false, "no-store"); return; }
            byte[] requestBody = contentLength > 0 ? await ReadBody(stream, contentLength, requestLimit) : new byte[0];
            if (path == "/api/session-user") { string json = "{\"user\":\"" + Json(user) + "\"}"; await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json), parts[0] == "HEAD", "no-store"); return; }
            if (path == "/api/session-open" && parts[0] == "POST") { string mode = QueryValue(target, "mode");if (!OpenSession(mode)) { await Respond(stream, 409, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("This launcher session already has a different access mode. Restart R.A.P.T.O.R. to choose another mode."), false, "no-store");return; }await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"mode\":\"" + Json(SessionAccessMode()) + "\"}"), false, "no-store");return; }
            if (path == "/api/session-downgrade" && parts[0] == "POST")
            {
                if (!await DowngradeSessionAndReleaseLeases()) { await Respond(stream, 503, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("The launcher entered Read-Only Access, but an active verified storage operation is still finishing. Its exclusive lease was retained and will be released safely after the operation completes or expires."), false, "no-store");return; }
                await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"mode\":\"read-only\"}"), false, "no-store");return;
            }
            if (path == "/api/session-upgrade" && parts[0] == "POST") { bool upgraded;lock (sessionGate) { upgraded = !String.Equals(sessionAccessMode, "unselected", StringComparison.Ordinal);if (upgraded) sessionAccessMode = "full"; }if (!upgraded) { await Respond(stream, 409, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Choose an access mode before requesting Full Access."), false, "no-store");return; }await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"mode\":\"full\"}"), false, "no-store");return; }
            if (path == "/api/mappings" && (parts[0] == "GET" || parts[0] == "HEAD")) { bool readOnlyMappings = String.Equals(SessionAccessMode(), "read-only", StringComparison.Ordinal), localOnlyMappings = String.Equals(OptionalQueryValue(target, "local"), "1", StringComparison.Ordinal); if (!readOnlyMappings && !String.Equals(SessionAccessMode(), "full", StringComparison.Ordinal)) { await Respond(stream, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Choose an access mode before opening saved mappings."), false, "no-store");return; }await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(storage.CachedMappings(!readOnlyMappings && !localOnlyMappings, localOnlyMappings)), parts[0] == "HEAD", "no-store"); return; }
            if (path == "/api/activity" && parts[0] == "POST") { RecordActivity(); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/presence" && parts[0] == "POST") { RecordPresence(); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/operation-active" && parts[0] == "POST") { SetLongOperation(true); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/operation-idle" && parts[0] == "POST") { SetLongOperation(false); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/backup-dirty" && parts[0] == "POST") { SetBackupClean(false); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/backup-complete" && parts[0] == "POST") { SetBackupClean(true); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/backup-failed" && parts[0] == "POST") { SetBackupClean(false); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/browser-closing" && parts[0] == "POST") { RequestShutdown("browser-closed"); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/logoff" && parts[0] == "POST") { RequestShutdown("operator-logoff"); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/shutdown-ready" && parts[0] == "POST") { MarkShutdownReady(); await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false, "no-store"); return; }
            if (path == "/api/control" && (parts[0] == "GET" || parts[0] == "HEAD")) { await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(ControlJson()), parts[0] == "HEAD", "no-store"); return; }
            if (path.StartsWith("/api/storage/", StringComparison.Ordinal))
            {
                string tail = path.Substring("/api/storage/".Length); int separator = tail.IndexOf('/');
                if (separator <= 0) { await Respond(stream, 400, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("The storage request is invalid."), false, "no-store"); return; }
                string systemId = tail.Substring(0, separator), action = tail.Substring(separator + 1);
                string accessMode = SessionAccessMode();
                if (String.Equals(accessMode, "unselected", StringComparison.Ordinal)) { await Respond(stream, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Choose an access mode before using mapped storage."), false, "no-store"); return; }
                if (String.Equals(accessMode, "read-only", StringComparison.Ordinal) && !ReadOnlyStorageActionAllowed(action, parts[0])) { await Respond(stream, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Read-Only Access cannot modify the mapped information system."), false, "no-store"); return; }
                if (StorageActionRequiresLease(action, parts[0]) && (String.IsNullOrWhiteSpace(leaseSession) || !storage.OwnsLease(systemId, leaseSession))) { await Respond(stream, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("The exclusive Full Access lease is missing or is owned by another session."), false, "no-store"); return; }
                if (action.StartsWith("lease-", StringComparison.Ordinal) && !String.Equals(accessMode, "full", StringComparison.Ordinal)) { await Respond(stream, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Only Full Access can manage the exclusive editor lease."), false, "no-store"); return; }
                if (action.StartsWith("lease-", StringComparison.Ordinal)) { string requestedSession = QueryValue(target, "session");if (String.IsNullOrWhiteSpace(leaseSession) || !String.Equals(requestedSession, leaseSession, StringComparison.Ordinal)) { await Respond(stream, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("The lease session identity is invalid."), false, "no-store");return; } }
                bool serializedStorage = StorageActionRequiresSerialization(action);int queueWaitMilliseconds = StorageQueueWaitMilliseconds(action, parts[0]);SemaphoreSlim systemStorageOperations = serializedStorage ? StorageQueue(systemId) : null;
                if (serializedStorage && !await systemStorageOperations.WaitAsync(queueWaitMilliseconds)) { string activeOperation = ActiveStorageOperation(systemId);await Respond(stream, 503, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("This information system is busy completing " + (String.IsNullOrWhiteSpace(activeOperation) ? "another verified operation" : activeOperation) + " after waiting " + (queueWaitMilliseconds / 1000).ToString(System.Globalization.CultureInfo.InvariantCulture) + " seconds. Other mapped systems remain available. Safe reads retry automatically; file-changing actions remain uncommitted until their turn begins."), false, "no-store"); return; }
                if (serializedStorage) SetActiveStorageOperation(systemId, StorageActionDisplayName(action));
                BeginStorageRequest();
                string storageAction = action, requestSha256 = OperationRequestSha256(parts[0], target, requestBody), recoveryRunId = null;bool mutation = parts[0] == "POST" || parts[0] == "DELETE";
                try
                {
                    // Recheck authorization after queueing so a released lease cannot authorize work.
                    if (StorageActionRequiresLease(action, parts[0]) && !String.Equals(SessionAccessMode(), "full", StringComparison.Ordinal)) { await Respond(stream, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("The Full Access session ended while this operation was waiting to begin."), false, "no-store");return; }
                    if (StorageActionRequiresLease(action, parts[0]) && (String.IsNullOrWhiteSpace(leaseSession) || !storage.OwnsLease(systemId, leaseSession))) { await Respond(stream, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("The exclusive Full Access lease was released while this operation was waiting to begin."), false, "no-store");return; }
                    string response;
                    if (mutation && !String.IsNullOrWhiteSpace(operationId) && storage.TryReplayOperation(systemId, operationId, action, requestSha256, out response)) { await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(response), false, "no-store");return; }
                    if (mutation && serializedStorage && StorageActionRequiresLease(action, parts[0])) recoveryRunId = storage.BeginRecoveryOperation(systemId, operationId, action, requestSha256, OptionalQueryValue(target, "organization"));
                    if (action == "select" && parts[0] == "POST")
                    {
                        string selected = await ChooseFolder();
                        if (selected == null) { await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"cancelled\":true}"), false, "no-store"); return; }
                        if (!storage.MapForFullSession(systemId, selected, leaseSession)) { await Respond(stream, 409, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Another operator holds the exclusive mapped-folder lease."), false, "no-store");return; }string manifest = storage.ReadManifest(systemId);
                        response = "{\"cancelled\":false,\"folderName\":\"" + Json(storage.FolderName(systemId)) + "\",\"manifest\":" + (manifest ?? "null") + "}";
                    }
                    else if (action == "select-readonly" && parts[0] == "POST")
                    {
                        string selected = await ChooseFolder("Select an Existing R.A.P.T.O.R. Information System Folder", null, false);
                        if (selected == null) { await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"cancelled\":true}"), false, "no-store"); return; }
                        storage.MapReadOnly(systemId, selected); string manifest = storage.ReadManifest(systemId);
                        response = "{\"cancelled\":false,\"folderName\":\"" + Json(storage.FolderName(systemId)) + "\",\"manifest\":" + (manifest ?? "null") + "}";
                    }
                    else if (action == "forget" && parts[0] == "POST") { storage.ForgetMapping(systemId); response = "{\"removed\":true}"; }
                    else if (action == "unarchive-select-folder" && parts[0] == "POST")
                    {
                        string selected = await ChooseFolder("Select a Folder of ZIP Evidence to Unarchive", storage.FolderPath(systemId), false);
                        response = selected == null ? "{\"cancelled\":true,\"items\":[]}" : storage.ListUnarchiveCandidates(systemId, new[] { selected }, true);
                    }
                    else if (action == "unarchive-select-files" && parts[0] == "POST")
                    {
                        string[] selected = await ChooseZipFiles(storage.FolderPath(systemId));
                        response = selected == null || selected.Length == 0 ? "{\"cancelled\":true,\"items\":[]}" : storage.ListUnarchiveCandidates(systemId, selected, false);
                    }
                    else if (action == "unarchive" && parts[0] == "POST") response = storage.UnarchiveEvidence(systemId, QueryValue(target, "path"));
                    else if (action == "manifest" && parts[0] == "GET") response = storage.ReadManifest(systemId) ?? "null";
                    else if (action == "local-manifest" && parts[0] == "GET") response = storage.ReadWorkingManifest(systemId) ?? "null";
                    else if (action == "manifest" && parts[0] == "POST") response = storage.SaveManifest(systemId, Encoding.UTF8.GetString(requestBody));
                    else if (action == "csv" && parts[0] == "POST") response = "{\"saved\":\"" + Json(storage.SaveCsv(systemId, requestBody)) + "\"}";
                    else if (action == "state-commit" && parts[0] == "POST") response = storage.SaveSystemState(systemId, requestBody);
                    else if (action == "workspace" && parts[0] == "GET") response = storage.LocalWorkspaceInfo(systemId);
                    else if (action == "workspace-status" && parts[0] == "POST") response = storage.WorkspaceStatus(systemId, requestBody);
                    else if (action == "workspace-recovery" && parts[0] == "GET") response = storage.LegacyWorkspaceRecoveryStatus(systemId, QueryValue(target, "logical"));
                    else if (action == "workspace-recovery-export" && parts[0] == "POST") response = storage.ExportLegacyWorkspaceRecovery(systemId, requestBody);
                    else if (action == "workspace-recovery-reset" && parts[0] == "POST") response = storage.ResetLegacyWorkspaceRecovery(systemId, requestBody);
                    else if (action == "sync-job" && parts[0] == "GET") response = storage.ReadSyncJob(systemId);
                    else if (action == "sync-job" && parts[0] == "POST") response = storage.SaveSyncJob(systemId, requestBody);
                    else if (action == "sync-job" && parts[0] == "DELETE") response = storage.ClearSyncJob(systemId);
                    else if (action == "operation-status" && parts[0] == "GET") response = storage.ReadOperationReceipt(systemId, QueryValue(target, "operation"));
                    else if (action == "recovery" && parts[0] == "GET") response = storage.ReadRecoveryCenter(systemId);
                    else if (action == "recovery-defer" && parts[0] == "POST") response = storage.DeferRecoveryRetry(systemId, QueryValue(target, "key"));
                    else if (action == "catalog-recovery" && parts[0] == "GET") response = storage.ReadCatalogRecoveryStatus(systemId);
                    else if (action == "catalog-restore-previous" && parts[0] == "POST") response = storage.RestorePreviousCatalog(systemId);
                    else if (action == "workspace-publish" && parts[0] == "POST") response = storage.PublishWorkspace(systemId, requestBody);
                    else if (action == "workspace-open" && parts[0] == "POST") { string workspacePath = storage.LocalWorkspacePath(systemId);Process.Start("explorer.exe", "\"" + workspacePath.Replace("\"", "") + "\"");response = "{\"opened\":true}"; }
                    else if (action == "backups" && parts[0] == "GET") response = storage.ListBackups(systemId, QueryValue(target, "logical"));
                    else if (action == "restore" && parts[0] == "POST") response = storage.Restore(systemId, QueryValue(target, "logical"), QueryValue(target, "file"));
                    else if (action == "restore-drill" && parts[0] == "POST") response = storage.RestoreDrill(systemId, QueryValue(target, "logical"), QueryValue(target, "file"));
                    else if (action == "verify" && parts[0] == "GET") response = storage.VerifyLatest(systemId, QueryValue(target, "logical"));
                    else if (action == "sync-cache-clear" && parts[0] == "POST") response = storage.ClearEvidenceValidationCache(systemId);
                    else if (action == "sync-pipeline" && parts[0] == "POST") response = storage.RunSyncPipeline(systemId, QueryValue(target, "rules"), String.Equals(QueryValue(target, "full"), "1", StringComparison.Ordinal), OptionalQueryValue(target, "organization"), String.Equals(OptionalQueryValue(target, "legacy"), "1", StringComparison.Ordinal));
                    else if (action == "scan" && parts[0] == "GET") response = storage.ScanWithJournal(systemId, QueryValue(target, "rules"), String.Equals(QueryValue(target, "full"), "1", StringComparison.Ordinal), OptionalQueryValue(target, "organization"), String.Equals(OptionalQueryValue(target, "legacy"), "1", StringComparison.Ordinal));
                    else if (action == "locations" && parts[0] == "GET") response = storage.ListEvidenceLocations(systemId, OptionalQueryValue(target, "organization"), String.Equals(OptionalQueryValue(target, "full"), "1", StringComparison.Ordinal));
                    else if (action == "archive-locations" && parts[0] == "GET") response = storage.ListArchivedEvidenceLocations(systemId, QueryValue(target, "organization"));
                    else if (action == "sync-commit" && parts[0] == "POST") response = storage.CommitSyncJournal(systemId, QueryValue(target, "run"));
                    else if (action == "renamer-queue" && parts[0] == "GET") response = storage.ReadRenamerQueue(systemId);
                    else if (action == "renamer-queue" && parts[0] == "POST") response = storage.SaveRenamerQueue(systemId, requestBody);
                    else if (action == "renamer-queue" && parts[0] == "DELETE") response = storage.ClearRenamerQueue(systemId);
                    else if (action == "file" && parts[0] == "GET") { byte[] fileBytes = storage.ReadRelativeFile(systemId, QueryValue(target, "path")); await Respond(stream, 200, "application/octet-stream", fileBytes, false, "no-store"); return; } else if (action == "evidence-exists" && parts[0] == "GET") response = storage.EvidenceExists(systemId, QueryValue(target, "path")); else if (action == "file-location" && parts[0] == "POST") { string evidencePath = storage.EvidenceLocation(systemId, QueryValue(target, "path"));Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + evidencePath.Replace("\"", "") + "\"") { UseShellExecute = true });response = "{\"opened\":true}"; }
                    else if (action == "archive" && parts[0] == "POST") response = storage.ArchiveEvidence(systemId, QueryValue(target, "path"), OptionalQueryValue(target, "filename"), String.Equals(OptionalQueryValue(target, "rework"), "1", StringComparison.Ordinal));
                    else if (action == "rework" && parts[0] == "POST") response = storage.MoveEvidenceToRework(systemId, QueryValue(target, "path"));
                    else if (action == "rework-retention" && parts[0] == "POST") response = storage.ProcessReworkRetention(systemId, QueryValue(target, "rules"), String.Equals(QueryValue(target, "full"), "1", StringComparison.Ordinal), OptionalQueryValue(target, "organization"), String.Equals(OptionalQueryValue(target, "legacy"), "1", StringComparison.Ordinal));
                    else if (action == "compress" && parts[0] == "POST") response = storage.CompressEvidence(systemId, QueryValue(target, "path"));
                    else if (action == "organize" && parts[0] == "POST") response = storage.OrganizeEvidence(systemId, QueryValue(target, "path"), QueryValue(target, "folder"));
                    else if (action == "restore-active" && parts[0] == "POST") response = storage.RestoreActiveEvidence(systemId, requestBody);
                    else if (action == "normalize-date" && parts[0] == "POST") response = storage.NormalizeEvidenceFilename(systemId, QueryValue(target, "path"), QueryValue(target, "filename"));
                    else if (action == "relabel-user-evidence" && parts[0] == "POST") response = storage.RelabelUserEvidence(systemId, QueryValue(target, "path"), QueryValue(target, "organization"), QueryValue(target, "kind"), QueryValue(target, "filename"));
                    else if (action == "organizations" && parts[0] == "GET") response = storage.ListOrganizations(systemId);
                    else if (action == "organizations" && parts[0] == "POST") response = storage.CreateOrganization(systemId, QueryValue(target, "name"));
                    else if (action == "evidence" && parts[0] == "POST") response = "{\"filename\":\"" + Json(storage.StoreEvidence(systemId, QueryValue(target, "organization"), QueryValue(target, "kind"), QueryValue(target, "filename"), requestBody)) + "\"}";
                    else if (action == "evidence-pdf" && parts[0] == "POST") response = storage.StoreEvidencePdf(systemId, QueryValue(target, "organization"), QueryValue(target, "kind"), QueryValue(target, "filename"), requestBody);
                    else if (action == "evidence-status" && parts[0] == "GET") response = storage.VerifyStoredEvidence(systemId, QueryValue(target, "organization"), QueryValue(target, "kind"), QueryValue(target, "filename"), QueryValue(target, "sha256"));
                    else if (action == "evidence-pdf-status" && parts[0] == "GET") response = storage.VerifyStoredEvidencePdf(systemId, QueryValue(target, "organization"), QueryValue(target, "kind"), QueryValue(target, "filename"), QueryValue(target, "sha256"));
                    else if (action == "outlook-draft" && parts[0] == "POST") response = OpenOutlookDraft(systemId, requestBody);
                    else if (action == "report" && parts[0] == "POST") response = storage.StoreReport(systemId, QueryValue(target, "filename"), requestBody);
                    else if (action == "error-report" && parts[0] == "POST") response = storage.StoreErrorReport(systemId, QueryValue(target, "filename"), Encoding.UTF8.GetString(requestBody));
                    else if (action == "audit" && parts[0] == "POST") { storage.AppendAudit(systemId, Encoding.UTF8.GetString(requestBody)); response = "{\"ok\":true}"; }
                    else if (action == "audit-batch" && parts[0] == "POST") { storage.AppendAuditBatchJson(systemId, Encoding.UTF8.GetString(requestBody)); response = "{\"ok\":true}"; }
                    else if (action == "audit-verify" && parts[0] == "GET") response = storage.VerifyAuditLogs(systemId);
                    else if (action == "audit-view" && parts[0] == "GET") response = storage.ReadAuditLogs(systemId);
                    else if (action == "performance" && parts[0] == "GET") response = storage.ReadPerformanceDiagnostics(systemId);
                    else if (action == "network-qualification" && parts[0] == "POST") response = storage.RunNetworkQualification(systemId);
                    else if (action == "diagnostics" && parts[0] == "GET") response = storage.ReadSanitizedDiagnostics(systemId);
                    else if (action == "lease-acquire" && parts[0] == "POST") response = "{\"acquired\":" + (storage.AcquireLease(systemId, QueryValue(target, "session")) ? "true" : "false") + "}";
                    else if (action == "lease-renew" && parts[0] == "POST") response = "{\"renewed\":" + (storage.RenewLease(systemId, QueryValue(target, "session")) ? "true" : "false") + "}";
                    else if (action == "lease-release" && parts[0] == "POST") { storage.ReleaseLease(systemId, QueryValue(target, "session")); response = "{\"released\":true}"; }
                    else { await Respond(stream, 404, "text/plain", Encoding.UTF8.GetBytes("Not Found"), false, "no-store"); return; }
                    if (mutation && !String.IsNullOrWhiteSpace(operationId)) storage.SaveOperationReceipt(systemId, operationId, action, requestSha256, response);
                    if (!String.IsNullOrWhiteSpace(recoveryRunId)) storage.CompleteRecoveryOperation(systemId, recoveryRunId, action);
                    try { await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(response), false, "no-store"); } catch (IOException) { } catch (SocketException) { }
                    return;
                }
                catch (Exception ex)
                {
                    if (!String.IsNullOrWhiteSpace(recoveryRunId)) try { storage.FailRecoveryOperation(systemId, recoveryRunId, action, operationId, requestSha256, OptionalQueryValue(target, "organization"), ex); } catch { }
                    string message = StorageError(ex, storageAction) + (String.IsNullOrWhiteSpace(operationId) ? "" : " Operation ID: " + CleanError(operationId).Substring(0, Math.Min(CleanError(operationId).Length, 100)) + ".");
                    if (!String.Equals(storageAction, "error-report", StringComparison.Ordinal)) try
                    {
                        string now = DateTime.UtcNow.ToString("o"), report = "R.A.P.T.O.R. Error Entry\r\nApplication: Role-Based Access Personnel Tracking & Oversight Registry\r\nGeneration Time UTC: " + now + "\r\nWindows Operator: " + user + "\r\nInformation System ID: " + systemId + "\r\nContext: Windows launcher storage operation " + CleanError(storageAction) + ".\r\nDetails: " + ErrorReportDetail(ex) + "\r\nOperation ID: " + CleanError(operationId ?? "Unavailable");
                        storage.StoreErrorReport(systemId, "error-report-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".txt", report);
                    }
                    catch { }
                    try { Respond(stream, 400, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(CleanError(message)), false, "no-store").GetAwaiter().GetResult(); } catch (IOException) { } catch (SocketException) { }
                    return;
                }
                finally { EndStorageRequest(); if (serializedStorage) { ClearActiveStorageOperation(systemId);systemStorageOperations.Release(); } }
            }
            WebAsset asset;
            if (assets.TryGetValue(path, out asset)) { string cache = path == "/favicon.ico" || path == "/raptor-icon.png" ? "no-cache, max-age=0" : "public, max-age=31536000, immutable"; await Respond(stream, 200, asset.ContentType, asset.Bytes, parts[0] == "HEAD", cache, "gzip"); return; }
            if (path == "/" || path == "/index.html" || !Path.HasExtension(path)) { await Respond(stream, 200, "text/html; charset=utf-8", indexHtml, parts[0] == "HEAD", "no-cache"); return; }
            await Respond(stream, 404, "text/plain", Encoding.UTF8.GetBytes("Not Found"), parts[0] == "HEAD", "no-store");
        }
    }

    internal static bool StorageActionRequiresSerialization(string action)
    {
        return LauncherPolicy.StorageActionRequiresSerialization(action);
    }

    internal static bool StorageActionRequiresLease(string action, string method)
    {
        return LauncherPolicy.StorageActionRequiresLease(action, method);
    }

    private SemaphoreSlim StorageQueue(string systemId)
    {
        lock (storageOperationsGate)
        {
            SemaphoreSlim queue;
            if (!storageOperations.TryGetValue(systemId, out queue)) { queue = new SemaphoreSlim(1, 1);storageOperations[systemId] = queue; }
            return queue;
        }
    }

    internal static string StorageActionDisplayName(string action)
    {
        string value = (action ?? "").Split('?')[0].Replace('-', ' ').Trim();
        if (value.Length > 80) value = value.Substring(0, 80);
        return String.IsNullOrWhiteSpace(value) ? "verified storage operation" : value;
    }

    private void SetActiveStorageOperation(string systemId, string operation) { lock (storageOperationsGate) activeStorageOperationNames[systemId] = operation; }
    private void ClearActiveStorageOperation(string systemId) { lock (storageOperationsGate) activeStorageOperationNames.Remove(systemId); }
    private string ActiveStorageOperation(string systemId) { lock (storageOperationsGate) { string value;return activeStorageOperationNames.TryGetValue(systemId, out value) ? value : ""; } }
    private string ActiveStorageOperationSummary() { lock (storageOperationsGate) return activeStorageOperationNames.Values.FirstOrDefault() ?? ""; }

    internal static int StorageQueueWaitMilliseconds(string action, string method)
    {
        return LauncherPolicy.StorageQueueWaitMilliseconds(action, method);
    }

    internal static bool ReadOnlyStorageActionAllowed(string action, string method)
    {
        return LauncherPolicy.ReadOnlyStorageActionAllowed(action, method);
    }

    private static string CreateSessionToken()
    {
        byte[] bytes = new byte[32];
        using (RandomNumberGenerator random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private bool SessionTokenMatches(string candidate)
    {
        if (String.IsNullOrEmpty(candidate) || candidate.Length != sessionToken.Length) return false;
        int difference = 0;
        for (int index = 0; index < sessionToken.Length; index++) difference |= sessionToken[index] ^ candidate[index];
        return difference == 0;
    }

    private string SessionAccessMode() { lock (sessionGate) return sessionAccessMode; }

    private bool OpenSession(string mode)
    {
        if (!String.Equals(mode, "read-only", StringComparison.Ordinal) && !String.Equals(mode, "full", StringComparison.Ordinal)) throw new InvalidDataException("The requested access mode is invalid.");
        lock (sessionGate)
        {
            if (!String.Equals(sessionAccessMode, "unselected", StringComparison.Ordinal) && !String.Equals(sessionAccessMode, mode, StringComparison.Ordinal)) return false;
            sessionAccessMode = mode;return true;
        }
    }

    private void DowngradeSession()
    {
        lock (sessionGate)
        {
            if (String.Equals(sessionAccessMode, "unselected", StringComparison.Ordinal)) throw new InvalidOperationException("Choose an access mode before requesting a downgrade.");
            sessionAccessMode = "read-only";
        }
    }

    private async Task<bool> DowngradeSessionAndReleaseLeases()
    {
        // Change the authorization state before waiting. New mutations are rejected,
        // and the pre-dispatch mode check above rejects requests that passed their
        // first authorization check just before this transition.
        DowngradeSession();
        KeyValuePair<string, SemaphoreSlim>[] queues;
        lock (storageOperationsGate) queues = storageOperations.OrderBy(item => item.Key, StringComparer.Ordinal).ToArray();
        var acquired = new List<SemaphoreSlim>();
        try
        {
            foreach (KeyValuePair<string, SemaphoreSlim> item in queues)
            {
                // Do not strand the request forever if a storage provider hangs.
                // On timeout the lease remains held, which is the safe failure mode;
                // normal lease expiry can recover it once active storage becomes idle.
                if (!await item.Value.WaitAsync(120000)) return false;
                acquired.Add(item.Value);
            }
            storage.ReleaseAllLeases();
            return true;
        }
        finally
        {
            for (int index = acquired.Count - 1; index >= 0; index--) acquired[index].Release();
        }
    }

    private Task<string> ChooseFolder() { return ChooseFolder("Select the Shared Folder for This Information System", null, true); }

    private Task<string> ChooseFolder(string description, string initialPath, bool allowCreate)
    {
        var result = new TaskCompletionSource<string>();
        dispatcher.BeginInvoke(new Action(delegate
        {
            IFileDialog dialog = null; IShellItem initialFolder = null; IShellItem selectedFolder = null;
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
                {
                    owner.Show();
                    owner.Activate();
                    owner.BringToFront();
                    SetForegroundWindow(owner.Handle);
                    Type dialogType = Type.GetTypeFromCLSID(new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7"));
                    if (dialogType == null) throw new InvalidOperationException("Windows Explorer folder selection is unavailable on this computer.");
                    dialog = (IFileDialog)Activator.CreateInstance(dialogType);
                    uint options; dialog.GetOptions(out options);
                    const uint PickFolders = 0x00000020, ForceFileSystem = 0x00000040, PathMustExist = 0x00000800, DontAddToRecent = 0x02000000;
                    dialog.SetOptions(options | PickFolders | ForceFileSystem | PathMustExist | DontAddToRecent);
                    dialog.SetTitle(description);
                    dialog.SetOkButtonLabel("Select Folder");
                    if (!String.IsNullOrWhiteSpace(initialPath) && Directory.Exists(initialPath))
                    {
                        Guid shellItemId = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
                        SHCreateItemFromParsingName(initialPath, IntPtr.Zero, ref shellItemId, out initialFolder);
                        dialog.SetFolder(initialFolder);
                    }
                    int shown = dialog.Show(owner.Handle);
                    if (shown == unchecked((int)0x800704C7)) { result.SetResult(null); return; }
                    Marshal.ThrowExceptionForHR(shown);
                    dialog.GetResult(out selectedFolder);
                    IntPtr pathPointer = IntPtr.Zero;
                    try
                    {
                        selectedFolder.GetDisplayName(0x80058000, out pathPointer);
                        string selectedPath = pathPointer == IntPtr.Zero ? null : Marshal.PtrToStringUni(pathPointer);
                        if (String.IsNullOrWhiteSpace(selectedPath) || !Directory.Exists(selectedPath)) throw new DirectoryNotFoundException("The selected Explorer folder is unavailable.");
                        result.SetResult(selectedPath);
                    }
                    finally { if (pathPointer != IntPtr.Zero) Marshal.FreeCoTaskMem(pathPointer); }
                }
            }
            catch (Exception ex) { result.SetException(ex); }
            finally
            {
                if (selectedFolder != null) Marshal.ReleaseComObject(selectedFolder);
                if (initialFolder != null) Marshal.ReleaseComObject(initialFolder);
                if (dialog != null) Marshal.ReleaseComObject(dialog);
            }
        }));
        return result.Task;
    }

    private Task<string[]> ChooseZipFiles(string initialPath)
    {
        var result = new TaskCompletionSource<string[]>();
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
                using (var dialog = new OpenFileDialog
                {
                    Title = "Select Evidence ZIP Files to Unarchive",
                    InitialDirectory = initialPath,
                    Filter = "Evidence ZIP Files (*.zip)|*.zip",
                    CheckFileExists = true,
                    Multiselect = true
                })
                {
                    owner.Show();owner.Activate();owner.BringToFront();SetForegroundWindow(owner.Handle);
                    DialogResult selected = dialog.ShowDialog(owner);
                    result.SetResult(selected == DialogResult.OK ? dialog.FileNames : null);
                }
            }
            catch (Exception ex) { result.SetException(ex); }
        }));
        return result.Task;
    }

    private string OpenOutlookDraft(string systemId, byte[] requestBody)
    {
        if (requestBody == null || requestBody.Length == 0 || requestBody.Length > 40 * 1024 * 1024) throw new InvalidDataException("The Outlook draft request is empty or too large.");
        var serializer = new JavaScriptSerializer { MaxJsonLength = 40 * 1024 * 1024, RecursionLimit = 20 };
        Dictionary<string, object> request;
        try { request = serializer.DeserializeObject(Encoding.UTF8.GetString(requestBody)) as Dictionary<string, object>; }
        catch (Exception error) { throw new InvalidDataException("The Outlook draft request is not valid JSON.", error); }
        if (request == null) throw new InvalidDataException("The Outlook draft request is invalid.");
        string to = request.ContainsKey("to") ? Convert.ToString(request["to"]) : "", bcc = request.ContainsKey("bcc") ? Convert.ToString(request["bcc"]) : "", subject = request.ContainsKey("subject") ? Convert.ToString(request["subject"]) : "", body = request.ContainsKey("body") ? Convert.ToString(request["body"]) : "";
        string attachmentFilename = request.ContainsKey("attachmentFilename") ? Convert.ToString(request["attachmentFilename"]) : "", attachmentText = request.ContainsKey("attachmentText") ? Convert.ToString(request["attachmentText"]) : "";
        object[] requestedTemplateValues = request.ContainsKey("templateTypes") ? request["templateTypes"] as object[] : null;
        string[] templateTypes = requestedTemplateValues == null ? new string[0] : requestedTemplateValues.Select(value => Convert.ToString(value)).Where(value => !String.IsNullOrWhiteSpace(value)).Distinct(StringComparer.Ordinal).ToArray();
        string legacyTemplateType = request.ContainsKey("templateType") ? Convert.ToString(request["templateType"]) : "";
        if (templateTypes.Length == 0 && !String.IsNullOrWhiteSpace(legacyTemplateType)) templateTypes = new[] { legacyTemplateType };
        if (templateTypes.Length == 0 && request.ContainsKey("attachUserAgreementTemplate") && Convert.ToBoolean(request["attachUserAgreementTemplate"])) templateTypes = new[] { "user-agreement" };
        bool attachTemplate = templateTypes.Length > 0;
        object[] requestedAuditSystems = request.ContainsKey("auditSystemIds") ? request["auditSystemIds"] as object[] : null;
        string[] requestedAuditSystemIds = requestedAuditSystems == null ? new string[0] : requestedAuditSystems.Select(value => Convert.ToString(value)).Where(value => !String.IsNullOrWhiteSpace(value)).ToArray();
        if (requestedAuditSystemIds.Length > 40 || requestedAuditSystemIds.Any(value => value.Length > 100 || value.IndexOfAny(new[] { '\r', '\n', '\0', '/', '\\' }) >= 0)) throw new InvalidDataException("The Outlook audit-system list is invalid.");
        // The endpoint's mapped system is always part of the audit scope. This keeps a
        // stale browser selection from rejecting an otherwise valid draft while still
        // guaranteeing that the storage context which prepared it receives an outcome.
        string[] auditSystemIds = requestedAuditSystemIds.Concat(new[] { systemId }).Distinct(StringComparer.Ordinal).ToArray();
        if (auditSystemIds.Length == 0 || auditSystemIds.Length > 40) throw new InvalidDataException("The Outlook audit-system list is invalid.");
        if (bcc.Length > 8000 || bcc.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) throw new InvalidDataException("The Outlook BCC list is invalid.");
        if (to.Length > 254 || to.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) throw new InvalidDataException("The Outlook To address is invalid.");
        if (String.IsNullOrWhiteSpace(subject) || subject.Length > 200 || subject.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) throw new InvalidDataException("The Outlook subject is invalid.");
        if (body.Length > 20000 || body.IndexOf('\0') >= 0) throw new InvalidDataException("The Outlook message body is invalid or too large.");
        string[] recipients = bcc.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries).Select(value => value.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (recipients.Length > 40 || (recipients.Length == 0 && String.IsNullOrWhiteSpace(to)) || (recipients.Length > 0 && !String.IsNullOrWhiteSpace(to))) throw new InvalidDataException("The Outlook draft must contain either one To recipient or between 1 and 40 unique BCC recipients.");
        foreach (string recipient in recipients)
        {
            if (recipient.Length > 254) throw new InvalidDataException("An Outlook BCC address is too long.");
            try { var parsed = new System.Net.Mail.MailAddress(recipient);if (!String.Equals(parsed.Address, recipient, StringComparison.OrdinalIgnoreCase)) throw new FormatException(); }
            catch { throw new InvalidDataException("The Outlook BCC list contains an invalid email address."); }
        }
        if (!String.IsNullOrWhiteSpace(to))
        {
            try { var parsed = new System.Net.Mail.MailAddress(to.Trim());if (!String.Equals(parsed.Address, to.Trim(), StringComparison.OrdinalIgnoreCase)) throw new FormatException();to = parsed.Address; }
            catch { throw new InvalidDataException("The Outlook To address is invalid."); }
        }
        bool attachOrganizationSnapshot = !String.IsNullOrEmpty(attachmentText) || !String.IsNullOrEmpty(attachmentFilename);
        if (templateTypes.Length > 2 || templateTypes.Any(value => !String.Equals(value, "user-agreement", StringComparison.Ordinal) && !String.Equals(value, "8140-qualification-memo", StringComparison.Ordinal))) throw new InvalidDataException("The Outlook template list is invalid.");
        if (attachTemplate && attachOrganizationSnapshot) throw new InvalidDataException("Template documents and an organization snapshot cannot be attached to the same Outlook draft.");
        if (attachOrganizationSnapshot)
        {
            if (String.IsNullOrWhiteSpace(attachmentText) || Encoding.UTF8.GetByteCount(attachmentText) > 25 * 1024 * 1024) throw new InvalidDataException("The organization status attachment is empty or exceeds 25 MB.");
            if (String.IsNullOrWhiteSpace(attachmentFilename) || attachmentFilename.Length > 180 || !attachmentFilename.EndsWith(".raptor-status.json", StringComparison.OrdinalIgnoreCase) || !String.Equals(Path.GetFileName(attachmentFilename), attachmentFilename, StringComparison.Ordinal) || attachmentFilename.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new InvalidDataException("The organization status attachment filename is invalid.");
            Dictionary<string, object> package;
            try { package = serializer.DeserializeObject(attachmentText) as Dictionary<string, object>; }
            catch (Exception error) { throw new InvalidDataException("The organization status attachment is not valid JSON.", error); }
            var payload = package != null && package.ContainsKey("payload") ? package["payload"] as Dictionary<string, object> : null;
            if (payload == null || !payload.ContainsKey("format") || !String.Equals(Convert.ToString(payload["format"]), "RAPTOR Organization Status", StringComparison.Ordinal)) throw new InvalidDataException("The organization status attachment is not a valid R.A.P.T.O.R. snapshot.");
        }
        if (Interlocked.CompareExchange(ref outlookDraftActive, 1, 0) != 0) throw new InvalidOperationException("Another Outlook draft is still being prepared. Wait for it to open before trying again.");
        string htmlBody = OutlookHtmlBody(body), operationId = Guid.NewGuid().ToString("N").ToUpperInvariant();
        var outlookThread = new Thread(new ThreadStart(delegate
        {
            object outlook = null, message = null, attachments = null; var attachmentObjects = new List<object>();var temporaryAttachmentPaths = new List<string>();
            try
            {
                var attachmentPaths = new List<string>();
                if (attachTemplate)
                {
                    foreach (string templateType in templateTypes)
                    {
                        Task<string> templateLookup = Task.Run(() => storage.StageOutlookTemplateAttachment(systemId, templateType));
                        if (!templateLookup.Wait(TimeSpan.FromMinutes(5))) throw new TimeoutException("A requested Template-folder attachment could not be validated within five minutes. Confirm that the mapped folder is available and try again.");
                        string temporaryAttachmentPath = templateLookup.GetAwaiter().GetResult();
                        temporaryAttachmentPaths.Add(temporaryAttachmentPath);attachmentPaths.Add(temporaryAttachmentPath);
                    }
                }
                else if (attachOrganizationSnapshot)
                {
                    string temporaryDirectory = Path.Combine(Path.GetTempPath(), "RAPTOR", "Organization Status");Directory.CreateDirectory(temporaryDirectory);
                    string temporaryAttachmentPath = Path.Combine(temporaryDirectory, Guid.NewGuid().ToString("N") + "-" + attachmentFilename);
                    File.WriteAllText(temporaryAttachmentPath, attachmentText, new UTF8Encoding(false));
                    temporaryAttachmentPaths.Add(temporaryAttachmentPath);attachmentPaths.Add(temporaryAttachmentPath);
                }
                Type outlookType = Type.GetTypeFromProgID("Outlook.Application");
                if (outlookType == null) throw new InvalidOperationException("Classic Microsoft Outlook is not installed or available to this Windows account.");
                outlook = Activator.CreateInstance(outlookType);
                message = outlookType.InvokeMember("CreateItem", BindingFlags.InvokeMethod | BindingFlags.Public | BindingFlags.Instance, null, outlook, new object[] { 0 });
                Type messageType = message.GetType();
                if (!String.IsNullOrWhiteSpace(to)) messageType.InvokeMember("To", BindingFlags.SetProperty | BindingFlags.Public | BindingFlags.Instance, null, message, new object[] { to });
                else messageType.InvokeMember("BCC", BindingFlags.SetProperty | BindingFlags.Public | BindingFlags.Instance, null, message, new object[] { String.Join(";", recipients) });
                messageType.InvokeMember("Subject", BindingFlags.SetProperty | BindingFlags.Public | BindingFlags.Instance, null, message, new object[] { subject });
                if (attachmentPaths.Count > 0)
                {
                    attachments = messageType.InvokeMember("Attachments", BindingFlags.GetProperty | BindingFlags.Public | BindingFlags.Instance, null, message, null);
                    foreach (string attachmentPath in attachmentPaths) attachmentObjects.Add(attachments.GetType().InvokeMember("Add", BindingFlags.InvokeMethod | BindingFlags.OptionalParamBinding | BindingFlags.Public | BindingFlags.Instance, null, attachments, new object[] { attachmentPath, Type.Missing, Type.Missing, Type.Missing }));
                }
                messageType.InvokeMember("Display", BindingFlags.InvokeMethod | BindingFlags.OptionalParamBinding | BindingFlags.Public | BindingFlags.Instance, null, message, new object[] { false });
                string signatureHtml = Convert.ToString(messageType.InvokeMember("HTMLBody", BindingFlags.GetProperty | BindingFlags.Public | BindingFlags.Instance, null, message, null));
                messageType.InvokeMember("HTMLBody", BindingFlags.SetProperty | BindingFlags.Public | BindingFlags.Instance, null, message, new object[] { OutlookHtmlWithSignature(htmlBody, signatureHtml) });
                RecordOutlookOutcome(auditSystemIds, "OUTLOOK DRAFT DISPLAYED: operation " + operationId + "; " + (String.IsNullOrWhiteSpace(to) ? recipients.Length + " BCC recipients" : "one To recipient") + "; managed templates " + (attachTemplate ? String.Join(", ", templateTypes) + " attached" : "not applicable") + "; organization snapshot " + (attachOrganizationSnapshot ? "attached" : "not applicable") + "; operator review required before sending", null, operationId);
            }
            catch (Exception error)
            {
                string failure = CleanError(error.InnerException != null ? error.InnerException.Message : error.Message);
                RecordOutlookOutcome(auditSystemIds, "OUTLOOK DRAFT FAILED: operation " + operationId + "; " + failure, failure, operationId);
                try { dispatcher.BeginInvoke(new Action(delegate { MessageBox.Show("Microsoft Outlook could not create the draft. " + failure, "R.A.P.T.O.R.", MessageBoxButtons.OK, MessageBoxIcon.Error); })); }
                catch { }
            }
            finally
            {
                foreach (object attachmentObject in attachmentObjects.AsEnumerable().Reverse()) ReleaseComObject(attachmentObject);ReleaseComObject(attachments);ReleaseComObject(message);ReleaseComObject(outlook);
                foreach (string temporaryAttachmentPath in temporaryAttachmentPaths)
                {
                    try { File.Delete(temporaryAttachmentPath); } catch { }
                    try { string temporaryDirectory = Path.GetDirectoryName(temporaryAttachmentPath);if (!String.IsNullOrWhiteSpace(temporaryDirectory) && Directory.Exists(temporaryDirectory)) Directory.Delete(temporaryDirectory, false); } catch { }
                }
                Interlocked.Exchange(ref outlookDraftActive, 0);
            }
        }));
        outlookThread.IsBackground = true;
        outlookThread.Name = "R.A.P.T.O.R. Outlook Draft";
        outlookThread.SetApartmentState(ApartmentState.STA);
        try { outlookThread.Start(); }
        catch { Interlocked.Exchange(ref outlookDraftActive, 0);throw; }
        string[] responseAttachments = attachTemplate ? templateTypes.Select(value => String.Equals(value, "8140-qualification-memo", StringComparison.Ordinal) ? PortableStorage.QualificationMemoTemplatePattern : PortableStorage.UserAgreementTemplateFilename).ToArray() : attachOrganizationSnapshot ? new[] { attachmentFilename } : new string[0];
        string responseAttachment = responseAttachments.FirstOrDefault(), responseAttachmentList = "[" + String.Join(",", responseAttachments.Select(value => "\"" + Json(value) + "\"")) + "]";
        return "{\"queued\":true,\"operationId\":\"" + operationId + "\",\"attachment\":" + (responseAttachment == null ? "null" : "\"" + Json(responseAttachment) + "\"") + ",\"attachments\":" + responseAttachmentList + "}";
    }

    internal static string OutlookHtmlBody(string body)
    {
        string normalized = (body ?? "").Replace("\r\n", "\n").Replace('\r', '\n');
        string[] lines = normalized.Split('\n');
        var html = new StringBuilder("<html><body style=\"font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000000\">");
        bool highlightFilenameStandard = false;
        foreach (string line in lines)
        {
            if (String.Equals(line, "IMPORTANT - REQUIRED FILE NAME", StringComparison.Ordinal) || String.Equals(line, "IMPORTANT — REQUIRED FILE NAME", StringComparison.Ordinal) || String.Equals(line, "IMPORTANT - REQUIRED FILE NAMES", StringComparison.Ordinal) || String.Equals(line, "IMPORTANT — REQUIRED FILE NAMES", StringComparison.Ordinal)) highlightFilenameStandard = true;
            if (line.StartsWith("Rename the file before returning it.", StringComparison.Ordinal) || line.StartsWith("If you have already submitted this document", StringComparison.Ordinal) || line.StartsWith("If you have already submitted any of these documents", StringComparison.Ordinal)) highlightFilenameStandard = false;
            string encoded = WebUtility.HtmlEncode(line);
            if (String.Equals(line, "https://www.cyber.mil/cyber-awareness-challenge", StringComparison.Ordinal) || String.Equals(line, "https://www.cdse.edu/Training/eLearning/DS-IA112/", StringComparison.Ordinal)) encoded = "<a href=\"" + WebUtility.HtmlEncode(line) + "\">" + WebUtility.HtmlEncode(line) + "</a>";
            if (highlightFilenameStandard && encoded.Length > 0) html.Append("<span style=\"background-color:#fff200;color:#000000;font-weight:bold\">").Append(encoded).Append("</span>");
            else html.Append(encoded);
            html.Append("<br>");
        }
        return html.Append("</body></html>").ToString();
    }

    internal static string OutlookHtmlWithSignature(string messageHtml, string signatureHtml)
    {
        if (String.IsNullOrWhiteSpace(signatureHtml)) return messageHtml;
        int bodyStart = signatureHtml.IndexOf("<body", StringComparison.OrdinalIgnoreCase), bodyOpenEnd = bodyStart >= 0 ? signatureHtml.IndexOf('>', bodyStart) : -1, bodyEnd = bodyOpenEnd >= 0 ? signatureHtml.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase) : -1;
        string signatureContent = bodyOpenEnd >= 0 && bodyEnd > bodyOpenEnd ? signatureHtml.Substring(bodyOpenEnd + 1, bodyEnd - bodyOpenEnd - 1) : signatureHtml;
        int messageBodyEnd = messageHtml.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        return messageBodyEnd >= 0 ? messageHtml.Insert(messageBodyEnd, "<br>" + signatureContent) : messageHtml + "<br>" + signatureContent;
    }

    private void RecordOutlookOutcome(string[] systemIds, string action, string failure, string operationId)
    {
        foreach (string id in systemIds)
        {
            string auditFailure = null;
            try { storage.AppendAudit(id, action); }
            catch (Exception error) { auditFailure = CleanError(error.InnerException != null ? error.InnerException.Message : error.Message); }
            if (failure == null && auditFailure == null) continue;
            try
            {
                string now = DateTime.UtcNow.ToString("o"), detail = failure ?? ("The Outlook draft was displayed, but its completion audit could not be recorded. " + auditFailure), report = "R.A.P.T.O.R. Error Entry\r\nApplication: Role-Based Access Personnel Tracking & Oversight Registry\r\nGeneration Time UTC: " + now + "\r\nWindows Operator: " + user + "\r\nInformation System ID: " + id + "\r\nContext: Outlook draft outcome.\r\nDetails: " + detail + "\r\nOperation ID: " + operationId;
                storage.StoreErrorReport(id, "error-report-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".txt", report);
            }
            catch { }
        }
    }

    private static void ReleaseComObject(object value)
    {
        try { if (value != null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value); }
        catch { }
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

    internal static long RequestBodyLimit(string path, string method) { return LauncherPolicy.RequestBodyLimit(path, method); }

    private static async Task<byte[]> ReadBody(NetworkStream stream, long length, long endpointLimit)
    {
        if (length < 0 || length > endpointLimit || length > Int32.MaxValue) throw new InvalidDataException("The request body exceeds the endpoint limit.");
        using (var body = new MemoryStream(length > 0 ? (int)Math.Min(length, 64L * KiB) : 0))
        {
            byte[] buffer = new byte[64 * 1024];long remaining = length;
            while (remaining > 0)
            {
                int requested = (int)Math.Min((long)buffer.Length, remaining), read = await stream.ReadAsync(buffer, 0, requested);
                if (read == 0) throw new EndOfStreamException("The request body ended unexpectedly.");
                body.Write(buffer, 0, read);remaining -= read;
            }
            return body.ToArray();
        }
    }

    private static string QueryValue(string target, string name) { int question = target.IndexOf('?'); if (question < 0) throw new InvalidDataException("A required request value is missing.");foreach (string pair in target.Substring(question + 1).Split('&')) { int equals = pair.IndexOf('='); if (equals >= 0 && Uri.UnescapeDataString(pair.Substring(0, equals)) == name) return Uri.UnescapeDataString(pair.Substring(equals + 1)); }throw new InvalidDataException("A required request value is missing."); }

    private static string OptionalQueryValue(string target, string name) { int question = target.IndexOf('?'); if (question < 0) return null;foreach (string pair in target.Substring(question + 1).Split('&')) { int equals = pair.IndexOf('='); if (equals >= 0 && Uri.UnescapeDataString(pair.Substring(0, equals)) == name) return Uri.UnescapeDataString(pair.Substring(equals + 1)); }return null; }

    private static string CleanError(string value) { if (String.IsNullOrWhiteSpace(value)) return "The storage request failed."; string clean = value.Replace("\r", " ").Replace("\n", " ").Replace("\0", " ").Trim(); return clean.Length > 1200 ? clean.Substring(0, 1200) : clean; }

    private static string OperationRequestSha256(string method, string target, byte[] body) { byte[] prefix = Encoding.UTF8.GetBytes((method ?? "") + "\n" + (target ?? "") + "\n"), payload = body ?? new byte[0];using (SHA256 sha = SHA256.Create()) { sha.TransformBlock(prefix, 0, prefix.Length, null, 0);sha.TransformFinalBlock(payload, 0, payload.Length);return BitConverter.ToString(sha.Hash).Replace("-", "").ToLowerInvariant(); } }
    private static string ErrorReportDetail(Exception error) { string value = error == null ? "The launcher operation failed without an exception detail." : error.ToString();value = value.Replace("\0", " ").Trim();return value.Length > 64 * 1024 ? value.Substring(0, 64 * 1024) : value; }
    private static string StorageError(Exception ex, string operation)
    {
        string stage = String.IsNullOrWhiteSpace(operation) ? "storage request" : operation.Replace('-', ' ');
        if (ex is PathTooLongException) return "Storage operation " + stage + " failed. PathTooLongException: The mapped folder path plus the evidence filename exceeds the Windows path limit. This build uses long-path support and short temporary names; if the error continues, map the share to a drive letter or shorten the folders above the evidence file.";
        string detail = "Storage operation " + stage + " failed. " + ex.GetType().Name + ": " + CleanError(ex.Message);
        if (ex is UnauthorizedAccessException) return detail + " Confirm that your Windows account has read, create, modify, delete, and rename permissions on the network share.";
        if (ex is DirectoryNotFoundException || ex is DriveNotFoundException) return detail + " The mapped network location is unavailable. Reconnect the drive or UNC share, then map the system folder again.";
        if (ex is FileNotFoundException) return detail + " The file was moved, renamed, or removed after Sync Review recorded its location. This is usually a stale Sync reference, not a network failure. Refresh Sync before applying the update again.";
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

    private void RecordPresence()
    {
        lock (lifecycleGate)
        {
            lastPresenceUtc = DateTime.UtcNow;
            // A live page heartbeat wins a race with the browser-closed grace period.
            // Operator logoff and idle shutdown remain final once requested.
            if (shutdownReason == "browser-closed")
            {
                shutdownRequestedUtc = null;
                shutdownReason = null;
                shutdownReady = false;
            }
        }
    }

    private void BeginStorageRequest()
    {
        lock (lifecycleGate)
        {
            activeStorageRequests++;
            lastActivityUtc = DateTime.UtcNow;
            lastPresenceUtc = lastActivityUtc;
        }
    }

    private void EndStorageRequest()
    {
        lock (lifecycleGate)
        {
            if (activeStorageRequests > 0) activeStorageRequests--;
            lastActivityUtc = DateTime.UtcNow;
            lastPresenceUtc = lastActivityUtc;
        }
    }

    private void SetLongOperation(bool active)
    {
        lock (lifecycleGate)
        {
            longOperationActive = active;
            lastLongOperationHeartbeatUtc = active ? DateTime.UtcNow : DateTime.MinValue;
            lastActivityUtc = DateTime.UtcNow;
            lastPresenceUtc = lastActivityUtc;
        }
    }

    private void SetBackupClean(bool clean) { lock (lifecycleGate) { backupClean = clean; } }

    private void RequestShutdown(string reason)
    {
        lock (lifecycleGate)
        {
            if (!shutdownRequestedUtc.HasValue) shutdownRequestedUtc = DateTime.UtcNow;
            shutdownReason = reason;
            shutdownReady = false;
        }
    }

    private void StartBackupFinalization()
    {
        lock (lifecycleGate)
        {
            if (shutdownFinalizationActive || shutdownFinalizationComplete || shutdownFinalizationAttempts >= 2) return;
            shutdownFinalizationActive = true;
            shutdownFinalizationAttempts++;
        }
        Task.Run(delegate
        {
            bool completed = false;
            try { storage.FinalizePendingBackups();completed = true; }
            catch { }
            lock (lifecycleGate)
            {
                shutdownFinalizationActive = false;
                shutdownFinalizationComplete = completed;
                backupClean = completed;
            }
        });
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
        string activeOperation = ActiveStorageOperationSummary();
        lock (lifecycleGate)
        {
            return "{\"shutdownRequested\":" + (shutdownRequestedUtc.HasValue ? "true" : "false") + ",\"reason\":\"" + Json(shutdownReason ?? "") + "\",\"backupClean\":" + (backupClean ? "true" : "false") + ",\"shutdownFinalizationActive\":" + (shutdownFinalizationActive ? "true" : "false") + ",\"shutdownFinalizationComplete\":" + (shutdownFinalizationComplete ? "true" : "false") + ",\"activeStorageRequests\":" + activeStorageRequests.ToString() + ",\"longOperationActive\":" + (longOperationActive ? "true" : "false") + ",\"activeOperation\":\"" + Json(activeOperation) + "\"}";
        }
    }

    internal static TimeSpan ForcedShutdownLimit(string reason)
    {
        return String.Equals(reason, "idle", StringComparison.Ordinal) ? TimeSpan.FromMinutes(3) : TimeSpan.FromMinutes(2);
    }

    internal static bool ShutdownShouldExit(string reason, TimeSpan waiting, bool operationBusy, bool backupClean, bool finalizationComplete, bool ready)
    {
        bool graceful = !operationBusy && backupClean && finalizationComplete && (ready || (reason == "operator-exit" && waiting >= TimeSpan.FromSeconds(2)) || ((reason == "browser-closed" || reason == "operator-logoff") && waiting >= TimeSpan.FromSeconds(12)) || (reason == "idle" && waiting >= TimeSpan.FromSeconds(30)));
        return graceful || waiting >= ForcedShutdownLimit(reason);
    }

    private void EvaluateLifecycle()
    {
        bool storageBusy;
        lock (lifecycleGate)
        {
            if (longOperationActive && DateTime.UtcNow - lastLongOperationHeartbeatUtc >= TimeSpan.FromMinutes(5)) longOperationActive = false;
            storageBusy = activeStorageRequests > 0 || longOperationActive;
        }
        if (!storageBusy) storage.ExpireLeases(TimeSpan.FromMinutes(3));
        bool shouldExit = false, finalize = false;
        lock (lifecycleGate)
        {
            DateTime now = DateTime.UtcNow;
            bool operationBusy = activeStorageRequests > 0 || longOperationActive;
            if (operationBusy)
            {
                lastPresenceUtc = now;
                lastActivityUtc = now;
            }
            if (!operationBusy && !shutdownRequestedUtc.HasValue && now - lastPresenceUtc >= TimeSpan.FromSeconds(90))
            {
                shutdownRequestedUtc = now;
                shutdownReason = "browser-closed";
                shutdownReady = false;
                finalize = true;
            }
            else if (!operationBusy && !shutdownRequestedUtc.HasValue && now - lastActivityUtc >= TimeSpan.FromMinutes(60))
            {
                shutdownRequestedUtc = now;
                shutdownReason = "idle";
                shutdownReady = false;
                finalize = true;
            }
            if (shutdownRequestedUtc.HasValue)
            {
                TimeSpan waiting = now - shutdownRequestedUtc.Value;
                if (!operationBusy && !shutdownFinalizationActive && !shutdownFinalizationComplete && shutdownFinalizationAttempts < 2) finalize = true;
                // Local-first state and atomic shared writes make a bounded forced exit
                // safer than leaving an orphaned tray process forever. Any unfinished
                // publication remains recoverable from the protected local workspace.
                shouldExit = ShutdownShouldExit(shutdownReason, waiting, operationBusy, backupClean, shutdownFinalizationComplete, shutdownReady);
            }
        }
        if (finalize) StartBackupFinalization();
        if (shouldExit) ExitThread();
    }

    private static async Task Respond(NetworkStream stream, int status, string type, byte[] body, bool head, string cache, string contentEncoding = null)
    {
        string reason = status == 200 ? "OK" : status == 400 ? "Bad Request" : status == 401 ? "Unauthorized" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : status == 409 ? "Conflict" : status == 413 ? "Payload Too Large" : status == 503 ? "Service Unavailable" : "Method Not Allowed";
        string encodingHeader = String.IsNullOrEmpty(contentEncoding) ? "" : "Content-Encoding: " + contentEncoding + "\r\n";
        string headers = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length + "\r\n" + encodingHeader + "Cache-Control: " + cache + "\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nX-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Resource-Policy: same-origin\r\nPermissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'\r\nConnection: close\r\n\r\n";
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
        result.Add("/favicon.ico", new WebAsset { Bytes = LoadResource("Tracker.Favicon"), ContentType = "image/x-icon" });
        result.Add("/raptor-icon.png", new WebAsset { Bytes = LoadResource("Tracker.BrandLogo"), ContentType = "image/png" });
        if (result.Count == 0) throw new InvalidDataException("The embedded asset manifest contains no browser assets.");
        return result;
    }
    protected override void ExitThreadCore()
    {
        if (Interlocked.Exchange(ref exitStarted, 1) != 0) return;
        // A final watchdog prevents the tray process from being stranded during shutdown.
        Task.Run(delegate { Thread.Sleep(8000);Environment.Exit(0); });
        try { lifecycleTimer.Stop(); lifecycleTimer.Dispose(); } catch { }
        try { stop.Cancel(); listener.Stop(); } catch { }
        try { tray.Visible = false; tray.Dispose(); } catch { }
        try { dispatcher.Dispose(); } catch { }
        bool cleanupSafe;
        lock (lifecycleGate) cleanupSafe = !shutdownFinalizationActive && activeStorageRequests == 0;
        if (cleanupSafe)
        {
            try { Task.Run(delegate { storage.Dispose(false); }).Wait(5000); } catch { }
        }
        try { base.ExitThreadCore(); }
        finally { Environment.Exit(0); }
    }
}

internal static class Program
{
    internal static void WriteLocalError(string context, Exception error)
    {
        try
        {
            string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RAPTOR", "System", "Error Reports"), path = Path.Combine(directory, "error-report-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".txt");Directory.CreateDirectory(directory);
            string detail = error == null ? "The launcher failed without an exception detail." : error.ToString().Replace("\0", " ");if (detail.Length > 64 * 1024) detail = detail.Substring(0, 64 * 1024);
            File.AppendAllText(path, "R.A.P.T.O.R. Error Entry\r\nGeneration Time UTC: " + DateTime.UtcNow.ToString("o") + "\r\nContext: " + context.Replace("\r", " ").Replace("\n", " ") + ".\r\nDetails: " + detail + "\r\n\r\n", Encoding.UTF8);
        }
        catch { }
    }
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        try { Application.Run(new TrackerContext()); }
        catch (SocketException) { MessageBox.Show("R.A.P.T.O.R. is already running.", "R.A.P.T.O.R.", MessageBoxButtons.OK, MessageBoxIcon.Information); }
        catch (Exception ex) { WriteLocalError("Windows launcher startup failure", ex);MessageBox.Show(ex.Message, "Unable to Start R.A.P.T.O.R.", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
}
