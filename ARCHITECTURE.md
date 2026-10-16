# R.A.P.T.O.R. Architecture

R.A.P.T.O.R. is a local-first Windows application. The browser UI talks only to the loopback launcher. The launcher owns Windows identity, authorization, local workspace state, shared-folder leases, evidence I/O, audit integrity, and publication to the shared master.

## Dependency Direction

Dependencies point inward:

1. `app/domain` contains stable records and domain vocabulary. It must not import application, infrastructure, React, route, or component code.
2. `app/application` contains use cases such as manifest decoding and single-system commit construction. It may use domain records and pure root-level domain utilities, but never React pages or components.
3. `app/infrastructure` validates launcher responses and other external contracts. It may use domain code, but not application orchestration or presentation code.
4. `app/components` and `app/page.tsx` are presentation and composition. They may call the inner layers; inner layers never call them.
5. `portable-launcher` is the trusted Windows boundary. `Program.cs` handles loopback HTTP and session policy; `PortableStorage.cs` owns durable storage and file operations; `PublicationRecovery.cs` contains the hash-verified recovery policy for stale local publication references.

These rules and monolith size ceilings are enforced by `tests/architecture-boundaries.test.ts`. New behavior should be extracted behind a typed, directly tested function or service before either monolith exceeds its ceiling.

## Trust Boundaries

- Every launcher response is untrusted until decoded by `app/infrastructure/runtime-decoders.ts` and `portable-contracts.ts`.
- Every persisted manifest is untrusted until decoded and migrated by `app/application/manifest-service.ts`.
- Every launcher request is authenticated with the ephemeral session token, checked for allowed origin and access mode, bounded by endpoint, and—when mutating—requires the exclusive Full Access lease.
- File paths, uploaded evidence, ZIP/PDF content, CSV cells, audit text, and organization snapshot imports are hostile inputs.

## Change Rules

- Preserve strict TypeScript types and use typed runtime decoding at every external boundary.
- Do not add a dependency when a small pure function is sufficient.
- Do not change authentication, authorization, record schemas, or migration versions without explicit approval.
- Add behavioral tests for success, rejection, boundary values, interruption, and recovery. A render-only or source-text assertion is not sufficient evidence for critical behavior.
- Run `pnpm verify:build`, the production build, Playwright workflows, launcher/network fault tests, and the dependency audit before release.
