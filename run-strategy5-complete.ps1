param([ValidateSet("Complete", "Status", "Recovery")][string]$Mode = "Complete", [string]$ReplayTradeDate = "", [string]$ExpectedRunId = "")
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath $PSScriptRoot
$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtime
$marketMode = if ($ReplayTradeDate) { "recovery_replay" } elseif ($Mode -eq "Recovery") { "recovery" } else { "natural" }
$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node.exe" }
$pwshExe = (Get-Process -Id $PID).Path
$env:FUMAN_REPLAY_TRADE_DATE = $ReplayTradeDate
$env:FUMAN_STRATEGY5_REPLAY_VALIDATED = '0'
. "$PSScriptRoot\schedule-guard.ps1"
$log = Join-Path $runtime ("logs\strategy5-complete-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$attemptFile = Join-Path $runtime 'data/scan-receipts/strategy5-complete-attempt.json'
$script:step = 'initialization'
$startedAt = (Get-Date).ToString('o')
$resultExit = 1
$attemptStatus = 'failed'
$scanExecuted = $false
$marketEvidence = $null
$failureReason = 'strategy5_attempt_interrupted'
function Invoke-CompleteStep {
  param([string]$Name, [string]$Exe, [string[]]$Arguments)
  $script:step = $Name
  Write-Host "[strategy5-complete] START step=$Name"
  & $Exe @Arguments
  $code = $LASTEXITCODE
  Write-Host "[strategy5-complete] END step=$Name exit=$code"
  if ($code -ne 0) { throw "strategy5_complete_step_failed:$Name exit=$code" }
}
Start-Transcript -LiteralPath $log -Append | Out-Null
try {
  if (-not $ReplayTradeDate) {
    $script:step = 'market-status'
    $decisionOutput = & (Join-Path $PSScriptRoot 'scripts\invoke-market-status-guard.ps1') -Stage 'strategy5' -TradeDate '' -ExecutionMode $marketMode
    $decisionExit = $LASTEXITCODE
    if ($decisionExit -eq 10) {
      $marketEvidence = ($decisionOutput -join "`n") | ConvertFrom-Json -AsHashtable
      if ($marketEvidence.status -ne 'SKIPPED' -or $marketEvidence.scanExecuted -ne $false -or $marketEvidence.stage -ne 'strategy5' -or -not $marketEvidence.marketReceipt) { throw 'strategy5_market_skip_unverified' }
      $attemptStatus = 'SKIPPED'; $resultExit = 0; $failureReason = $null
      return
    }
    if ($decisionExit -ne 0) { $attemptStatus = 'BLOCKED'; throw "strategy5_market_status_unverified:exit=$decisionExit" }
  }
  if ($Mode -eq 'Status') { Invoke-CompleteStep 'status' $nodeExe @('scripts\verify-strategy5-complete.js'); $attemptStatus = 'VERIFIED'; $resultExit = 0; return }
  if ($ReplayTradeDate) {
    Invoke-CompleteStep 'replay-date' $nodeExe @('--use-system-ca','scripts/verify-institution-replay-date.js',$ReplayTradeDate)
    $env:FUMAN_STRATEGY5_REPLAY_VALIDATED = '1'
    $env:FUMAN_SCANNER_TARGET_TRADE_DATE = $ReplayTradeDate
    $env:FUMAN_TERMINAL_TARGET_TRADE_DATE = $ReplayTradeDate
    $env:FUMAN_SCORECARD_TRADE_DATE = $ReplayTradeDate
  }
  # The authoritative market guard above handles natural admission explicitly.
  # Do not call an exit-based legacy guard inside try/finally: its exit 0 used
  # to write a failed attempt. Replay is admitted only by replay-date validation.
  Invoke-CompleteStep 'release-authority' $nodeExe @('scripts/verify-release-root-authority.js','--require-production-root')
  if ($Mode -eq 'Recovery') {
    $script:step = 'exact-run-recovery'
    $scan = Get-Content (Join-Path $runtime 'data/scan-receipts/strategy5.json') -Raw | ConvertFrom-Json
    if (-not $ExpectedRunId -or $scan.runId -ne $ExpectedRunId -or -not $scan.complete -or $scan.status -ne 'complete' -or $scan.fallback) { throw 'strategy5_recovery_requires_exact_complete_run' }
  & $nodeExe --use-system-ca scripts/verify-strategy5-live-readback.js
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & "$PSScriptRoot/refresh-desktop-route-snapshot.ps1" -Source 'strategy5' -LogPath ($log + '.snapshot.log')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  try {
    $env:FUMAN_SCORECARD_REFRESH_KEY = 'strategy5'
    $env:FUMAN_SCORECARD_REFRESH_RUN_ID = $ExpectedRunId
    & npm.cmd run scorecard:terminal-source
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $nodeExe --use-system-ca scripts/publish-strategy5-scorecard-source-report.js "--expected-run-id=$ExpectedRunId" "--expected-date=$($scan.marketDate)"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Remove-Item Env:FUMAN_SCORECARD_REFRESH_KEY, Env:FUMAN_SCORECARD_REFRESH_RUN_ID -ErrorAction SilentlyContinue
  }
  } else {
    Invoke-CompleteStep 'chip-source-sync' $pwshExe @('-NoProfile','-File','.\run-chip-source-sync.ps1')
    Invoke-CompleteStep 'composite-producers' $nodeExe @('scripts/verify-strategy5-composite-producers.js')
    $scanExecuted = $true
    Invoke-CompleteStep 'full-scan' $pwshExe @('-NoProfile','-File','.\run-strategy5.ps1')
    $scan = Get-Content (Join-Path $runtime 'data/scan-receipts/strategy5.json') -Raw | ConvertFrom-Json
    if (-not $scan.runId -or -not $scan.complete -or $scan.status -ne 'complete' -or $scan.exitCode -ne 0 -or $scan.fallback) { throw 'strategy5_collection_requires_complete_run' }
    $ExpectedRunId = [string]$scan.runId
    Invoke-CompleteStep 'pre-collection-readback' $nodeExe @('--use-system-ca','scripts/verify-strategy5-live-readback.js')
  }
  # Both modes require canonical publication. This audited exact-run collection
  # does not claim that the later 21:40 scheduled slot already executed.
  Invoke-CompleteStep 'canonical-scorecard-collection' $pwshExe @('-NoProfile','-File',"$PSScriptRoot/scripts/run-scorecard88-terminal-collector.ps1",'-Slot','21:40','-ProjectRoot',$PSScriptRoot,'-RuntimeRoot',$runtime,'-Recovery','-ExpectedRunId',$ExpectedRunId,'-RecoveryReason','strategy5-verified-post-scan-canonical-publication')
  Invoke-CompleteStep 'scorecard-audit' $nodeExe @('--use-system-ca','scripts/publish-scorecard-scan-audit.js')
  Invoke-CompleteStep 'db-and-rendered-readback' $nodeExe @('--use-system-ca','scripts/verify-strategy5-live-readback.js','--render')
  Invoke-CompleteStep 'canonical-receipt' $nodeExe @('scripts/verify-strategy5-complete.js','--write-receipt')
  $resultExit = 0
  $attemptStatus = 'complete'
} catch {
  Write-Host "[strategy5-complete] FAILED step=$script:step reason=$($_.Exception.Message)"
  $failureReason = $_.Exception.Message
} finally {
  $scanNow = $null
  try { $scanNow = Get-Content (Join-Path $runtime 'data/scan-receipts/strategy5.json') -Raw | ConvertFrom-Json } catch {}
  $attempt = @{
    contract='strategy5-complete-attempt-v1'; mode=$Mode; startedAt=$startedAt; finishedAt=(Get-Date).ToString('o')
    expectedRunId=$ExpectedRunId; runId=$(if ($attemptStatus -eq 'SKIPPED') {$marketEvidence.runId} elseif ($ExpectedRunId) {$ExpectedRunId} else {''}); sourceTradeDate=$(if ($ExpectedRunId -and $scanNow.runId -eq $ExpectedRunId) {$scanNow.marketDate} else {$null}); step=$script:step
    status=$attemptStatus; complete=($attemptStatus -eq 'complete'); exitCode=$resultExit; scanExecuted=$scanExecuted
    evaluationComplete=($resultExit -eq 0); marketEvidence=$marketEvidence
    firstBlocker=$(if ($resultExit -eq 0) {$null} else {$failureReason}); log=$log
  }
  $history = Join-Path $runtime 'data/scan-receipts/history/strategy5-complete-attempts'
  New-Item -ItemType Directory -Force -Path $history | Out-Null
  if (Test-Path -LiteralPath $attemptFile) { Copy-Item -LiteralPath $attemptFile -Destination (Join-Path $history (([guid]::NewGuid().ToString('N')) + '-previous.json')) }
  $attempt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $attemptFile -Encoding utf8
  Copy-Item -LiteralPath $attemptFile -Destination (Join-Path $history (([guid]::NewGuid().ToString('N')) + '.json'))
  Stop-Transcript | Out-Null
}
exit $resultExit
