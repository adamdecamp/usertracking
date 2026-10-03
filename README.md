# R.A.P.T.O.R. — Role-Based Access Personnel Tracking & Oversight Registry

<img src="public/raptor-icon.png" alt="R.A.P.T.O.R. raptor claw and verified document mark" width="96" height="96">

R.A.P.T.O.R. is a portable Windows administrative evidence tracker for information-system users, access documentation, training, and inspection readiness.

A lightweight Windows administrative tool for tracking information-system users, access roles, training requirements, and supporting evidence. The portable application runs locally, opens its interface in the default browser, and stores records and evidence only in a user-selected shared directory.

## Download

Use the executable attached to the latest GitHub Release. Every release also includes a one-page executive capability summary. Public releases are blocked unless the Windows executable has a valid Microsoft-backed Authenticode signature. Verify the signature from **Properties → Digital Signatures** and compare the executable and PDF SHA-256 values with `SHA256SUMS.txt` before use.

## Security model

- Binds only to the local loopback interface.
- Records the active Windows account in consequential audit entries.
- Does not transmit tracker data or evidence to an external service.
- Uses the modern Windows Explorer folder picker in the foreground; the local launcher owns atomic manifest, backup, evidence, audit, and lease writes instead of relying on browser lifecycle events.
- Protects the live database manifest with a SHA-256 sidecar written and recovered in the same transaction as the manifest. Full Access verifies that checksum, the newest backup, and the complete audit chain before editing is enabled; a failure preserves the records and falls back to Read-Only Access.
- Prompts at launch for **Read-Only Access** or **Full Access**. Multiple Read-Only sessions can search, filter, inspect user status, preview evidence, and view the audit log without taking the editor lock; launcher-side request enforcement rejects shared-folder mutations. Read-Only sessions time out after 15 minutes of inactivity, and their start, reconnect, system-switch, timeout, and logoff events are recorded with the active Windows identity.
- Exports one-organization, SHA-256 integrity-checked `.raptor-status.json` snapshots for ISSO distribution. Each snapshot includes active and disabled users but excludes evidence documents, shared paths, audit logs, and every other organization. The same portable executable opens the attachment offline in enforced Read-Only mode, and Full Access can create an Outlook draft with the ISSO in the To line and the snapshot attached.
- Supports mapped drive letters and UNC network-share folders, probes create/write/read/delete compatibility before saving a mapping, and applies bounded exponential retries to folder availability, manifest reads, directory enumeration, and verified writes for laggy on-site or VPN SMB connections. Browser-to-launcher storage requests use longer network-aware time limits and up to two safe retries only for resumable or read-only operations. The launcher uses broadly compatible buffered file operations and SHA-256 verifies replacements. Sync avoids metadata calls for irrelevant file types, isolates unreadable evidence as reviewable file errors, and retries directory enumeration with native and Explorer-compatible fallbacks when a provider rejects the normal pattern. Failed replacement attempts preserve or restore the previous verified file and return operation- and folder-specific diagnostics.
- Holds an exclusive Windows file lock only for Full Access while a system folder is active, preventing a second editor from acquiring write access on lock-capable SMB/Windows shares while allowing concurrent Read-Only viewers.
- Starts every release with no systems or users and does not retain operational records in browser storage.
- Creates a top-level `Organizations` folder in every mapped system. Operators add organization folders through **Manage Organizations**; reserved document folders such as `SAAR` cannot be mistaken for organizations.
- Lets Full Access operators edit each system's name, type, and organization or delete its app registration. Deletion is recoverable: the mapped folder, evidence, manifest, audit history, and backups are retained and can be mapped again.
- Validates shared manifests, filenames, request paths, and CSV output.
- Accepts only readable PDF evidence or a ZIP containing exactly one readable PDF, with archive path, size, entry-count, encryption, and expansion-ratio safeguards.
- Never starts Sync automatically on launch, folder mapping, or information-system selection. The Sync chooser defaults to **Daily Sync — Fast and Strict** and also offers an explicit **Legacy Import — Historical Recovery** mode. Either mode can scan the entire mapped system or exactly one immediate folder beneath `Organizations`; targeted organization Sync includes that organization's evidence tree but offers no document-type or deeper subfolder scope.
- Keeps the main **Sync** action available while earlier review or Clean Up results are pending. A later successful full or targeted Sync replaces those results with a fresh review; a stopped or failed scan preserves the earlier review.
- Uses a checksum-protected Sync index in each mapped system folder to skip reopening unchanged evidence. Daily Sync also reuses unchanged Rework validation and opens only new, changed, or moved evidence; Legacy Import deliberately revalidates Rework and enables historical recovery. The evidence-validation cache version is independent from ordinary application releases, unchanged evidence avoids per-file recovery-journal writes, and one full UTC-daily Archive preflight per selected scope is followed by changed-file and Rework checks. Archive preflight handles administrative SAAR archival, storage repair, archive compression, and invalid formats; it does not remove active evidence merely because it is overdue. New, changed, moved, or deleted files are still detected, evidence-validation changes invalidate the index, and the Sync window's Full Rescan option bypasses it for the selected system or organization. Current-location refresh, stale-reference retry, Reconciliation discovery, and inspection-inventory discovery read path/filename/size/modified metadata only; only relevant targets are opened afterward.
- Provides read-only PDF preview with the mapped path, embedded PDF filename, filename date, current SHA-256, and recorded ingestion provenance. New manual uploads retain a baseline hash so Reconciliation can detect content changes under an unchanged filename.
- Includes a read-only Reconciliation Center scoped to evidence already reflected in the User Directory database. It focuses on file collisions, changed content, duplicate identities or emails, conflicting Active/Disabled states, organization conflicts, and rejected recorded evidence while leaving Missing compliance requirements to normal reporting. Unrecorded files and every file in Archive or Rework are ignored. A completed run can generate a checksum-protected PDF correction report with every finding, affected path, and recommended action.
- Uses filenames as the primary identity and organization source, with a fillable-form fallback for standard DD Form 2875 XFA packets and the derived SAAR AcroForm. Scanned or flattened SAAR copies cannot create users automatically.
- Applies filename rules case-insensitively across identities, organization tags, artifact keywords, extensions, role markers, disabled markers, and month text while retaining the canonical output naming convention.
- Treats Privileged User Types as case-insensitive identifiers. Values such as `_DEV`, `_dev`, and `_Dev` are stored, filtered, grouped, and reported once as `_DEV`.
- In both modes, recognizes common valid filename date formats and atomically normalizes nonstandard dates to `DDMMMYYYY` before matching. Daily Sync performs safe filename-only corrections across in-scope evidence without reopening unchanged PDFs; Legacy Import adds the broader historical recovery pass.
- Runs the Document Renamer normalization engine automatically inside both Sync modes without exposing a separate main-page button. Daily Sync applies filename-only normalization to in-scope evidence and reads PDF content only for new, changed, or moved noncanonical files. Legacy Import also reads eligible unchanged historical candidates. The engine matches existing users and uses each PDF's immediate containing-folder name as the authoritative organization in the canonical filename. Root-level PDFs use the system organization. A complete valid filename date is reused without requiring a duplicate labeled PDF date. Legacy `Responsibilities` and non-DTA `Course` wording normalize to Privileged User Training; DTA `Course` or `Responsibilities` wording normalizes to DTA Training; and `Awareness` wording normalizes to DoD Cyber Cert. An unchanged SHA-256 is verified after every automatic rename. Ambiguous and image-only files remain available in Sync review or Rework and are never guessed.
- Automatically compresses every validated loose PDF that is being committed to a User Directory record. Other valid loose PDFs remain selectable in Clean Up. Rework and collision items are never auto-compressed, and a source PDF is deleted only after its one-PDF ZIP is created and validated.
- Enforces a fail-closed filename gate before document-type organization. Fault-tolerant input names are normalized first, but only a complete canonical `Last_First_(ORG)_Artifact_DDMMMYYYY` filename can enter SAAR, User Agreement, DoD Cyber Cert, 8140 Certification Memo, or training folders. Files that still fail any identity, organization, artifact, role, privileged-type, date, or extension rule are sent to the organization Rework review instead.
- Treats Active and Disabled as mutually exclusive account states and never automatically re-enables a disabled user. Official Email is the primary identity-deconfliction value after SAAR extraction; duplicate-email identities and Active/Disabled disagreements are blocked and surfaced for operator review.
- Provides a portable-launcher **Unarchive** workflow with a topmost Windows folder picker or multi-file ZIP picker, recursive discovery, 20-item paging, page/all selection, and per-file error continuation. ZIP evidence is extracted in place without overwrite and removed only after its single PDF and SHA-256 integrity are verified. ZIPs moved into Rework are likewise extracted so correction copies remain loose PDFs.
- Generates daily tamper-evident audit logs with ISO 8601 UTC timestamps, a continuous sequence, and a SHA-256 hash chain. Storage verification fails if an entry is changed, removed, reordered, or inserted.
- Shows bounded diagnostic details for operational failures, appends each entry to one UTC-daily Notepad-readable file in `System/Error Reports`, and writes an `ERROR:` entry to the affected audit log when that chain is healthy. The next UTC day starts a new error-report file. Error reporting itself has a short safety limit so it cannot hide the original failure.
- Groups tracker-owned support folders beneath top-level `System` (`Audit Logs`, `Error Reports`, `backup`, `Reports`, `Sync Journals`, `Storage Transactions`, and `Archive Review`) and migrates compatible legacy top-level copies when a system folder is mapped. New organization evidence is stored beneath top-level `Organizations`; its Rework, Archive, Superseded, and permanent SAAR Archive folders remain with that organization.
- Gives ordinary launcher requests and every file-changing Clean Up or Sync filename-normalization action a bounded watchdog. Resumable scans receive a larger bounded window, later queued file operations fail promptly behind a stalled storage operation, and batch actions continue to a consolidated error review when an individual file fails. Lease renewal uses a separate path and automatic background saves pause during Sync, so valid long-running work cannot falsely disconnect the active operator.
- Generates filtered Compliance Snapshot PDF reports, stores a checksum-protected copy in each selected system's `System/Reports` folder, and records the report identifier and SHA-256 in the audit chain.
- Tracks time-limited compliance exceptions without changing the underlying Missing or Overdue status. Approvals and revocations require named approvers and justifications and are written to the audit chain.
- Splits Outlook notification recipients into safe-size, per-system BCC batches, includes the System Name in every subject, excludes active exceptions, and records a separate audit entry plus a dated User Record notification for every prepared draft batch. Every draft uses a courteous `Sir/Ma'am` salutation, anti-phishing reassurance, filename guidance, and the relevant official training link; Privileged User Training messages include the CDSE course and free-account note. User Agreement drafts attach the exact mapped-system template, while 8140 Certification Memo drafts attach the newest `8140_Qualification_Memo DDMMMYYYY.pdf` template and explain that certification details belong on the memo rather than in an attached certification. The temporary User Record notification clears when that record or its evidence is updated.
- Keeps the newest 30 full-fidelity JSON snapshots with matching SHA-256 files and provides verified in-app restoration without deleting evidence files.
- Shows Last saved, Last backup, and Last Sync health for each mapped system, with an on-demand storage verification control covering the live database checksum, newest backup, and audit chain.
- Sends a lightweight browser-presence heartbeat while the app page is open, suspends both browser-session and Windows-launcher idle expiration during Sync, and restarts the idle clocks only after Sync completes, fails, or is stopped.
- Refreshes the daily backup before automatically shutting down after 60 minutes of inactivity or when the portable app's browser window closes.

This is an administrative evidence and tracking tool. It may support an organization's NIST SP 800-53 assessment activities, but it does not implement technical access controls on a tracked information system and does not independently establish compliance.

## Development

The dependency tree uses a local MIT-licensed `braces` 3.0.4 package containing the narrowly reviewed nesting-depth fix from upstream pull request 72 (commit `d0d575e55e74a4e0218e5248fafb79efc3e54ebb`) while the upstream advisory has no published patched release. The regression suite verifies both normal brace expansion and rejection of excessive nesting. Remove this backport once an official fixed version is available and the strict dependency audit remains clean. Official MIT-licensed Next.js lint packages, the MIT/Zlib `pako` PDF dependency, and `brace-expansion` 5.0.12 runtime files are also checked into `vendor/`; the latter includes the missing CommonJS package marker required by Node. The lint configuration uses the public `@babel/eslint-parser` package because the pinned Next.js package no longer ships the former internal parser path. These pinned runtime copies keep the clean-build and PDF test gates deterministic.

Requirements: Node.js 22.13 or later, pnpm 11.19.0, and Windows for the standalone executable.

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
