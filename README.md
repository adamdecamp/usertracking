# Information System User Tracker

A lightweight Windows administrative tool for tracking information-system users, access roles, training requirements, and supporting evidence. The portable application runs locally, opens its interface in the default browser, and stores records and evidence only in a user-selected shared directory.

## Download

Use the executable attached to the latest GitHub Release. Every release also includes a one-page executive capability summary. Public releases are blocked unless the Windows executable has a valid Microsoft-backed Authenticode signature. Verify the signature from **Properties → Digital Signatures** and compare the executable and PDF SHA-256 values with `SHA256SUMS.txt` before use.

## Security model

- Binds only to the local loopback interface.
- Records the active Windows account in consequential audit entries.
- Does not transmit tracker data or evidence to an external service.
- Uses a native Windows folder selector; the local launcher owns atomic manifest, backup, evidence, audit, and lease writes instead of relying on browser lifecycle events.
- Supports mapped drive letters and UNC network-share folders, probes create/write/read/delete compatibility before saving a mapping, retries brief SMB write/lock failures, uses broadly compatible buffered file operations, and SHA-256 verifies replacements. Sync avoids metadata calls for irrelevant file types, isolates unreadable evidence as reviewable file errors, and retries directory enumeration with a legacy-compatible search pattern when a provider rejects the normal one. Failed replacement attempts preserve or restore the previous verified file and return operation- and folder-specific diagnostics.
- Holds an exclusive Windows file lock while a system folder is active, preventing a second launcher from acquiring write access on lock-capable SMB/Windows shares.
- Starts every release with no systems or users and does not retain operational records in browser storage.
- Creates a top-level `Organizations` folder in every mapped system. Operators add organization folders through **Manage Organizations**; reserved document folders such as `SAAR` cannot be mistaken for organizations.
- Validates shared manifests, filenames, request paths, and CSV output.
- Accepts only readable PDF evidence or a ZIP containing exactly one readable PDF, with archive path, size, entry-count, encryption, and expansion-ratio safeguards.
- Uses a checksum-protected Sync index in each mapped system folder to skip reopening unchanged evidence. New, changed, moved, or deleted files are still detected, rule-set changes invalidate the index, and Full Rescan bypasses it.
- Provides read-only PDF preview with the mapped path, embedded PDF filename, filename date, current SHA-256, and recorded ingestion provenance. New manual uploads retain a baseline hash so Reconciliation can detect content changes under an unchanged filename.
- Includes a read-only Reconciliation Center for missing referenced files, changed content, orphan evidence, duplicate identities or emails, organization conflicts, and rejected evidence.
- Uses filenames as the primary identity and organization source, with a fillable-form fallback for standard DD Form 2875 XFA packets and the derived SAAR AcroForm. Scanned or flattened SAAR copies cannot create users automatically.
- Recognizes common valid filename date formats and atomically normalizes nonstandard dates to `DDMMMYYYY` before matching.
- Includes a review-first Document Renamer that reads local PDF text and standard SAAR form fields, matches existing users, and uses each PDF's immediate containing-folder name as the authoritative organization in the proposed canonical filename. Root-level PDFs use the system organization. The original PDF can be previewed, and an unchanged SHA-256 is verified after every approved rename. Image-only scans remain available for manual entry and are never guessed.
- Sync only identifies duplicate, superseded, and loose PDF evidence. The operator-controlled Clean Up workflow can move selected old files into `Archive Review` or compress selected loose PDFs in place; a source PDF is deleted only after its ZIP is created and validated.
- Generates daily tamper-evident audit logs with ISO 8601 UTC timestamps, a continuous sequence, and a SHA-256 hash chain. Storage verification fails if an entry is changed, removed, reordered, or inserted.
- Shows bounded diagnostic details for operational failures, creates a Notepad-readable text report in the mapped system's top-level `Error Reports` folder, and writes an `ERROR:` entry to the affected audit log when that chain is healthy. Error reporting itself has a short safety limit so it cannot hide the original failure.
- Groups tracker-owned support folders beneath top-level `System` (`Audit Logs`, `backup`, `Reports`, `Sync Journals`, `Storage Transactions`, and `Archive Review`) and migrates compatible legacy top-level copies when a system folder is mapped. New organization evidence is stored beneath top-level `Organizations`; its Rework, Archive, Superseded, and permanent SAAR Archive folders remain with that organization.
- Gives ordinary launcher requests and every file-changing Clean Up or Document Renamer action a bounded watchdog. Resumable scans receive a larger bounded window, later queued file operations fail promptly behind a stalled storage operation, and batch actions continue to a consolidated error review when an individual file fails. Lease renewal uses a separate path and automatic background saves pause during Sync, so valid long-running work cannot falsely disconnect the active operator.
- Generates filtered Compliance Snapshot PDF reports, stores a checksum-protected copy in each selected system's `System/Reports` folder, and records the report identifier and SHA-256 in the audit chain.
- Tracks time-limited compliance exceptions without changing the underlying Missing or Overdue status. Approvals and revocations require named approvers and justifications and are written to the audit chain.
- Splits Outlook notification recipients into safe-size BCC batches, excludes active exceptions, and records a separate audit entry for every draft batch opened.
- Keeps the newest 30 full-fidelity JSON snapshots with matching SHA-256 files and provides verified in-app restoration without deleting evidence files.
- Shows Last saved, Last backup, and Last Sync health for each mapped system, with an on-demand backup verification control.
- Suspends both browser-session and Windows-launcher idle expiration during Sync, then restarts the idle clocks only after Sync completes, fails, or is stopped.
- Refreshes the daily backup before automatically shutting down after 60 minutes of inactivity or when the portable app's browser window closes.

This is an administrative evidence and tracking tool. It may support an organization's NIST SP 800-53 assessment activities, but it does not implement technical access controls on a tracked information system and does not independently establish compliance.

## Development

Requirements: Node.js 22.13 or later, pnpm 10.14, and Windows for the standalone executable.

```powershell
pnpm install --frozen-lockfile
pnpm build
.\scripts\build-portable.ps1
.\scripts\Test-ReleaseClean.ps1
```

Every browser and portable build first runs TypeScript and lint checks, the complete regression suite, deterministic filename/PDF/ZIP/audit fuzz tests, and the Windows launcher storage integration suite. A failed check stops the build. The standalone executable and checksum are written to `release/`. Both GitHub build workflows stop before publishing if starter records, tracked runtime data, extra package files, or a checksum mismatch are detected.

## Public release setup

The signed release workflow uses Microsoft Azure Artifact Signing with GitHub's OpenID Connect authentication. Configure the `release` environment with these values:

Secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

Variables:

- `AZURE_ARTIFACT_SIGNING_ENDPOINT`
- `AZURE_ARTIFACT_SIGNING_ACCOUNT`
- `AZURE_ARTIFACT_SIGNING_PROFILE`

After identity validation and role assignment are complete, pushing a version tag such as `v1.0.0` builds, scans, signs, verifies, checksums, and publishes the release.

Protect the `release` environment with required reviewers, restrict who can create `v*` tags, and enable private vulnerability reporting before the first public release.
