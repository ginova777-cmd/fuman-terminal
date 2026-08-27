param(
  [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$FormalRoot = 'C:\fuman-release-owner\fuman-terminal',
  [string]$RuntimeRoot = 'C:\fuman-runtime',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$files = @(
  'run-daytrade-intraday-retention.ps1',
  'ops\public-slot\Run-DaytradeWebSocketCollector.ps1',
  'run-terminal-master-control.ps1',
  'scripts\collect-scorecard88-terminal-surface-evidence.js',
  'scripts\collect-terminal-scorecard-88.js',
  'scripts\fuman-schedule-registry.json',
  'scripts\run-scorecard88-terminal-collector.ps1',
  'scripts\verify-cleanup-root-authority.js',
  'scripts\verify-scorecard88-fixed-collection-contract.js',
  'scripts\verify-strategy3-v2-collector-boot-contract.js',
  'scripts\verify-terminal-autonomous-root-runner.js'
)
function Hash([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Inside([string]$Root,[string]$Candidate) {
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $candidateFull = [IO.Path]::GetFullPath($Candidate)
  return $candidateFull.StartsWith($rootFull,[StringComparison]::OrdinalIgnoreCase)
}
$sourceFull = [IO.Path]::GetFullPath($SourceRoot)
$formalFull = [IO.Path]::GetFullPath($FormalRoot)
if ($sourceFull -eq $formalFull) { throw 'source_and_formal_root_must_differ' }
$sourceSha = (& git -C $sourceFull rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $sourceSha) { throw 'source_git_sha_unavailable' }
$sourceDirty = @(& git -C $sourceFull status --porcelain)
if ($sourceDirty.Count -gt 0) { throw 'source_tree_not_clean' }
$now = Get-Date
$windowAllowed = $now.TimeOfDay -ge [TimeSpan]::Parse('22:00') -and $now.TimeOfDay -lt [TimeSpan]::Parse('22:30')
if ($Apply -and -not $windowAllowed) { throw 'runtime_control_plane_apply_outside_2200_window' }
$rows = @()
foreach($relative in $files) {
  $source = Join-Path $sourceFull $relative
  $target = Join-Path $formalFull $relative
  if (-not (Inside $sourceFull $source) -or -not (Inside $formalFull $target)) { throw "path_escape:$relative" }
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "source_file_missing:$relative" }
  $before = Hash $target
  $expected = Hash $source
  $rows += [ordered]@{ file=$relative; sourceHash=$expected; formalHashBefore=$before; changed=($before -ne $expected); formalHashAfter=$before; verified=($before -eq $expected) }
}
$backupRoot = ''
if ($Apply) {
  $backupRoot = Join-Path $RuntimeRoot ('backups\runtime-control-plane-' + $now.ToString('yyyyMMdd-HHmmss'))
  foreach($row in $rows) {
    $source = Join-Path $sourceFull $row.file
    $target = Join-Path $formalFull $row.file
    $backup = Join-Path $backupRoot $row.file
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
      Copy-Item -LiteralPath $target -Destination $backup -Force
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
    $row.formalHashAfter = Hash $target
    $row.verified = $row.formalHashAfter -eq $row.sourceHash
    if (-not $row.verified) { throw "post_copy_hash_mismatch:$($row.file)" }
  }
}
$ok = @($rows | Where-Object { -not $_.verified }).Count -eq 0
$status = if ($ok) { 'PASS' } elseif ($Apply) { 'FAIL_CLOSED' } else { 'BLOCKED' }
$receipt = [ordered]@{
  ok=$ok
  status=$status
  contract='approved-runtime-control-plane-cutover-v1'
  mode=if($Apply){'apply'}else{'dry_run'}
  checkedAt=(Get-Date).ToString('o')
  sourceRoot=$sourceFull
  formalRoot=$formalFull
  sourceSha=$sourceSha
  windowAllowed=$windowAllowed
  backupRoot=$backupRoot
  taskDefinitionsChanged=$false
  strategyRunStarted=$false
  deploymentStarted=$false
  files=$rows
}
$receiptDir = Join-Path $RuntimeRoot 'data\scan-receipts'
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
$receiptFile = Join-Path $receiptDir ('runtime-control-plane-cutover-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.json')
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptFile -Encoding utf8
$receipt | ConvertTo-Json -Depth 6
if (-not $ok) { exit 3 }
