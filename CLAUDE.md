# CLAUDE.md

Claude is responsible for all builds of this repository: keeping CI green, fixing build and test failures, and handling dependency updates.

## Toolchain

Use the versions pinned in `.github/workflows/security-build.yml`:

- Node.js 22.23.3 (`package.json` requires `>=22.13.0`)
- pnpm 11.19.0 (`packageManager` in `package.json`)
- PowerShell 7 (`pwsh`) for the scripts CI runs with `shell: pwsh`

## Checks to run before pushing

These are the same checks CI runs, in the same order:

```powershell
./scripts/Test-ReleaseClean.ps1 -SourceOnly
pnpm install --frozen-lockfile
pnpm audit --audit-level low --ignore GHSA-fc5q-39xc-vjpf
pnpm lint
pnpm test
./scripts/Test-NetworkShareChaos.ps1
./scripts/Test-NetworkPerformance.ps1
pnpm build
pnpm exec playwright install chromium
pnpm exec playwright test
./scripts/build-portable.ps1
./scripts/Test-ReleaseClean.ps1
```

- `pnpm lint` runs with `--max-warnings 0`, so any warning fails the build.
- `pnpm build` runs `scripts/Test-BuildGate.ps1` first, as its prebuild step.
- `pnpm audit` ignores only GHSA-fc5q-39xc-vjpf, which has no patched picomatch release and is reachable only through build tooling. Don't add more ignores without the owner's approval. Fix or upgrade instead. pnpm 11 saves `--ignore` into `pnpm-workspace.yaml` as `auditConfig.ignoreGhsas`, so run `git restore pnpm-workspace.yaml` after a local audit and never commit that change.

## Release-clean rules (enforced by `scripts/Test-ReleaseClean.ps1`)

- `starterSystems` and `starterUsers` in `app/page.tsx` must stay empty arrays.
- System and user records must never be persisted to `localStorage`.
- Never commit runtime data or synthetic test packages: `information-system-user-tracker.json`, `tracker-active-session.json`, `tracker-exclusive-session.lock`, or anything under `Organizations/`, `User Evidence/`, `System/`, `Error Reports/`, `Audit Logs/`, `backup/`, `Reports/`, `Archive Review/`, `test-data/`, or `test-evidence-package/`.
- The release package may contain only `RAPTOR.exe`, `RAPTOR-Executive-Capability-Summary.pdf`, and `SHA256SUMS.txt`.

## Workflow

- Work on a branch and open a pull request against `main`. `Security and build` runs on pull requests, so CI has to pass before merging.
- Attestation steps run only on pushes to `main`, not on pull requests.
- Get the owner's explicit approval before running `signed-release.yml` or doing anything else that produces, signs, or attests a public release.
- Don't weaken or remove CI gates, audit settings, or release-clean checks to make a build pass.
