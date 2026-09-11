param(
  [ValidateSet("Complete", "Status")][string]$Mode = "Complete",
  [switch]$PushLine,
  [switch]$Recovery,
  [switch]$RecoveryReplay,
  [switch]$RescanRecoveryReplay
)
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath $PSScriptRoot
$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtime
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node.exe" }
$pwshExe = (Get-Process -Id $PID).Path
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("strategy3-complete-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
function Invoke-Required([string]$Name, [scriptblock]$Action) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Name)
  & $Action 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw ("{0}_failed_exit_{1}" -f $Name, $LASTEXITCODE) }
}
if ($Mode -eq "Status") {
  $statusArgs = @('--status-only')
  if ($RecoveryReplay) { $statusArgs += '--recovery-replay' }
  & $nodeExe "--use-system-ca" "scripts\finalize-strategy3-complete.js" @statusArgs
  exit $LASTEXITCODE
}
. "${PSScriptRoot}\schedule-guard.ps1"
if (-not $Recovery -and -not $RecoveryReplay) {
  Invoke-FumanWeekdayGuard -Label "Strategy3 V2 complete scan"
}
function Invoke-Strategy3ScorecardPrepare([string]$RunId, [int]$ExpectedCount) {
  $previousRefreshKey = $env:FUMAN_SCORECARD_REFRESH_KEY
  $previousRefreshRunId = $env:FUMAN_SCORECARD_REFRESH_RUN_ID
  try {
    $env:FUMAN_SCORECARD_REFRESH_KEY = "strategy3"
    $env:FUMAN_SCORECARD_REFRESH_RUN_ID = $RunId
    Invoke-Required "Strategy3 scorecard 13:15 source prepare" { & npm.cmd run scorecard:terminal-source }
  } finally {
    if ($null -ne $previousRefreshKey) { $env:FUMAN_SCORECARD_REFRESH_KEY = $previousRefreshKey } else { Remove-Item Env:FUMAN_SCORECARD_REFRESH_KEY -ErrorAction SilentlyContinue }
    if ($null -ne $previousRefreshRunId) { $env:FUMAN_SCORECARD_REFRESH_RUN_ID = $previousRefreshRunId } else { Remove-Item Env:FUMAN_SCORECARD_REFRESH_RUN_ID -ErrorAction SilentlyContinue }
  }
  $scorecardPath = Join-Path $runtime "data\scorecard-terminal-current.json"
  $scorecard = Get-Content -LiteralPath $scorecardPath -Raw | ConvertFrom-Json
  $report = @($scorecard.sourceReports | Where-Object { $_.key -eq "strategy3" }) | Select-Object -First 1
  $rows = @($scorecard.records | Where-Object { $_.strategy -eq "策略3隔日沖成績單" -and $_.record_date -eq (Get-Date -Format "yyyy-MM-dd") })
  if ([string]$report.runId -ne $RunId -or $report.ok -ne $true -or $rows.Count -ne $ExpectedCount) { throw "strategy3_scorecard_source_prepare_mismatch:runId=$($report.runId):rows=$($rows.Count):expected=$ExpectedCount" }
}
try {
  if ($RescanRecoveryReplay -and -not $RecoveryReplay) { throw "rescan_requires_recovery_replay_mode" }
  Invoke-Required "release root authority" { & npm.cmd run verify:release-root-authority }
  Invoke-Required "source incident gate" { & npm.cmd run supabase:incident:check -- --class=guard --action=strategy3-delivery }
  if ($RecoveryReplay) {
    if ($Recovery) { throw "recovery_modes_are_mutually_exclusive" }
    $compactDate = Get-Date -Format yyyyMMdd
    if ($RescanRecoveryReplay) {
      Invoke-Required "full recovery scan and DB apply" { & $nodeExe --use-system-ca scripts\run-strategy3-v2-complete-scan.js --apply --recovery-replay }
    }
    $scanPath = Join-Path $runtime "data\scan-receipts\strategy3-v2-recovery-replay-$compactDate.json"
    $scan = Get-Content -LiteralPath $scanPath -Raw | ConvertFrom-Json
    if ($scan.ok -ne $true -or $scan.status -ne 'RECOVERY_REPLAY_COMPLETE' -or $scan.apply -ne $true -or $scan.trade_date -ne (Get-Date -Format yyyy-MM-dd)) { throw 'recovery_scan_not_publishable' }
    Invoke-Required "water contract" { & $nodeExe --use-system-ca scripts\verify-strategy3-v2-water-universe.js --recovery-replay }
    Invoke-Required "desktop refresh" { & $pwshExe -NoProfile -File .\refresh-desktop-route-snapshot.ps1 -Source strategy3 }
    Invoke-Required "mobile refresh" { & $nodeExe --use-system-ca scripts\publish-mobile-fragment-snapshots.js --tabs=strategy3 }
    Invoke-Required "surface readback" { & $nodeExe --use-system-ca scripts\verify-strategy3-v2-surface-closure.js --write-receipt }
    Invoke-Required "bridge authority" { & $nodeExe --use-system-ca scripts\verify-strategy3-mother-pool-warmup-authority.js }
    Invoke-Required "recovery authoritative DB verifier" { & $nodeExe --use-system-ca scripts\verify-strategy3-recovery-replay-complete.js }
    Invoke-Strategy3ScorecardPrepare -RunId $scan.run_id -ExpectedCount $scan.result_count
    Invoke-Required "88 audited recovery collection" { & $pwshExe -NoProfile -File scripts\run-scorecard88-terminal-collector.ps1 -Slot '13:15' -ProjectRoot $PSScriptRoot -RuntimeRoot $runtime -Recovery -ExpectedRunId $scan.run_id -RecoveryReason 'strategy3_recovery_replay_delivery' }
    . (Join-Path $PSScriptRoot "verify-post-scan-tri-surface.ps1")
    Invoke-Required "strict API desktop mobile 88 readback" { Assert-PostScanTriSurfaceClosure -Route strategy3 -RunId $scan.run_id -LogPath $log -SkipPublication | Out-Null }
    if (-not $PushLine) { throw 'line_push_authorization_required:rerun_with_-PushLine' }
    Invoke-Required "rendered desktop and mobile UI" { & npm.cmd run verify:terminal-ui-e2e -- --base-url=https://fuman-terminal.vercel.app --only=desktop-night,mobile-phone-portrait-night --routes=strategy3 --skip-watchlist --require-content --include-scorecard "--out=$runtime\data\strategy3-ui" "--expected-run-id=$($scan.run_id)" "--expected-symbols=$((@($scan.results | ForEach-Object {$_.code}) -join ','))" --route-timeout=120000 --eval-timeout=60000 }
    Invoke-Required "LINE preview" { & $nodeExe --use-system-ca scripts\send-strategy3-v2-line-card.js --recovery-replay --dry-run }
    Invoke-Required "LINE delivery with deduplication" { & $nodeExe --use-system-ca scripts\send-strategy3-v2-line-card.js --recovery-replay }
    Invoke-Required "complete delivery verifier" { & $nodeExe --use-system-ca scripts\verify-strategy3-delivery.js --recovery-replay }
    Invoke-Required "independent recovery final receipt" { & $nodeExe --use-system-ca scripts\finalize-strategy3-complete.js --recovery-replay }
    exit 0
  }
  if ($Recovery) {
    $compactDate = Get-Date -Format "yyyyMMdd"
    $scanPath = Join-Path $runtime "data\scan-receipts\strategy3-v2-complete-scan-$compactDate.json"
    $linePath = Join-Path $runtime "data\line-cards\strategy3-v2-line-card-$compactDate.json"
    if (-not (Test-Path -LiteralPath $scanPath)) { throw "strategy3_recovery_scan_receipt_missing:$scanPath" }
    if (-not (Test-Path -LiteralPath $linePath)) { throw "strategy3_recovery_line_receipt_missing:$linePath" }
    $scanReceipt = Get-Content -LiteralPath $scanPath -Raw | ConvertFrom-Json
    $lineReceipt = Get-Content -LiteralPath $linePath -Raw | ConvertFrom-Json
    if ($scanReceipt.ok -ne $true -or [string]$scanReceipt.status -ne "COMPLETE" -or $scanReceipt.apply -ne $true) { throw "strategy3_recovery_requires_complete_applied_scan" }
    if ($lineReceipt.ok -ne $true -or [string]$lineReceipt.status -ne "PUSHED" -or $lineReceipt.line_push_personal_ok -ne $true -or $lineReceipt.line_push_group_ok -ne $true) { throw "strategy3_recovery_requires_delivered_line_evidence" }
    if ([string]$scanReceipt.run_id -ne [string]$lineReceipt.run_id) { throw "strategy3_recovery_runid_mismatch" }
    if ([int]$scanReceipt.result_count -ne [int]$lineReceipt.count) { throw "strategy3_recovery_count_mismatch" }
    Write-Host ("Recovery reuses runId={0} count={1}; scan and LINE push are not repeated." -f $scanReceipt.run_id, $scanReceipt.result_count)
    Invoke-Required "water universe verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-water-universe.js" }
    Invoke-Strategy3ScorecardPrepare -RunId ([string]$scanReceipt.run_id) -ExpectedCount ([int]$scanReceipt.result_count)
    . "${PSScriptRoot}\verify-post-scan-tri-surface.ps1"
    Invoke-Required "strict API/desktop/mobile/scorecard closure" { Assert-PostScanTriSurfaceClosure -Route "strategy3" -RunId ([string]$scanReceipt.run_id) -LogPath $log | Out-Null }
    Invoke-Required "daily unattended verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-daily-unattended-closure.js" }
    Invoke-Required "complete delivery verifier" { & $nodeExe --use-system-ca scripts\verify-strategy3-delivery.js }
    Invoke-Required "canonical final receipt" { & $nodeExe "--use-system-ca" "scripts\finalize-strategy3-complete.js" }
    exit 0
  }
  Invoke-Required "12:30 readiness evidence" { & $pwshExe -NoProfile -File ".\run-strategy3-v2-readiness-guard.ps1" -Phase 1230 }
  Invoke-Required "12:50 readiness evidence" { & $pwshExe -NoProfile -File ".\run-strategy3-v2-readiness-guard.ps1" -Phase 1250 }
  Invoke-Required "12:55 fail-closed evidence" { & $pwshExe -NoProfile -File ".\run-strategy3-v2-1255-first-attempt.ps1" }
  Invoke-Required "formal V2 scan and database apply" { & $nodeExe "--use-system-ca" "scripts\run-strategy3-v2-complete-scan.js" "--apply" }
  Invoke-Required "water universe verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-water-universe.js" }
  Invoke-Required "desktop snapshot refresh" { & $pwshExe -NoProfile -File ".\refresh-desktop-route-snapshot.ps1" -Source strategy3 }
  Invoke-Required "mobile snapshot refresh" { & $nodeExe "--use-system-ca" "scripts\publish-mobile-fragment-snapshots.js" "--tabs=strategy3" }
  Invoke-Required "three-surface verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-surface-closure.js" }
  Invoke-Required "LINE card contract dry run" { & $nodeExe "--use-system-ca" "scripts\send-strategy3-v2-line-card.js" "--dry-run" }
  if (-not $PushLine) { throw "line_push_authorization_required:rerun_with_-PushLine" }
  Invoke-Required "LINE personal and group push" { & $nodeExe "--use-system-ca" "scripts\send-strategy3-v2-line-card.js" }
  Invoke-Required "daily unattended verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-daily-unattended-closure.js" }
  $scanReceipt = Get-Content -LiteralPath (Join-Path $runtime ("data\scan-receipts\strategy3-v2-complete-scan-{0}.json" -f (Get-Date -Format "yyyyMMdd"))) -Raw | ConvertFrom-Json
  Invoke-Strategy3ScorecardPrepare -RunId ([string]$scanReceipt.run_id) -ExpectedCount ([int]$scanReceipt.result_count)
  Invoke-Required "canonical receipt awaiting fixed 13:15 scorecard collection" { & $nodeExe "--use-system-ca" "scripts\finalize-strategy3-complete.js" "--awaiting-scorecard" }
  exit 0
} catch {
  $failureReason = $_.Exception.Message
  Write-Host $failureReason
  if ($RecoveryReplay) { & $nodeExe --use-system-ca scripts\finalize-strategy3-complete.js --record-failure --recovery-replay "--failure-reason=$failureReason" } else { & $nodeExe --use-system-ca scripts\finalize-strategy3-complete.js --record-failure "--failure-reason=$failureReason" }
  exit 1
}
