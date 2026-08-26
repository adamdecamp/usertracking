[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) { throw "The Windows C# compiler was not found." }

$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$testRoot = Join-Path $temporaryBase ("isut-portable-storage-test-" + [Guid]::NewGuid().ToString("N"))
$resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
if (-not $resolvedTestRoot.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase) -or -not ([System.IO.Path]::GetFileName($resolvedTestRoot)).StartsWith("isut-portable-storage-test-", [System.StringComparison]::Ordinal)) {
    throw "The portable-storage test directory is outside the approved temporary location."
}

New-Item -ItemType Directory -Path $resolvedTestRoot | Out-Null
try {
    $testExecutable = Join-Path $resolvedTestRoot "PortableStorageTests.exe"
    & $compiler /nologo /target:exe "/out:$testExecutable" "/win32manifest:$(Join-Path $projectRoot 'portable-launcher\app.manifest')" /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $projectRoot "portable-launcher\PortableStorage.cs") (Join-Path $projectRoot "tests\PortableStorageTests.cs")
    if ($LASTEXITCODE -ne 0) { throw "Portable storage test compilation failed." }
    & $testExecutable (Join-Path $resolvedTestRoot "data")
    if ($LASTEXITCODE -ne 0) { throw "Portable storage integration tests failed." }
}
finally {
    if (Test-Path -LiteralPath $resolvedTestRoot) { Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force }
}
