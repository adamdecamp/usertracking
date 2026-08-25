using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed class TrackerContext : ApplicationContext
{
    private const int Port = 38473;
    private readonly string user;
    private readonly byte[] indexHtml;
    private readonly byte[] scriptGzip;
    private readonly byte[] styleGzip;
    private readonly string scriptPath;
    private readonly string stylePath;
    private readonly TcpListener listener;
    private readonly CancellationTokenSource stop = new CancellationTokenSource();
    private readonly SemaphoreSlim connections = new SemaphoreSlim(16, 16);
    private readonly NotifyIcon tray;

    public TrackerContext()
    {
        indexHtml = LoadResource("Tracker.Index");
        scriptGzip = LoadResource("Tracker.ScriptGzip");
        styleGzip = LoadResource("Tracker.StyleGzip");
        string markup = Encoding.UTF8.GetString(indexHtml);
        scriptPath = FindAssetPath(markup, "src=\"");
        stylePath = FindAssetPath(markup, "href=\"");
        user = WindowsIdentity.GetCurrent().Name;
        listener = new TcpListener(IPAddress.Loopback, Port);
        listener.Start();
        tray = new NotifyIcon { Icon = SystemIcons.Shield, Text = "Information System User Tracker", Visible = true };
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Tracker", null, delegate { OpenTracker(); });
        menu.Items.Add("Exit", null, delegate { ExitThread(); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { OpenTracker(); };
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
        using (var reader = new StreamReader(stream, Encoding.ASCII, false, 4096, true))
        {
            client.ReceiveTimeout = 5000; client.SendTimeout = 5000;
            string request = await reader.ReadLineAsync();
            if (String.IsNullOrEmpty(request)) return;
            if (request.Length > 8192) { await Respond(stream, 400, "text/plain", Encoding.UTF8.GetBytes("Bad Request"), false, "no-store"); return; }
            string[] parts = request.Split(' ');
            if (parts.Length < 2 || (parts[0] != "GET" && parts[0] != "HEAD")) { await Respond(stream, 405, "text/plain", Encoding.UTF8.GetBytes("Method Not Allowed"), false, "no-store"); return; }
            string host = null;
            for (int i = 0; i < 100; i++) { string line = await reader.ReadLineAsync(); if (String.IsNullOrEmpty(line)) break; if (line.Length > 8192) return; if (line.StartsWith("Host:", StringComparison.OrdinalIgnoreCase)) host = line.Substring(5).Trim(); }
            if (!String.Equals(host, "localhost:" + Port, StringComparison.OrdinalIgnoreCase) && !String.Equals(host, "127.0.0.1:" + Port, StringComparison.OrdinalIgnoreCase)) { await Respond(stream, 403, "text/plain", Encoding.UTF8.GetBytes("Forbidden"), parts[0] == "HEAD", "no-store"); return; }
            string path = null;
            try { path = Uri.UnescapeDataString(parts[1].Split('?')[0]); }
            catch (UriFormatException) { }
            if (path == null) { await Respond(stream, 400, "text/plain", Encoding.UTF8.GetBytes("Bad Request"), parts[0] == "HEAD", "no-store"); return; }
            if (path == "/api/session-user") { string json = "{\"user\":\"" + Json(user) + "\"}"; await Respond(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json), parts[0] == "HEAD", "no-store"); return; }
            if (path == scriptPath) { await Respond(stream, 200, "text/javascript; charset=utf-8", scriptGzip, parts[0] == "HEAD", "public, max-age=31536000, immutable", "gzip"); return; }
            if (path == stylePath) { await Respond(stream, 200, "text/css; charset=utf-8", styleGzip, parts[0] == "HEAD", "public, max-age=31536000, immutable", "gzip"); return; }
            if (path == "/" || path == "/index.html" || !Path.HasExtension(path)) { await Respond(stream, 200, "text/html; charset=utf-8", indexHtml, parts[0] == "HEAD", "no-cache"); return; }
            await Respond(stream, 404, "text/plain", Encoding.UTF8.GetBytes("Not Found"), parts[0] == "HEAD", "no-store");
        }
    }

    private static async Task Respond(NetworkStream stream, int status, string type, byte[] body, bool head, string cache, string contentEncoding = null)
    {
        string reason = status == 200 ? "OK" : status == 400 ? "Bad Request" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : "Method Not Allowed";
        string encodingHeader = String.IsNullOrEmpty(contentEncoding) ? "" : "Content-Encoding: " + contentEncoding + "\r\n";
        string headers = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length + "\r\n" + encodingHeader + "Cache-Control: " + cache + "\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nX-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Resource-Policy: same-origin\r\nPermissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'\r\nConnection: close\r\n\r\n";
        byte[] headerBytes = Encoding.ASCII.GetBytes(headers); await stream.WriteAsync(headerBytes, 0, headerBytes.Length); if (!head) await stream.WriteAsync(body, 0, body.Length);
    }

    private static string Json(string value) { return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", ""); }
    private static byte[] LoadResource(string name) { using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) { if (stream == null) throw new InvalidDataException("Embedded application resource is missing: " + name); using (var memory = new MemoryStream()) { stream.CopyTo(memory); return memory.ToArray(); } } }
    private static string FindAssetPath(string markup, string attribute) { int start = markup.IndexOf(attribute + "/assets/", StringComparison.Ordinal); if (start < 0) throw new InvalidDataException("Embedded application asset reference is missing."); start += attribute.Length; int end = markup.IndexOf('"', start); if (end < 0) throw new InvalidDataException("Embedded application asset reference is invalid."); return markup.Substring(start, end - start); }
    protected override void ExitThreadCore() { stop.Cancel(); listener.Stop(); tray.Visible = false; tray.Dispose(); base.ExitThreadCore(); }
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

