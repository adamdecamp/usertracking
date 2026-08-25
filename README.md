# Information System User Tracker

A lightweight Windows administrative tool for tracking information-system users, access roles, training requirements, and supporting evidence. The portable application runs locally, opens its interface in the default browser, and stores records and evidence only in a user-selected shared directory.

## Download

Use the executable attached to the latest GitHub Release. Public releases are blocked unless the Windows executable has a valid Microsoft-backed Authenticode signature. Verify the signature from **Properties → Digital Signatures** and compare the SHA-256 value with `SHA256SUMS.txt` before running it.

## Security model

- Binds only to the local loopback interface.
- Records the active Windows account in consequential audit entries.
- Does not transmit tracker data or evidence to an external service.
- Uses the browser's user-approved directory access for shared storage.
- Validates shared manifests, filenames, request paths, and CSV output.
- Generates daily audit logs and backups in the mapped directory.

This is an administrative evidence and tracking tool. It may support an organization's NIST SP 800-53 assessment activities, but it does not implement technical access controls on a tracked information system and does not independently establish compliance.

## Development

Requirements: Node.js 22.13 or later, pnpm 10.14, and Windows for the standalone executable.

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm build
.\scripts\build-portable.ps1
```

The standalone executable and checksum are written to `release/`.

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

