[CmdletBinding()]
param(
    [string[]]$Roots = @()
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

Write-Host "Running deterministic network-storage fault simulations (locks, resumable journals, interrupted transactions, long paths, and compatible Windows enumeration)..."
& (Join-Path $PSScriptRoot "Test-PortableStorage.ps1")
if ($LASTEXITCODE -ne 0) { throw "Deterministic network-storage fault simulations failed." }

if ($Roots.Count -eq 0) {
    Write-Host "No external roots supplied. UNC, mapped-drive, and DFS live probes were skipped. Pass -Roots with approved disposable test shares to run them."
    return
}

$probeName = ".isut-network-chaos-" + [Guid]::NewGuid().ToString("N")
foreach ($root in $Roots) {
    $resolvedRoot = [System.IO.Path]::GetFullPath($root)
    if (-not [System.IO.Path]::IsPathRooted($resolvedRoot) -or -not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) {
        throw "Approved network test root is unavailable: $root"
    }
    $probe = Join-Path $resolvedRoot $probeName
    New-Item -ItemType Directory -LiteralPath $probe | Out-Null
    try {
        $payload = Join-Path $probe "probe.bin"
        $expected = [byte[]](0..255)
        [System.IO.File]::WriteAllBytes($payload, $expected)
        $actual = [System.IO.File]::ReadAllBytes($payload)
        if ((Compare-Object -ReferenceObject $expected -DifferenceObject $actual -SyncWindow 0).Count -ne 0) { throw "Round-trip bytes changed at $root" }
        $locked = [System.IO.File]::Open($payload, 'Open', 'ReadWrite', 'None')
        try {
            $blocked = $false
            try { [System.IO.File]::Open($payload, 'Open', 'ReadWrite', 'None').Dispose() } catch [System.IO.IOException] { $blocked = $true }
            if (-not $blocked) { throw "The share did not honor exclusive Windows file locking: $root" }
        }
        finally { $locked.Dispose() }
        Write-Host "Live share probe passed: $root"
    }
    finally {
        if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Recurse -Force }
    }
}
