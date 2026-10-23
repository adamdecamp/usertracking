using System;
using System.Globalization;
using System.IO;

internal sealed partial class PortableStorage
{
    internal const string CurrentApplicationVersion = "1.3.19";

    internal static bool ValidApplicationVersion(string value)
    {
        Version parsed;return Version.TryParse(value, out parsed) && parsed.Major >= 0 && parsed.Minor >= 0 && parsed.Build >= 0;
    }

    internal static int CompareApplicationVersions(string left, string right)
    {
        Version first, second;
        if (!Version.TryParse(left, out first) || !Version.TryParse(right, out second)) throw new InvalidDataException("The database client-version policy is invalid.");
        return first.CompareTo(second);
    }
}
