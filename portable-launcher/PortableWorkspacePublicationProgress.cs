using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

internal sealed partial class PortableStorage
{
    private void WritePublicationJournal(string workspaceRoot, string phase, string baseSharedSha256, string targetStateHash, List<PublicationEvidence> staged, int completedCopies)
    {
        if (String.Equals(phase, "evidence-copy", StringComparison.Ordinal) || String.Equals(phase, "evidence-verified", StringComparison.Ordinal))
        {
            AppendPublicationProgress(workspaceRoot, phase, targetStateHash, completedCopies);WriteLivePublicationProgress(workspaceRoot, phase, targetStateHash, staged, completedCopies, completedCopies > 0 && completedCopies <= staged.Count ? Path.GetFileName(staged[completedCopies - 1].Relative) : null);
            return;
        }
        var items = staged.Select(item => (object)new Dictionary<string, object> { { "operationKey", item.OperationKey ?? Sha256("publish-file-v1\n" + item.Relative.ToUpperInvariant() + "\n" + item.SourceSha256.ToLowerInvariant() + "\n" + item.PdfSha256.ToLowerInvariant()) }, { "source", Relative(workspaceRoot, item.Source).Replace(Path.DirectorySeparatorChar, '/') }, { "destination", item.Relative }, { "sha256", item.Sha256 }, { "sourceSha256", item.SourceSha256 }, { "pdfSha256", item.PdfSha256 } }).ToArray();
        var journal = new Dictionary<string, object> { { "version", LocalWorkspacePublicationVersion }, { "updatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "phase", phase }, { "baseSharedSha256", baseSharedSha256 }, { "targetStateHash", targetStateHash }, { "completedCopies", completedCopies }, { "items", items } };
        WriteProtectedLocalJson(LocalWorkspacePublicationPath(workspaceRoot), "workspace-publication", json.Serialize(journal));WriteLivePublicationProgress(workspaceRoot, phase, targetStateHash, staged, completedCopies, null);
        if (String.Equals(phase, "prepared", StringComparison.Ordinal) || String.Equals(phase, "manifest-committed", StringComparison.Ordinal)) TryDelete(LocalWorkspacePublicationProgressPath(workspaceRoot));
    }

    private void AppendPublicationProgress(string workspaceRoot, string phase, string targetStateHash, int completedCopies)
    {
        var progress = new Dictionary<string, object> { { "version", LocalWorkspacePublicationVersion }, { "updatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "phase", phase }, { "targetStateHash", targetStateHash }, { "completedCopies", completedCopies } };
        byte[] clear = Encoding.UTF8.GetBytes(json.Serialize(progress)), protectedBytes = ProtectedData.Protect(clear, LocalWorkspaceEntropy("workspace-publication-progress"), DataProtectionScope.CurrentUser), line = Encoding.ASCII.GetBytes(Convert.ToBase64String(protectedBytes) + Environment.NewLine);
        string path = LocalWorkspacePublicationProgressPath(workspaceRoot);var info = new FileInfo(path);if (info.Exists && info.Length + line.LongLength > JournalLimit) throw new InvalidDataException("The local publication progress journal exceeds its safety limit.");
        using (var stream = OpenCompatibleFileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, Math.Max(4096, Math.Min(line.Length, 65536)))) { stream.Write(line, 0, line.Length);FlushCompatible(stream); }
    }

    private void WriteLivePublicationProgress(string workspaceRoot, string phase, string targetStateHash, List<PublicationEvidence> staged, int completedCopies, string filename)
    {
        var progress = new Dictionary<string, object> { { "version", LocalWorkspacePublicationVersion }, { "updatedAtUtc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) }, { "phase", phase }, { "targetStateHash", targetStateHash }, { "processed", Math.Max(0, completedCopies) }, { "total", staged == null ? 0 : staged.Count }, { "filename", filename ?? "" } };
        WriteProtectedLocalJson(LocalWorkspaceSystemPath(workspaceRoot, LocalWorkspacePublicationLiveFilename), "workspace-publication-live", json.Serialize(progress));
    }

    public string ReadWorkspacePublicationProgress(string systemId)
    {
        string path = LocalWorkspaceSystemPath(LocalWorkspaceRoot(systemId), LocalWorkspacePublicationLiveFilename);
        if (!File.Exists(path)) return "{\"active\":false,\"phase\":\"idle\",\"processed\":0,\"total\":0,\"filename\":\"\"}";
        try
        {
            Dictionary<string, object> progress = ObjectDictionary(json.DeserializeObject(ReadProtectedLocalJson(path, "workspace-publication-live", 64 * 1024)));int version = Convert.ToInt32(progress["version"], CultureInfo.InvariantCulture), processed = Convert.ToInt32(progress["processed"], CultureInfo.InvariantCulture), total = Convert.ToInt32(progress["total"], CultureInfo.InvariantCulture);string phase = CleanLine(Convert.ToString(progress["phase"], CultureInfo.InvariantCulture), 100), filename = CleanLine(Convert.ToString(progress["filename"], CultureInfo.InvariantCulture), 500), updatedAtUtc = Convert.ToString(progress["updatedAtUtc"], CultureInfo.InvariantCulture);
            if (version != LocalWorkspacePublicationVersion || processed < 0 || total < 0 || processed > total || String.IsNullOrWhiteSpace(phase)) throw new InvalidDataException("The Session Commit progress record is invalid.");
            return json.Serialize(new Dictionary<string, object> { { "active", true }, { "phase", phase }, { "processed", processed }, { "total", total }, { "filename", filename }, { "updatedAtUtc", updatedAtUtc } });
        }
        catch (FileNotFoundException) { return "{\"active\":false,\"phase\":\"idle\",\"processed\":0,\"total\":0,\"filename\":\"\"}"; }
    }

    private static void DeletePublicationJournal(string workspaceRoot)
    {
        TryDelete(LocalWorkspacePublicationPath(workspaceRoot));TryDelete(LocalWorkspacePublicationProgressPath(workspaceRoot));TryDelete(LocalWorkspaceSystemPath(workspaceRoot, LocalWorkspacePublicationLiveFilename));
    }
}
