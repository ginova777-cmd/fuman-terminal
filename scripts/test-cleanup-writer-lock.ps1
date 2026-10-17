$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'cleanup-writer-lock.ps1')
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('cleanup-writer-lock-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$lease=Enter-FumanCleanupWriterLock -StateDirectory $fixture
try {
  $childScript=Join-Path $fixture 'contender.ps1'
  @'
param($Helper,$State)
. $Helper
try { $lease=Enter-FumanCleanupWriterLock -StateDirectory $State; $lease.Dispose(); exit 0 }
catch { if ($_.Exception.Message -eq 'cleanup_writer_round_active_stop') { exit 23 }; throw }
'@ | Set-Content -LiteralPath $childScript -Encoding utf8
  & pwsh -NoProfile -File $childScript (Join-Path $PSScriptRoot 'cleanup-writer-lock.ps1') $fixture
  if ($LASTEXITCODE -ne 23) { throw 'cross_process_exclusion_failed' }
} finally { $lease.Dispose() }
& pwsh -NoProfile -File $childScript (Join-Path $PSScriptRoot 'cleanup-writer-lock.ps1') $fixture
if ($LASTEXITCODE -ne 0) { throw 'lease_not_released' }
@{ok=$true;scope='isolated_two_process_windows_file_lease';blockedWhileHeld=$true;releasedAfterFinally=$true;productionAccess=$false;fixture=$fixture} | ConvertTo-Json -Compress
