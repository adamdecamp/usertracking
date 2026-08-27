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

$scriptFiles = @(Get-ChildItem -LiteralPath (Join-Path $webRoot "assets") -Filter "*.js" -File)
$styleFiles = @(Get-ChildItem -LiteralPath (Join-Path $webRoot "assets") -Filter "*.css" -File)
if ($scriptFiles.Count -ne 1 -or $styleFiles.Count -ne 1) { throw "Expected exactly one JavaScript and one CSS asset." }

$scriptGzip = Join-Path $embeddedRoot "script.gz"
$styleGzip = Join-Path $embeddedRoot "style.gz"
Compress-Asset $scriptFiles[0].FullName $scriptGzip
Compress-Asset $styleFiles[0].FullName $styleGzip

$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) { throw "The Windows C# compiler was not found." }
$executable = Join-Path $outputRoot "InformationSystemUserTracker.exe"
$manifest = Join-Path $portableRoot "app.manifest"
if (-not (Test-Path -LiteralPath $manifest)) { throw "The Windows application manifest was not found." }
& $compiler /nologo /target:winexe "/out:$executable" "/win32manifest:$manifest" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/resource:$webRoot\index.html,Tracker.Index" "/resource:$scriptGzip,Tracker.ScriptGzip" "/resource:$styleGzip,Tracker.StyleGzip" (Join-Path $portableRoot "Program.cs") (Join-Path $portableRoot "PortableStorage.cs")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $executable)) { throw "Standalone launcher compilation failed." }

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $executable).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $outputRoot "SHA256SUMS.txt") -Encoding ascii -Value "$hash  InformationSystemUserTracker.exe"
Write-Host "Built $executable ($((Get-Item -LiteralPath $executable).Length) bytes)"
