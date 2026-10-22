using System;

/// <summary>
/// Pure authorization, serialization, and request-size policy for the
/// loopback launcher. Keeping this policy out of the HTTP router makes every
/// endpoint rule directly testable and prevents route handlers from drifting.
/// </summary>
internal static class LauncherPolicy
{
    private const long KiB = 1024L;
    private const long MiB = 1024L * KiB;

    internal static bool StorageActionRequiresSerialization(string action)
    {
        action = action ?? "";
        return !String.Equals(action, "error-report", StringComparison.Ordinal)
            && !String.Equals(action, "workspace-status", StringComparison.Ordinal)
            && !String.Equals(action, "evidence-status", StringComparison.Ordinal)
            && !String.Equals(action, "evidence-pdf-status", StringComparison.Ordinal)
            && !String.Equals(action, "evidence-exists", StringComparison.Ordinal)
            && !String.Equals(action, "outlook-draft", StringComparison.Ordinal)
            && !String.Equals(action, "file-location", StringComparison.Ordinal)
            && !String.Equals(action, "performance", StringComparison.Ordinal)
            && !String.Equals(action, "diagnostics", StringComparison.Ordinal)
            && !String.Equals(action, "sync-job", StringComparison.Ordinal)
            && !String.Equals(action, "operation-status", StringComparison.Ordinal)
            // Acquisition and renewal must remain available while a long operation
            // owns the per-system queue. Release is different: it must enter that
            // queue so the Windows exclusive lock cannot be dropped while an
            // already-authorized file mutation is still running.
            && (!action.StartsWith("lease-", StringComparison.Ordinal)
                || String.Equals(action, "lease-release", StringComparison.Ordinal));
    }

    internal static bool StorageActionRequiresLease(string action, string method)
    {
        action = action ?? "";
        if (action.StartsWith("lease-", StringComparison.Ordinal)) return false;
        if (String.Equals(action, "select", StringComparison.Ordinal) || String.Equals(action, "select-readonly", StringComparison.Ordinal) || String.Equals(action, "forget", StringComparison.Ordinal)) return false;
        if (String.Equals(action, "error-report", StringComparison.Ordinal) || String.Equals(action, "audit", StringComparison.Ordinal) || String.Equals(action, "audit-batch", StringComparison.Ordinal)) return false;
        return !ReadOnlyStorageActionAllowed(action, method);
    }

    internal static int StorageQueueWaitMilliseconds(string action, string method)
    {
        if (!StorageActionRequiresSerialization(action)) return 0;
        return String.Equals(method, "GET", StringComparison.Ordinal) || String.Equals(method, "HEAD", StringComparison.Ordinal) ? 30000 : 120000;
    }

    internal static bool ReadOnlyStorageActionAllowed(string action, string method)
    {
        action = action ?? "";method = method ?? "";
        if (String.Equals(action, "select-readonly", StringComparison.Ordinal) && String.Equals(method, "POST", StringComparison.Ordinal)) return true;
        if (String.Equals(action, "error-report", StringComparison.Ordinal) && String.Equals(method, "POST", StringComparison.Ordinal)) return true;
        if ((String.Equals(action, "audit", StringComparison.Ordinal) || String.Equals(action, "audit-batch", StringComparison.Ordinal)) && String.Equals(method, "POST", StringComparison.Ordinal)) return true;
        if (!String.Equals(method, "GET", StringComparison.Ordinal) && !String.Equals(method, "HEAD", StringComparison.Ordinal)) return false;
        return String.Equals(action, "local-manifest", StringComparison.Ordinal)
            || String.Equals(action, "manifest", StringComparison.Ordinal)
            || String.Equals(action, "file", StringComparison.Ordinal)
            || String.Equals(action, "audit-verify", StringComparison.Ordinal)
            || String.Equals(action, "audit-view", StringComparison.Ordinal)
            || String.Equals(action, "performance", StringComparison.Ordinal)
            || String.Equals(action, "sync-job", StringComparison.Ordinal)
            || String.Equals(action, "operation-status", StringComparison.Ordinal)
            || String.Equals(action, "diagnostics", StringComparison.Ordinal)
            || String.Equals(action, "organizations", StringComparison.Ordinal)
            || String.Equals(action, "evidence-status", StringComparison.Ordinal)
            || String.Equals(action, "evidence-pdf-status", StringComparison.Ordinal)
            || String.Equals(action, "evidence-exists", StringComparison.Ordinal)
            || String.Equals(action, "archive-locations", StringComparison.Ordinal);
    }

    internal static long RequestBodyLimit(string path, string method)
    {
        if (!String.Equals(method, "POST", StringComparison.Ordinal) && !String.Equals(method, "DELETE", StringComparison.Ordinal)) return 0;
        if (String.IsNullOrWhiteSpace(path) || !path.StartsWith("/api/storage/", StringComparison.Ordinal)) return 0;
        string tail = path.Substring("/api/storage/".Length);int separator = tail.IndexOf('/');string action = separator >= 0 ? tail.Substring(separator + 1) : "";
        int query = action.IndexOf('?');if (query >= 0) action = action.Substring(0, query);
        if (action == "evidence" || action == "evidence-pdf") return 110L * MiB;
        if (action == "state-commit" || action == "workspace-publish") return 100L * MiB;
        if (action == "workspace-status") return 4L * KiB;
        if (action == "sync-job") return 64L * KiB;
        if (action == "manifest" || action == "csv" || action == "report") return 50L * MiB;
        if (action == "outlook-draft") return 40L * MiB;
        if (action == "renamer-queue") return 20L * MiB;
        if (action == "restore-active") return 10L * MiB;
        if (action == "audit-batch") return 5L * MiB;
        if (action == "error-report") return 1L * MiB;
        if (action == "audit") return 8L * KiB;
        return 0;
    }
}
