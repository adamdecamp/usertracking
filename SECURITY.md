# Security Policy

## Supported versions

Only the most recent signed GitHub Release is supported. Do not redistribute development or unsigned validation builds as production releases.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting feature for this repository. Do not include real user records, evidence documents, credentials, certificate material, shared-directory contents, or other sensitive operational data in a report.

## Release integrity

Every supported release must include:

- A valid Authenticode signature and RFC 3161 timestamp.
- A matching SHA-256 value in `SHA256SUMS.txt`.
- A passing locked dependency audit, lint check, launcher storage integration test, backup-integrity test suite, and production build.

Evidence validation is enforced in both the browser workflow and the Windows launcher. File extensions alone are not trusted. Direct PDFs must contain PDF header and end markers and be readable by the application. ZIP evidence must contain exactly one PDF and is rejected for unsafe paths, encryption, unsupported compression, excessive size, or suspicious expansion ratios.

New audit records use one UTF-8 JSON Lines text file per UTC day. Each entry contains an ISO 8601 UTC timestamp, Windows actor, continuous sequence, previous-entry SHA-256, and entry SHA-256. The launcher verifies the complete cross-day chain before appending and as part of storage verification, and refuses to extend a damaged chain. Legacy `audit-*.txt` files are retained as historical records but are not part of the cryptographic chain. Hash chaining detects modification but does not replace restrictive share permissions or an external immutable log anchor when the organization requires protection against an administrator rewriting the complete history.

Compliance Snapshot PDFs are validated before launcher storage and receive a matching `.sha256` file. Report generation is itself audited with the report ID, filename, scope, reporting date, and checksum.

The portable Windows launcher holds `tracker-exclusive-session.lock` open with exclusive sharing disabled while an information-system folder is active. A second launcher cannot acquire the write lease until the first releases it, its three-minute renewal window expires, or its process exits. This provides cross-computer exclusion when the mapped SMB or Windows filesystem honors native file locking. Browser-only development mode retains an advisory lease and is not appropriate for concurrent production access.

Signing keys and Azure credentials must never be committed to the repository. The release workflow uses short-lived GitHub OpenID Connect credentials.
