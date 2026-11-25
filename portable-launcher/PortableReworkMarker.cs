using System;
using System.IO;

/// <summary>
/// Evidence that needs correction stays in its organization folder with
/// "REWORK_" at the start of its filename instead of moving to a Rework
/// folder. Sync rechecks marked files and drops the marker once the file
/// passes every storage rule. Existing "&lt;ORG&gt; Rework" folders are left
/// untouched for operators to handle by hand and are no longer scanned.
/// </summary>
internal sealed partial class PortableStorage
{
    internal const string ReworkMarker = "REWORK_";
    private const int ReworkFilenameLimit = 180;

    internal static bool HasReworkMarker(string filename)
    {
        string name = Path.GetFileName(filename ?? "").TrimStart();
        return name.Length > ReworkMarker.Length && (name.StartsWith("REWORK_", StringComparison.OrdinalIgnoreCase) || name.StartsWith("REWORK ", StringComparison.OrdinalIgnoreCase) || name.StartsWith("REWORK-", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Adds the marker once, shortening the stem so the name stays within the filename limit.</summary>
    internal static string WithReworkMarker(string filename)
    {
        string name = SafePart(Path.GetFileName(filename ?? ""), ReworkFilenameLimit);
        if (HasReworkMarker(name)) return name;
        string extension = name.EndsWith(".pdf.zip", StringComparison.OrdinalIgnoreCase) ? name.Substring(name.Length - 8) : Path.GetExtension(name), stem = name.Substring(0, name.Length - extension.Length);
        int room = ReworkFilenameLimit - ReworkMarker.Length - extension.Length;
        if (stem.Length > room) stem = stem.Substring(0, Math.Max(1, room));
        return ReworkMarker + stem + extension;
    }

    /// <summary>A REWORK-marked file that is not inside a managed folder such as Archive, Complete, or a legacy Rework folder.</summary>
    private static bool IsReworkMarkedEvidencePath(string relative)
    {
        string[] parts = (relative ?? "").Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0 || !HasReworkMarker(parts[parts.Length - 1])) return false;
        for (int index = 0; index < parts.Length - 1; index++) if (IsManagedStorageDirectory(parts[index]) || IsCompleteStorageDirectory(parts[index])) return false;
        return true;
    }
}
