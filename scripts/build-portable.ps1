[CmdletBinding()]
param(
    [string]$OutputDirectory = "release"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$portableRoot = Join-Path $projectRoot "portable-launcher"
$webRoot = Join-Path $portableRoot "wwwroot"
$embeddedRoot = Join-Path $portableRoot "embedded"
$outputRoot = Join-Path $projectRoot $OutputDirectory

function Assert-ProjectChild([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Build path is outside the project: $fullPath"
    }
    return $fullPath
}

function Compress-Asset([string]$Source, [string]$Destination) {
    $sourceStream = [System.IO.File]::OpenRead($Source)
    try {
        $destinationStream = [System.IO.File]::Create($Destination)
        try {
            $gzipStream = New-Object System.IO.Compression.GZipStream($destinationStream, [System.IO.Compression.CompressionLevel]::Optimal)
            try { $sourceStream.CopyTo($gzipStream) }
            finally { $gzipStream.Dispose() }
        }
        finally { $destinationStream.Dispose() }
    }
    finally { $sourceStream.Dispose() }
}

$embeddedRoot = Assert-ProjectChild $embeddedRoot
$outputRoot = Assert-ProjectChild $outputRoot
& (Join-Path $PSScriptRoot "Test-BuildGate.ps1")
if ($LASTEXITCODE -ne 0) { throw "Regression and fuzz build gate failed." }
if (Test-Path -LiteralPath $embeddedRoot) { Remove-Item -LiteralPath $embeddedRoot -Recurse -Force }
if (Test-Path -LiteralPath $outputRoot) { Remove-Item -LiteralPath $outputRoot -Recurse -Force }
New-Item -ItemType Directory -Path $embeddedRoot, $outputRoot | Out-Null

Push-Location $projectRoot
try {
    $vite = Join-Path $projectRoot "node_modules\.bin\vite.cmd"
    if (-not (Test-Path -LiteralPath $vite)) { throw "Vite is not installed. Run pnpm install first." }
    & $vite build --config vite.portable.config.ts
}
finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "Portable browser build failed." }

$assetFiles = @(Get-ChildItem -LiteralPath (Join-Path $webRoot "assets") -File | Where-Object { $_.Extension -in ".js", ".css" } | Sort-Object Name)
if ($assetFiles.Count -lt 2 -or -not ($assetFiles.Extension -contains ".js") -or -not ($assetFiles.Extension -contains ".css")) { throw "Expected at least one JavaScript and one CSS asset." }
$assetManifest = Join-Path $embeddedRoot "assets.tsv"
$assetManifestLines = New-Object System.Collections.Generic.List[string]
$assetResourceArgs = New-Object System.Collections.Generic.List[string]
for ($index = 0; $index -lt $assetFiles.Count; $index++) {
    $asset = $assetFiles[$index]
    $compressed = Join-Path $embeddedRoot ("asset-{0}.gz" -f $index)
    $resourceName = "Tracker.Asset$index"
    $contentType = if ($asset.Extension -eq ".js") { "text/javascript; charset=utf-8" } else { "text/css; charset=utf-8" }
    Compress-Asset $asset.FullName $compressed
    $assetManifestLines.Add("/assets/$($asset.Name)`t$resourceName`t$contentType")
    $assetResourceArgs.Add("/resource:$compressed,$resourceName")
}
[System.IO.File]::WriteAllLines($assetManifest, $assetManifestLines, (New-Object System.Text.UTF8Encoding($false)))

$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) { throw "The Windows C# compiler was not found." }
$executable = Join-Path $outputRoot "InformationSystemUserTracker.exe"
$executiveSummary = Join-Path $outputRoot "Information-System-User-Tracker-Executive-Summary.pdf"
$manifest = Join-Path $portableRoot "app.manifest"
if (-not (Test-Path -LiteralPath $manifest)) { throw "The Windows application manifest was not found." }
$compilerArgs = New-Object System.Collections.Generic.List[string]
@('/nologo', '/target:winexe', "/out:$executable", "/win32manifest:$manifest", '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll', "/resource:$webRoot\index.html,Tracker.Index", "/resource:$assetManifest,Tracker.AssetManifest") | ForEach-Object { $compilerArgs.Add($_) }
$assetResourceArgs | ForEach-Object { $compilerArgs.Add($_) }
$compilerArgs.Add((Join-Path $portableRoot "Program.cs"))
$compilerArgs.Add((Join-Path $portableRoot "PortableStorage.cs"))
& $compiler $compilerArgs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $executable)) { throw "Standalone launcher compilation failed." }

& (Get-Command node.exe -ErrorAction Stop).Source --experimental-strip-types (Join-Path $projectRoot "scripts\New-ExecutiveSummaryPdf.ts") --output $executiveSummary
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $executiveSummary)) { throw "Executive summary PDF generation failed." }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $executable).Hash.ToLowerInvariant()
$summaryHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $executiveSummary).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $outputRoot "SHA256SUMS.txt") -Encoding ascii -Value @("$hash  InformationSystemUserTracker.exe", "$summaryHash  Information-System-User-Tracker-Executive-Summary.pdf")
Write-Host "Built $executable ($((Get-Item -LiteralPath $executable).Length) bytes)"
