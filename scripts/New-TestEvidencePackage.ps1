$ErrorActionPreference = 'Stop'

$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot 'test-evidence-package'))
$testDataRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot 'test-data'))
$zipPath = [IO.Path]::GetFullPath((Join-Path $testDataRoot 'Information-System-User-Tracker-Test-Evidence.zip'))
$workspacePrefix = $workspaceRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (-not $packageRoot.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase) -or
    -not $testDataRoot.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'A generated test-evidence path is outside the workspace.'
}

if (Test-Path -LiteralPath $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

$null = New-Item -ItemType Directory -Path $testDataRoot -Force
$directoryScan = New-Item -ItemType Directory -Path (Join-Path $packageRoot 'DirectoryScan') -Force
$manualSamples = New-Item -ItemType Directory -Path (Join-Path $packageRoot 'ManualUploadSamples') -Force
$utf8NoBom = [Text.UTF8Encoding]::new($false)

$firstNames = @(
  'Avery','Blake','Casey','Drew','Emery','Finley','Gray','Harper','Indigo','Jordan',
  'Kai','Lane','Morgan','Nico','Oakley','Parker','Quinn','Riley','Sawyer','Taylor',
  'Uma','Val','Winter','Xen','Yael','Zion','Alex','Bailey','Cameron','Dakota',
  'Elliot','Frankie','Gale','Hayden','Ira','Jamie','Kendall','Logan','Micah','Noel',
  'Orion','Payton','Reese','Skyler','Tatum','Uri','Vivian','Wren','Xia','Yuri'
)
$lastNames = @(
  'Adams','Baker','Carter','Diaz','Evans','Foster','Garcia','Hill','Irwin','Jones',
  'Kim','Lewis','Moore','Nelson','Owens','Price','Reed','Rivera','Smith','Turner',
  'Underwood','Vega','Walker','Xavier','Young','Zimmerman','Archer','Bishop','Clark','Dean',
  'Ellis','Ford','Green','Hayes','Ingram','Johnson','King','Lee','Martin','Nichols',
  'Ortiz','Patel','Roberts','Scott','Thomas','Stone','Shaw','White','Wong','Wood'
)
$organizations = @('GOV','LM','Boeing','Northrop','Raytheon','USAF')
$privilegedTypes = @('admin','dev','cyber','auditor','security','database','network','helpdesk','cloud','engineer')
$profiles = @('Current','Expired','Mixed')
$currentDates = @('25AUG2026','15JUL2026','01MAR2026')
$expiredDates = @('24AUG2024','01JAN2025','15JUN2024')
$roster = [Collections.Generic.List[object]]::new()
$createdFiles = [Collections.Generic.List[string]]::new()

function Write-SyntheticPdf([string]$Path, [string[]]$Lines) {
  $encoding = [Text.Encoding]::ASCII
  $escapedLines = foreach ($line in $Lines) {
    $line.Replace('\', '\\').Replace('(', '\(').Replace(')', '\)')
  }
  $streamText = "BT`n/F1 11 Tf`n72 740 Td`n15 TL`n" + (($escapedLines | ForEach-Object { "($_) Tj`nT*`n" }) -join '') + "ET`n"
  $streamLength = $encoding.GetByteCount($streamText)
  $objects = @(
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    ("<< /Length {0} >>`nstream`n{1}endstream" -f $streamLength, $streamText),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  )
  $header = "%PDF-1.4`n"
  $body = [Text.StringBuilder]::new()
  $offsets = [Collections.Generic.List[int64]]::new()
  for ($objectIndex = 0; $objectIndex -lt $objects.Count; $objectIndex++) {
    $offsets.Add($encoding.GetByteCount($header) + $encoding.GetByteCount($body.ToString()))
    [void]$body.AppendFormat("{0} 0 obj`n{1}`nendobj`n", $objectIndex + 1, $objects[$objectIndex])
  }
  $xrefOffset = $encoding.GetByteCount($header) + $encoding.GetByteCount($body.ToString())
  $objectCount = $objects.Count + 1
  $xref = [Text.StringBuilder]::new("xref`n0 $objectCount`n0000000000 65535 f `n")
  foreach ($offset in $offsets) {
    [void]$xref.AppendFormat("{0:0000000000} 00000 n `n", $offset)
  }
  [void]$xref.Append("trailer`n<< /Size $objectCount /Root 1 0 R >>`nstartxref`n$xrefOffset`n%%EOF`n")
  [IO.File]::WriteAllBytes($Path, $encoding.GetBytes($header + $body.ToString() + $xref.ToString()))
}

function Get-ArtifactDefinitions([string]$Role, [string]$PrivilegedType) {
  $base = @(
    @{ Name = 'SAAR'; Suffix = $null },
    @{ Name = 'DoD Cyber Cert'; Suffix = 'DoD_Cyber_Cert' },
    @{ Name = 'GEN User Agreement'; Suffix = 'GEN_User_Agreement' }
  )
  if ($Role -eq 'Privileged') {
    $privileged = $base + @(
      @{ Name = 'GEN and PRIV Agreement'; Suffix = 'GEN_and_PRIV_Agreement' },
      @{ Name = '8140 Cert Memo'; Suffix = '8140_Cert_Memo' },
      @{ Name = 'Privileged User Training Cert'; Suffix = 'PRIV_Training_Cert' }
    )
    if ($PrivilegedType -eq 'DTA') {
      $privileged += @(
        @{ Name = 'DTA Training Cert'; Suffix = 'DTA_Training_Cert' },
        @{ Name = 'DTA Agreement'; Suffix = 'DTA_Agreement' }
      )
    }
    return $privileged
  }
  return $base
}

function Get-TestDate([string]$Profile, [int]$ArtifactIndex, [int]$UserIndex) {
  if ($Profile -eq 'Current') {
    return $currentDates[($ArtifactIndex + $UserIndex) % $currentDates.Count]
  }
  if ($Profile -eq 'Expired') {
    return $expiredDates[($ArtifactIndex + $UserIndex) % $expiredDates.Count]
  }
  if ($ArtifactIndex % 2 -eq 0) {
    return $currentDates[($ArtifactIndex + $UserIndex) % $currentDates.Count]
  }
  return $expiredDates[($ArtifactIndex + $UserIndex) % $expiredDates.Count]
}

for ($index = 0; $index -lt 50; $index++) {
  $first = $firstNames[$index]
  $last = $lastNames[$index]
  $organization = $organizations[$index % $organizations.Count]
  $profile = $profiles[$index % $profiles.Count]
  $role = if ($index -lt 35) { 'General' } else { 'Privileged' }
  $type = if ($index -ge 45) { 'DTA' } elseif ($role -eq 'Privileged') { $privilegedTypes[$index - 35] } else { '' }
  $privilegedUsername = if ($role -eq 'General') { '' } else { '{0}{1}_{2}' -f $first.Substring(0,1).ToLowerInvariant(), $last.ToLowerInvariant(), $type }
  $email = ('{0}.{1}@example.test' -f $first.ToLowerInvariant(), $last.ToLowerInvariant())
  $userDirectory = New-Item -ItemType Directory -Path (Join-Path (Join-Path $directoryScan $role) ('{0}_{1}' -f $last,$first)) -Force
  $artifacts = Get-ArtifactDefinitions -Role $role -PrivilegedType $type

  for ($artifactIndex = 0; $artifactIndex -lt $artifacts.Count; $artifactIndex++) {
    $artifact = $artifacts[$artifactIndex]
    $date = Get-TestDate -Profile $profile -ArtifactIndex $artifactIndex -UserIndex $index
    $expected = if ($artifact.Name -eq 'SAAR') { 'Current (SAAR does not expire)' } elseif ($expiredDates -contains $date) { 'Overdue' } else { 'Current' }
    if ($artifact.Name -eq 'SAAR') {
      $saarLabel = if ($role -eq 'General') { 'GEN' } else { 'PRIV_{0}' -f $type }
      $filename = '{0}_{1}_({2})_{3}_SAAR_{4}.pdf' -f $last,$first,$organization,$saarLabel,$date
    } else {
      $filename = '{0}_{1}_({2})_{3}_{4}.pdf' -f $last,$first,$organization,$artifact.Suffix,$date
    }
    $content = @(
      'SYNTHETIC TEST EVIDENCE ONLY'
      ('User: {0} {1}' -f $first,$last)
      ('Organization: {0}' -f $organization)
      ('Role: {0}' -f $role)
      ('Privileged account: {0}' -f $(if ($privilegedUsername) { $privilegedUsername } else { 'N/A' }))
      ('Artifact: {0}' -f $artifact.Name)
      ('Evidence date: {0}' -f $date)
      ('Expected status on 25 August 2026: {0}' -f $expected)
    )
    $filePath = Join-Path $userDirectory $filename
    Write-SyntheticPdf -Path $filePath -Lines $content
    $createdFiles.Add($filePath)
  }

  $roster.Add([PSCustomObject]@{
    LastName = $last
    FirstName = $first
    Organization = $organization
    Role = $role
    PrivilegedUsername = $privilegedUsername
    PrivilegedUserType = $type
    Email = $email
    EvidenceProfile = $profile
  })
}

$rosterPath = Join-Path $packageRoot 'Test_User_Roster.csv'
$roster | Export-Csv -LiteralPath $rosterPath -NoTypeInformation -Encoding utf8

foreach ($sampleIndex in @(0,35,45)) {
  $role = if ($sampleIndex -lt 35) { 'General' } else { 'Privileged' }
  $sourceName = '{0}_{1}' -f $lastNames[$sampleIndex],$firstNames[$sampleIndex]
  $source = Join-Path (Join-Path $directoryScan $role) $sourceName
  $destinationRole = New-Item -ItemType Directory -Path (Join-Path $manualSamples $role) -Force
  Copy-Item -LiteralPath $source -Destination $destinationRole.FullName -Recurse
}

$readme = @'
INFORMATION SYSTEM USER TRACKER - SYNTHETIC TEST PACKAGE

This package contains 50 fictional users and no real personnel or compliance data:
- 35 General users
- 15 Privileged users, including 5 with DTA as the Privileged User Type
- Organizations include GOV, LM, Boeing, Northrop, Raytheon, and USAF
- Evidence profiles include Current, Overdue, and Mixed

DIRECTORY SCAN TEST
1. Extract this ZIP.
2. Create the users from Test_User_Roster.csv in a test information system.
3. Map the DirectoryScan folder as the test system's shared folder.
4. Select Sync and manually verify the proposed matches.

MANUAL UPLOAD TEST
Use files under ManualUploadSamples when adding or modifying the sample General,
Privileged, and Privileged/DTA users. Every sample is a structurally valid,
single-page synthetic PDF. The application will validate each selected PDF,
compress it into an individual ZIP, reopen and validate the ZIP, and only then
store it in the mapped system folder.

These PDFs are synthetic filename-and-status fixtures; they are not replicas of
the fillable SAAR and do not contain AcroForm fields. Create users from the CSV
before directory-sync testing. New-user discovery from a SAAR still requires a
completed fillable SAAR with Official Email populated.

Dates use DDMMMYYYY. Files dated in 2026 are Current for this test baseline.
Files dated in 2024 or early 2025 are Overdue as of 25 August 2026.
'@
[IO.File]::WriteAllText((Join-Path $packageRoot 'README.txt'), $readme.Trim(), $utf8NoBom)

Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal

[PSCustomObject]@{
  ZipPath = $zipPath
  Users = $roster.Count
  GeneralUsers = @($roster | Where-Object Role -eq 'General').Count
  PrivilegedUsers = @($roster | Where-Object Role -eq 'Privileged').Count
  DtaPrivilegedUsers = @($roster | Where-Object PrivilegedUserType -eq 'DTA').Count
  EvidenceFiles = $createdFiles.Count
  ManualSampleFiles = @(Get-ChildItem -LiteralPath $manualSamples -Recurse -File).Count
} | ConvertTo-Json
