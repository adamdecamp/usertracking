[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$tsc = Join-Path $projectRoot "node_modules\.bin\tsc.cmd"
$eslint = Join-Path $projectRoot "node_modules\.bin\eslint.cmd"

if (-not (Test-Path -LiteralPath $tsc) -or -not (Test-Path -LiteralPath $eslint)) {
    throw "Build dependencies are missing. Run pnpm install --frozen-lockfile first."
}

$regressionTests = @(
    "tests/backup-utils.test.ts",
    "tests/evidence-validation.test.ts",
    "tests/audit-utils.test.ts",
    "tests/compliance-report.test.ts",
    "tests/executive-summary.test.ts",
    "tests/cleanup-utils.test.ts",
    "tests/notification-utils.test.ts",
    "tests/sync-utils.test.ts",
    "tests/session-utils.test.ts",
    "tests/filename-utils.test.ts",
    "tests/saar-form-utils.test.ts",
    "tests/manual-saar-utils.test.ts"
)

Push-Location $projectRoot
try {
    Write-Host "Running TypeScript checks..."
    & $tsc --noEmit
    if ($LASTEXITCODE -ne 0) { throw "TypeScript checks failed." }

    Write-Host "Running lint checks..."
    & $eslint . --ignore-pattern dist --ignore-pattern .next
    if ($LASTEXITCODE -ne 0) { throw "Lint checks failed." }

    Write-Host "Running the full regression suite..."
    & $node --experimental-strip-types --test $regressionTests
    if ($LASTEXITCODE -ne 0) { throw "Regression tests failed." }

    Write-Host "Running deterministic fuzz tests..."
    & $node --experimental-strip-types --test "tests/fuzz.test.ts"
    if ($LASTEXITCODE -ne 0) { throw "Fuzz tests failed." }

    Write-Host "Running Windows launcher storage integration tests..."
    & (Join-Path $PSScriptRoot "Test-PortableStorage.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Portable storage integration tests failed." }
}
finally {
    Pop-Location
}

Write-Host "Build gate passed: types, lint, regression, fuzz, and portable storage."
