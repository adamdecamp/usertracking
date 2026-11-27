# R.A.P.T.O.R. architecture

R.A.P.T.O.R. is a local-first Windows application. The React client works against a loopback-only launcher. The launcher owns Windows identity, authorization, exclusive writer leases, protected local state, filesystem access, evidence publication, audit writes, and recovery.

## Layer boundaries

Dependencies point inward:

- `app/domain`: stable records and policy-neutral value types. No React, browser, network, or filesystem imports, and no imports from the layers below.
- `app/application`: use cases, migrations, runtime decoding, Sync checkpoints, provenance, and commit assembly. It may use domain records and pure root-level utilities, but never React pages or components.
- `app/infrastructure`: loopback contracts and filesystem-reference adapters. It validates launcher responses and other external contracts. It may depend on domain types, but not on application orchestration or presentation.
- `app/components` and route files: operator interface and composition only. They may call the inner layers; inner layers never call them. Large infrequent panels are lazy-loaded.
- `portable-launcher`: the trusted Windows boundary. `Program.cs` handles loopback HTTP and session policy, and partial storage services handle durable storage. New storage capabilities belong in focused partial files instead of `PortableStorage.cs`.

These rules and the size ceilings are enforced by `tests/architecture-boundaries.test.ts`. Extract new behavior behind a typed, directly tested function or service before a large file reaches its ceiling.

## Authoritative flow

1. Shared data is pulled into the Windows-user-protected local workspace.
2. Sync discovers and validates local evidence, retaining a protected stage checkpoint and per-file journal.
3. Operator review changes the local manifest only after exact evidence provenance verification.
4. Session Commit publishes changed immutable evidence and changed organization shards, then commits the small catalog last.
5. Audit, backup, publication, and transaction journals make interrupted work recoverable.
6. Multiple Read-Only operators may use the same shared system concurrently. Full Access remains a single cross-computer writer: the next editor must acquire the native shared-file lease, verify the latest master, and rebase only non-conflicting protected local changes before editing. Same-record conflicts stop Full Access rather than applying a stale overwrite.
7. A legacy dirty workspace without a valid three-way-merge base enters a dedicated lease-protected recovery flow. Recovery exports a hash-verified local review package, archives the complete old workspace without deletion, initializes from the verified shared master, and records the action in the shared audit chain. Shared records and evidence are never mutated by the recovery operation.

## Security and trust boundaries

- The browser never receives arbitrary host paths or Windows credentials.
- The launcher binds to loopback. Every request is authenticated with the ephemeral session token, checked for allowed origin and access mode, and bounded by endpoint. A mutating request requires the exclusive Full Access lease, which is checked again after queueing.
- Every launcher response is untrusted until decoded by `app/infrastructure/runtime-decoders.ts` and `portable-contracts.ts`.
- Every persisted manifest is untrusted until decoded and migrated by `app/application/manifest-service.ts`.
- File paths, uploaded evidence, ZIP and PDF content, CSV cells, audit text, and Organization Status File imports are hostile inputs.
- Evidence inputs are bounded by endpoint, validated by signature and extension, and stored with SHA-256 provenance.
- Audit records are append-only, hash-chained, and anchored with Windows-user-protected signing material.
- Shared manifests carry a minimum-client version. Once a newer client commits that schema, older clients fail closed; deployments therefore update all operator copies together.

## Change rules

- Preserve strict TypeScript types and use typed runtime decoding at every external boundary.
- Do not add a dependency when a small pure function is sufficient.
- Do not change authentication, authorization, record schemas, or migration versions without explicit approval.
- Manifest changes require a versioned migration plus decoder tests.
- Add behavioral tests for success, rejection, boundary values, interruption, and recovery. A render-only or source-text assertion is not sufficient evidence for critical behavior.
- Real SAARs or operational PII never enter test fixtures; use the sanitized compatibility corpus under `tests/fixtures/saar`.
- Strict TypeScript, ESLint, regression, property/fuzz, launcher integration, network-chaos, and Playwright gates are required. Run `pnpm verify:build`, the production build, the Playwright workflows, the launcher and network fault tests, and the dependency audit before release.
