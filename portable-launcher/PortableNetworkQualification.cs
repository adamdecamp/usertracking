using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

internal sealed partial class PortableStorage
{
    public string RunNetworkQualification(string systemId)
    {
        lock (RootLock(systemId))
        {
            string root = Root(systemId), directory = Path.Combine(root, SystemDirectoryName, "Storage Transactions", "Network Qualification"), token = Guid.NewGuid().ToString("N"), first = Path.Combine(directory, ".raptor-probe-" + token + ".tmp"), renamed = first + ".renamed";Directory.CreateDirectory(directory);
            byte[] payload = new byte[64 * 1024];using (var random = RandomNumberGenerator.Create()) random.GetBytes(payload);
            long writeMs = 0, readMs = 0, renameMs = 0, lockMs = 0, enumerateMs = 0;string expected = Sha256Bytes(payload);
            try
            {
                var timer = Stopwatch.StartNew();AtomicWrite(first, payload);timer.Stop();writeMs = timer.ElapsedMilliseconds;
                timer.Restart();byte[] read = ReadAllBytesWithRetry(first, payload.LongLength + 1);timer.Stop();readMs = timer.ElapsedMilliseconds;if (!String.Equals(expected, Sha256Bytes(read), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The network qualification read-back SHA-256 did not match.");
                timer.Restart();File.Move(first, renamed);timer.Stop();renameMs = timer.ElapsedMilliseconds;
                timer.Restart();using (var exclusive = OpenCompatibleFileStream(renamed, FileMode.Open, FileAccess.ReadWrite, FileShare.None, 4096)) { if (exclusive.Length != payload.Length) throw new InvalidDataException("The network qualification exclusive-lock file length changed."); }timer.Stop();lockMs = timer.ElapsedMilliseconds;
                timer.Restart();int count = 0;foreach (string ignored in Directory.EnumerateFileSystemEntries(root)) { count++;if (count > 100000) break; }timer.Stop();enumerateMs = timer.ElapsedMilliseconds;
                long total = writeMs + readMs + renameMs + lockMs + enumerateMs;string rating = total <= 1500 ? "Ready" : total <= 5000 ? "Usable With Local-First Workspace" : "High Latency";
                return json.Serialize(new Dictionary<string, object> { { "generatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "rating", rating }, { "networkRoot", IsNetworkRoot(root) }, { "writeMs", writeMs }, { "readVerifyMs", readMs }, { "renameMs", renameMs }, { "exclusiveLockMs", lockMs }, { "enumerateMs", enumerateMs }, { "totalMs", total }, { "payloadBytes", payload.Length }, { "sha256Verified", true }, { "recommendation", rating == "Ready" ? "The mapped folder passed the bounded write, read, rename, lock, and metadata tests." : "Keep routine work in the protected local workspace and publish only verified session changes. Ask IT to review VPN, DFS, SMB, or endpoint inspection latency if delays persist." } });
            }
            finally { TryDelete(first);TryDelete(renamed); }
        }
    }
}
