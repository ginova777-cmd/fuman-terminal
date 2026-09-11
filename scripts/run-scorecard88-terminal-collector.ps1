param(
  [Parameter(Mandatory=$true)][ValidateSet('12:40','13:15','17:00','21:40')][string]$Slot,
  [string]$ProjectRoot = 'C:\fuman-release-owner\fuman-terminal',
  [string]$RuntimeRoot = 'C:\fuman-runtime',
  [switch]$Recovery,
  [string]$ExpectedRunId = '',
  [string]$RecoveryReason = ''
)
$ErrorActionPreference = 'Stop'
$env:FUMAN_RUNTIME_ROOT = $RuntimeRoot
$env:FUMAN_RUNTIME_DIR = $RuntimeRoot
$surfaceEvidence = Join-Path $ProjectRoot 'scripts\collect-scorecard88-terminal-surface-evidence.js'
$script = Join-Path $ProjectRoot 'scripts\collect-terminal-scorecard-88.js'
$verifier = Join-Path $ProjectRoot 'scripts\verify-scorecard88-collection.js'
if (-not (Test-Path -LiteralPath $surfaceEvidence)) { throw "surface_evidence_collector_missing:$surfaceEvidence" }
if (-not (Test-Path -LiteralPath $script)) { throw "collector_missing:$script" }
if (-not (Test-Path -LiteralPath $verifier)) { throw "canonical_verifier_missing:$verifier" }
$surfaceArgs = @("--slot=$Slot")
$recoveryKey = ''
if ($Recovery) {
  if ($ExpectedRunId -match '^institution-\d{8}-\d{14}$') { $recoveryKey = 'institution' }
  elseif ($ExpectedRunId -match '^strategy5-\d{8}-\d{14}$') { $recoveryKey = 'strategy5' }
  elseif ($ExpectedRunId -match '^strategy4-\d{8}-\d{14}$') { $recoveryKey = 'strategy4' }
  elseif ($ExpectedRunId -match '^strategy3v2-(?:recovery-replay-)?\d{8}-\d{14}$') { $recoveryKey = 'strategy3' }
  if ($recoveryKey) { $surfaceArgs += "--only=$recoveryKey" }
}
& node $surfaceEvidence @surfaceArgs
$surfaceEvidenceExit = $LASTEXITCODE
$collectorArgs = @("--slot=$Slot")
if ($Recovery) { $collectorArgs += @('--recovery', "--expected-run-id=$ExpectedRunId", "--recovery-reason=$RecoveryReason") }
& node $script @collectorArgs
$collectorExit = $LASTEXITCODE
if ($collectorExit -notin @(0,3)) { exit $collectorExit }
if ($surfaceEvidenceExit -notin @(0,3)) { exit $surfaceEvidenceExit }
& node $verifier "--slot=$Slot"
$verifierExit = $LASTEXITCODE
if ($verifierExit -ne 0) { exit $verifierExit }
if ($collectorExit -eq 3 -or $surfaceEvidenceExit -eq 3) { exit 3 }
if ($Slot -eq '13:15' -and $ExpectedRunId -notmatch '^strategy3v2-recovery-replay-') {
  $todayKey = Get-Date -Format 'yyyyMMdd'
  $collectionReceiptPath = Join-Path $RuntimeRoot "data\scan-receipts\scorecard88-collection-$todayKey-1315.json"
  $collectionReceipt = Get-Content -LiteralPath $collectionReceiptPath -Raw | ConvertFrom-Json
  $strategy3Report = @($collectionReceipt.reports | Where-Object { $_.key -eq 'strategy3' }) | Select-Object -First 1
  if ($collectionReceipt.ok -ne $true -or $strategy3Report.ok -ne $true -or [string]::IsNullOrWhiteSpace([string]$strategy3Report.runId)) { throw 'strategy3_scorecard_collection_not_complete' }
  $strategy3RunId = [string]$strategy3Report.runId
  $logDir = Join-Path $RuntimeRoot 'logs'
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $logPath = Join-Path $logDir "strategy3-final-closure-$todayKey.log"
  . (Join-Path $ProjectRoot 'verify-post-scan-tri-surface.ps1')
  Assert-PostScanTriSurfaceClosure -Route 'strategy3' -RunId $strategy3RunId -LogPath $logPath -SkipPublication | Out-Null
  & node (Join-Path $ProjectRoot 'scripts\verify-strategy3-v2-daily-unattended-closure.js') "--trade-date=$((Get-Date).ToString('yyyy-MM-dd'))"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $scan = Get-Content -LiteralPath (Join-Path $RuntimeRoot "data\scan-receipts\strategy3-v2-complete-scan-$todayKey.json") -Raw | ConvertFrom-Json
  & node (Join-Path $ProjectRoot 'scripts\verify-terminal-ui-e2e.js') --only=desktop-night,mobile-phone-portrait-night --routes=strategy3 --skip-watchlist --require-content --include-scorecard "--out=$RuntimeRoot\data\strategy3-ui" "--expected-run-id=$strategy3RunId" "--expected-symbols=$((@($scan.results | ForEach-Object {$_.code}) -join ','))" --route-timeout=120000 --eval-timeout=60000
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & node (Join-Path $ProjectRoot 'scripts\verify-strategy3-delivery.js')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & node (Join-Path $ProjectRoot 'scripts\finalize-strategy3-complete.js')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
exit 0
