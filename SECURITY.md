# Security Policy

## Supported versions

Only the most recent signed GitHub Release is supported. Do not redistribute development or unsigned validation builds as production releases.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting feature for this repository. Do not include real user records, evidence documents, credentials, certificate material, shared-directory contents, or other sensitive operational data in a report.

## Release integrity

Every supported release must include:

- A valid Authenticode signature and RFC 3161 timestamp.
- A matching SHA-256 value in `SHA256SUMS.txt`.
- A passing locked dependency audit, lint check, and production build.

Signing keys and Azure credentials must never be committed to the repository. The release workflow uses short-lived GitHub OpenID Connect credentials.

