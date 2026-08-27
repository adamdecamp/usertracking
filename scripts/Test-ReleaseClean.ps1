[CmdletBinding()]
param(
    [string]$ReleaseDirectory = "release",
    [switch]$SourceOnly
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$pageSource = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "app\page.tsx")

if ($pageSource -notmatch 'const\s+starterSystems\s*:\s*SystemRecord\[\]\s*=\s*\[\s*\]\s*;') {
    throw "Release blocked: starterSystems must be an empty array."
}
if ($pageSource -notmatch 'const\s+starterUsers\s*:\s*UserRecord\[\]\s*=\s*\[\s*\]\s*;') {
    throw "Release blocked: starterUsers must be an empty array."
}
if ($pageSource -match 'localStorage\.setItem\([^\r\n]*(systems|users|isut-data)') {
    throw "Release blocked: system or user records must not be persisted in browser storage."
}

$runtimeFileNames = @(
    "information-system-user-tracker.json",
    "tracker-active-session.json",
    "tracker-exclusive-session.lock"
)
$runtimeDirectoryNames = @("User Evidence", "Audit Logs", "backup", "Reports", "Archive Review")
$trackedFiles = @(& git -C $projectRoot ls-files)
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect tracked files." }

foreach ($trackedFile in $trackedFiles) {
    if ($runtimeFileNames -contains (Split-Path -Leaf $trackedFile)) {
        throw "Release blocked: tracked runtime database file detected: $trackedFile"
    }
    $segments = $trackedFile -split '[/\\]'
    if ($segments | Where-Object { $runtimeDirectoryNames -contains $_ }) {
        throw "Release blocked: tracked runtime data directory detected: $trackedFile"
    }
}

if ($SourceOnly) {
    Write-Host "Release-clean source check passed."
    return
}

$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $ReleaseDirectory))
if (-not $releaseRoot.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Release path is outside the project."
}
if (-not (Test-Path -LiteralPath $releaseRoot -PathType Container)) {
    throw "Release directory does not exist: $releaseRoot"
}

$allowedFiles = @("InformationSystemUserTracker.exe", "Information-System-User-Tracker-Executive-Summary.pdf", "SHA256SUMS.txt")
$releaseFiles = @(Get-ChildItem -LiteralPath $releaseRoot -Recurse -File)
$releaseDirectories = @(Get-ChildItem -LiteralPath $releaseRoot -Recurse -Directory)
if ($releaseDirectories.Count -ne 0) {
    throw "Release blocked: the package must not contain directories."
}
if ($releaseFiles.Count -ne $allowedFiles.Count) {
    throw "Release blocked: expected only the executable and checksum."
}
foreach ($file in $releaseFiles) {
    if ($allowedFiles -notcontains $file.Name) {
        throw "Release blocked: unexpected file detected: $($file.Name)"
    }
}
foreach ($requiredFile in $allowedFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot $requiredFile) -PathType Leaf)) {
        throw "Release blocked: required file is missing: $requiredFile"
    }
}

$checksumLines = @(Get-Content -LiteralPath (Join-Path $releaseRoot "SHA256SUMS.txt") | Where-Object { $_.Trim() })
$expectedChecksums = @{}
foreach ($filename in @("InformationSystemUserTracker.exe", "Information-System-User-Tracker-Executive-Summary.pdf")) {
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $releaseRoot $filename)).Hash.ToLowerInvariant()
    $expectedChecksums[$filename] = "$actualHash  $filename"
}
if ($checksumLines.Count -ne $expectedChecksums.Count) { throw "Release blocked: checksum file has an unexpected number of entries." }
foreach ($line in $expectedChecksums.Values) {
    if ($checksumLines -notcontains $line) { throw "Release blocked: checksum mismatch for $($line.Split('  ')[1])." }
}

Write-Host "Release-clean package check passed. The executable, executive summary, and checksums contain no systems, users, evidence, manifests, audit logs, or backups."
