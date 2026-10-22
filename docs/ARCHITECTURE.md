# R.A.P.T.O.R. architecture

R.A.P.T.O.R. is a local-first Windows application. The React client works against a loopback-only launcher. The launcher owns Windows identity, exclusive writer leases, protected local state, filesystem access, evidence publication, audit writes, and recovery.

## Layer boundaries

- `app/domain`: stable records and policy-neutral value types. No React, browser, network, or filesystem imports.
- `app/application`: use cases, migrations, runtime decoding, Sync checkpoints, provenance, and commit assembly. No presentation imports.
- `app/infrastructure`: loopback contracts and filesystem-reference adapters. It may depend on domain types, but not React presentation.
- `app/components` and route files: operator interface only. Large infrequent panels are lazy-loaded.
- `portable-launcher`: the loopback HTTP router plus partial storage services. New storage capabilities belong in focused partial files instead of `PortableStorage.cs`.

## Authoritative flow

1. Shared data is pulled into the Windows-user-protected local workspace.
2. Sync discovers and validates local evidence, retaining a protected stage checkpoint and per-file journal.
3. Operator review changes the local manifest only after exact evidence provenance verification.
4. Session Commit publishes changed immutable evidence and changed organization shards, then commits the small catalog last.
5. Audit, backup, publication, and transaction journals make interrupted work recoverable.

## Security boundaries

- The browser never receives arbitrary host paths or Windows credentials.
- The launcher binds to loopback, enforces origin and session tokens, and checks the Full Access lease again after queueing.
- Runtime decoders reject malformed persisted and launcher data.
- Evidence inputs are bounded by endpoint, validated by signature and extension, and stored with SHA-256 provenance.
- Audit records are append-only, hash-chained, and anchored with Windows-user-protected signing material.

## Maintainability guardrails

- Strict TypeScript, ESLint, regression, property/fuzz, launcher integration, network-chaos, and Playwright gates are required.
- Manifest changes require a versioned migration plus decoder tests.
- Real SAARs or operational PII never enter test fixtures; use the sanitized compatibility corpus under `tests/fixtures/saar`.
- The route and launcher size budgets prevent silent monolith growth.
