[CmdletBinding()]
param(
    [int[]]$Counts = @(1000, 5000, 10000),
    [string]$Root = ""
)

$ErrorActionPreference = "Stop"
$base = if ([string]::IsNullOrWhiteSpace($Root)) { [System.IO.Path]::GetTempPath() } else { [System.IO.Path]::GetFullPath($Root) }
if (-not [System.IO.Path]::IsPathRooted($base) -or -not (Test-Path -LiteralPath $base -PathType Container)) { throw "The approved performance-test root is unavailable." }
$probe = Join-Path $base ("raptor-network-performance-" + [Guid]::NewGuid().ToString("N"))
[System.IO.Directory]::CreateDirectory($probe) | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
try {
    foreach ($count in $Counts) {
        if ($count -lt 1 -or $count -gt 10000) { throw "Performance qualification supports 1 through 10,000 files per case." }
        $case = Join-Path $probe ("case-" + $count)
        [System.IO.Directory]::CreateDirectory($case) | Out-Null
        for ($index = 0; $index -lt $count; $index++) {
            $organization = Join-Path $case ("ORG-" + ($index % 25).ToString("00"))
            if (-not [System.IO.Directory]::Exists($organization)) { [System.IO.Directory]::CreateDirectory($organization) | Out-Null }
            $path = Join-Path $organization ("User" + $index.ToString("00000") + "_Evidence_01JAN2026.pdf.zip")
            if (-not [System.IO.File]::Exists($path)) { [System.IO.File]::WriteAllBytes($path, [byte[]](80,75,5,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)) }
        }
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        $seen = 0
        foreach ($path in [System.IO.Directory]::EnumerateFiles($case, "*", [System.IO.SearchOption]::AllDirectories)) {
            $info = [System.IO.FileInfo]::new($path)
            $null = $info.Length
            $null = $info.LastWriteTimeUtc
            $seen++
        }
        $watch.Stop()
        if ($seen -ne $count) { throw "Metadata enumeration returned $seen of $count files." }
        $budgetMs = if ($count -le 1000) { 15000 } elseif ($count -le 5000) { 45000 } else { 90000 }
        if ($watch.ElapsedMilliseconds -gt $budgetMs) { throw "The $count-file metadata scan exceeded its $budgetMs ms release budget: $($watch.ElapsedMilliseconds) ms." }
        $results.Add([pscustomobject]@{ files=$count; elapsedMs=$watch.ElapsedMilliseconds; budgetMs=$budgetMs; rootType=if ($base.StartsWith("\\")) { "UNC" } else { "LocalOrMapped" } })
    }
    $results | ConvertTo-Json -Depth 3
}
finally {
    if ([System.IO.Directory]::Exists($probe) -and $probe.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) { [System.IO.Directory]::Delete($probe, $true) }
}
