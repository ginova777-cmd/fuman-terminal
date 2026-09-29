param(
  [ValidateSet("us_0820", "asia_0850")][string]$Stage = "us_0820",
  [switch]$IsolatedBacktest,
  [switch]$ReuseLineReceipt,
  [switch]$FinalizeExisting,
  [switch]$ResumeEvidence,
  [string]$RecoveryContext
)

$ErrorActionPreference = "Stop"
$env:FUMAN_MORNING_STAGE = $Stage
$PSNativeCommandUseErrorActionPreference = $false
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$RuntimeDir = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $RuntimeDir
$env:FUMAN_DATA_DIR = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $RuntimeDir "data" }
$env:FUMAN_STATE_DIR = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $RuntimeDir "state" }
$env:NODE_OPTIONS = "--use-system-ca"

$logDir = Join-Path $RuntimeDir "logs"
$receiptDir = Join-Path $RuntimeDir "data\opening-report-stages\$Stage"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir | Out-Null
$nowTaipei = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Taipei Standard Time")
$today = $nowTaipei.ToString("yyyyMMdd")
$tradeDate = $nowTaipei.ToString("yyyy-MM-dd")
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runId = "opening-report-0830-$today-$Stage-$stamp"
if ($RecoveryContext) {
  $recovery = Get-Content -LiteralPath $RecoveryContext -Raw | ConvertFrom-Json
  if ($recovery.trade_date -ne $tradeDate) { throw "Recovery date mismatch" }
  $env:FUMAN_MORNING_RECOVERY_CONTEXT = $RecoveryContext
  $runId = $recovery.run_id
}
$wrapperReceipt = Join-Path $receiptDir "opening-report-0830-wrapper-receipt-$today.json"

function Invoke-MorningAggregate {
  if ($IsolatedBacktest) { return }
  & "C:\Program Files\nodejs\node.exe" "scripts\verify-opening-report-two-stage.js" "--date=$tradeDate" "--if-ready"
  # Per-stage completion remains separate from aggregate completion. Preserve
  # failures in the aggregate receipt; the evidence-only retry task can resume.
  if ($LASTEXITCODE -ne 0) { Write-Warning "Morning two-stage aggregate remains blocked; inspect its receipt." }
}

trap {
  if ($wrapperReceipt) {
    [ordered]@{contract="opening-report-morning-wrapper-v1"; status="failed"; complete=$false; exitCode=1; first_blocker=$_.Exception.Message; trade_date=$tradeDate; run_id=$runId; checked_at=(Get-Date).ToString("o"); execution_mode=if($RecoveryContext){"authorized_same_day_recovery"}else{"scheduled"}} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8
  }
  if (-not $IsolatedBacktest) { Invoke-MorningAggregate }
  Write-Error $_ -ErrorAction Continue
  exit 1
}
if ($FinalizeExisting) { $ReuseLineReceipt = [switch]$true }
if ($ReuseLineReceipt -or $ResumeEvidence) {
  $existingLinePath = Join-Path $receiptDir "line-push-receipt-$today.json"
  if (-not (Test-Path -LiteralPath $existingLinePath)) { throw "Cannot reuse missing LINE receipt: $existingLinePath" }
  $existingLine = Get-Content -LiteralPath $existingLinePath -Raw | ConvertFrom-Json
  $existingRunId = [string]($existingLine.report_run_id)
  if ([string]::IsNullOrWhiteSpace($existingRunId) -or (-not $ResumeEvidence -and $existingLine.line_push_ok -ne $true)) { throw "Cannot reuse incomplete LINE receipt: $existingLinePath" }
  $runId = $existingRunId
}

# Every formal entry point owns its market-calendar guard. Do not rely on the
# unified source freeze to protect direct entry points.
if (-not $IsolatedBacktest) {
  $calendarOutput = & "C:\Program Files\nodejs\node.exe" "scripts\check-market-calendar-action.js" "--date=$tradeDate" "--label=Opening-report-0830-wrapper" 2>&1
  $calendarExit = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  $calendar = $null
  try { $calendar = (($calendarOutput | Out-String).Trim() | ConvertFrom-Json) } catch { $calendar = $null }
  if ($calendarExit -eq 10 -or ($null -ne $calendar -and $calendar.marketOpen -eq $false)) {
    [ordered]@{
      contract = "opening-report-morning-wrapper-v1"
      stage = $Stage
      stage_contract = "opening-report-two-stage-v1"
      status = "skipped"
      ok = $true
      complete = $false
      reason_code = "market_calendar_non_trading_day"
      mode = "production"
      date = $today
      trade_date = $tradeDate
      run_id = $runId
      checked_at = (Get-Date).ToString("o")
      market_status = if ($null -ne $calendar) { [string]$calendar.marketStatus } else { "closed" }
      closed_reason = if ($null -ne $calendar) { [string]$calendar.closedReason } else { "market_closed" }
      formal_scan_skipped = $true
      latest_pointer_updated = $false
      line_push_attempted = $false
      terminal_snapshot_attempted = $false
      mother_pool_bridge_attempted = $false
      no_side_effects = $true
      steps = @()
      canonical_verifier = "scripts/verify-opening-report-morning-contract.js"
      telegram_enabled = $false
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8
    Invoke-MorningAggregate
    exit 0
  }
  if ($calendarExit -ne 0 -or $null -eq $calendar) {
    [ordered]@{
      contract = "opening-report-morning-wrapper-v1"
      stage = $Stage
      stage_contract = "opening-report-two-stage-v1"
      status = "fail_closed"
      ok = $false
      complete = $false
      reason_code = "market_calendar_guard_failed"
      mode = "production"
      date = $today
      trade_date = $tradeDate
      run_id = $runId
      checked_at = (Get-Date).ToString("o")
      formal_scan_skipped = $true
      latest_pointer_updated = $false
      line_push_attempted = $false
      terminal_snapshot_attempted = $false
      mother_pool_bridge_attempted = $false
      no_side_effects = $true
      calendar_exit_code = $calendarExit
      steps = @()
      canonical_verifier = "scripts/verify-opening-report-morning-contract.js"
      telegram_enabled = $false
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8
    Invoke-MorningAggregate
    exit 1
  }
}

if (-not $IsolatedBacktest) {
  & "C:\Program Files\nodejs\node.exe" "scripts\verify-opening-report-release.js"
  if ($LASTEXITCODE -ne 0) { throw "RELEASE_ROOT_DRIFT" }
  & "C:\Program Files\nodejs\node.exe" "scripts\supabase-incident-guard.js" check "--class=guard" "--action=opening-report-complete"
  if ($LASTEXITCODE -ne 0) { throw "morning_source_incident_blocked" }
}

if (-not $IsolatedBacktest) {
  if (Test-Path -LiteralPath $wrapperReceipt) {
    $startHistory = Join-Path $receiptDir "history"
    New-Item -ItemType Directory -Force -Path $startHistory | Out-Null
    Copy-Item -LiteralPath $wrapperReceipt -Destination (Join-Path $startHistory "wrapper-before-start-$today-$stamp-$([guid]::NewGuid()).json")
  }
  [ordered]@{contract="opening-report-morning-wrapper-v1";stage=$Stage;trade_date=$tradeDate;run_id=$runId;status="running";complete=$false;exitCode=$null;checked_at=(Get-Date).ToString("o");process_id=$PID} | ConvertTo-Json | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8
  Invoke-MorningAggregate
}

function Invoke-NodeStep {
  param([string[]]$NodeArgs, [string]$Label)
  $stdout = Join-Path $logDir "opening-report-0830-$today-$stamp.$Label.stdout.log"
  $stderr = Join-Path $logDir "opening-report-0830-$today-$stamp.$Label.stderr.log"
  & "C:\Program Files\nodejs\node.exe" @NodeArgs 1> $stdout 2> $stderr
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  return [pscustomobject]@{ label = $Label; exitCode = $exitCode; stdout = $stdout; stderr = $stderr }
}

# Formal contract: runner -> one canonical verifier -> wrapper receipt.
# LINE personal/group, terminal output, and Mother Pool bridge remain runner-owned.
$sourceFreeze = if ($IsolatedBacktest -or $ReuseLineReceipt -or $ResumeEvidence) { [pscustomobject]@{label="source-freeze-existing-or-isolated";exitCode=0;stdout="";stderr="";evidenceOnly=$true} } else { Invoke-NodeStep -NodeArgs @("scripts\run-opening-report-0830-preflight.js", "--wrapper-owned", "--date=$tradeDate", "--run-id=$runId") -Label "source-freeze-0830" }
$runnerArgs = @("scripts\run-opening-report-0830-production.js", "--apply-bridge", "--date=$tradeDate", "--run-id=$runId")
if ($IsolatedBacktest) { $runnerArgs += "--isolated-backtest" }
if ($ResumeEvidence) { $runnerArgs += "--resume-evidence" } elseif ($ReuseLineReceipt) { $runnerArgs += "--reuse-line-receipt" }
$run = if ($sourceFreeze.exitCode -ne 0) { [pscustomobject]@{label="runner-skipped-source-freeze-failed";exitCode=$sourceFreeze.exitCode;stdout="";stderr=""} } elseif ($FinalizeExisting) { [pscustomobject]@{ label="runner-existing-evidence"; exitCode=0; stdout=""; stderr=""; evidenceOnly=$true } } else { Invoke-NodeStep -NodeArgs $runnerArgs -Label "runner" }
$currentDataFile = Join-Path $receiptDir "opening-report-0830-final-receipt-$today.json"
$currentData = if(Test-Path -LiteralPath $currentDataFile){Get-Content -LiteralPath $currentDataFile -Raw|ConvertFrom-Json}else{$null}
$dataReady = ($sourceFreeze.exitCode -eq 0 -and $null -ne $currentData -and $currentData.run_id -eq $runId -and $currentData.overseas_sources_ok -eq $true -and $currentData.mother_pool_bridge_ok -eq $true -and $currentData.mother_pool_handoff_ack_ok -eq $true -and $currentData.terminal_briefing_snapshot.ok -eq $true)
$persistenceArgs = @("scripts\verify-opening-report-0830-mother-pool-persistence-ack.js", "--trade-date=$tradeDate", "--report-run-id=$runId")
if($ResumeEvidence){ $persistenceArgs += "--resume-evidence" }
$persistence = if ($dataReady -and -not $IsolatedBacktest) { Invoke-NodeStep -NodeArgs $persistenceArgs -Label "mother-pool-persistence-ack" } elseif ($run.exitCode -eq 0) { [pscustomobject]@{ label = "mother-pool-persistence-ack"; exitCode = 0; stdout = ""; stderr = ""; simulated = $true } } else { [pscustomobject]@{ label = "mother-pool-persistence-ack"; exitCode = -1; stdout = ""; stderr = "" } }
$renderedArgs = @("scripts\verify-opening-report-rendered.js", "--trade-date=$tradeDate")
$rendered = if ($dataReady -and $persistence.exitCode -eq 0 -and -not $IsolatedBacktest) { Invoke-NodeStep -NodeArgs $renderedArgs -Label "rendered-delivery" } else { [pscustomobject]@{label="rendered-delivery";exitCode=-1;stdout="";stderr=""} }
$verifierArgs = @("scripts\verify-opening-report-morning-contract.js", "--trade-date=$tradeDate")
if (-not $IsolatedBacktest) { $verifierArgs += "--require-current" }
$verifier = if ($dataReady -and $persistence.exitCode -eq 0 -and ($IsolatedBacktest -or $rendered.exitCode -eq 0)) { Invoke-NodeStep -NodeArgs $verifierArgs -Label "canonical-verifier" } else { [pscustomobject]@{ label = "canonical-verifier"; exitCode = -1; stdout = ""; stderr = "" } }

$finalFile = Join-Path $receiptDir "opening-report-0830-final-receipt-$today.json"
$final = if (Test-Path -LiteralPath $finalFile) { Get-Content -LiteralPath $finalFile -Raw | ConvertFrom-Json } else { $null }
$lineFile = Join-Path $receiptDir "line-push-receipt-$today.json"
$line = if (Test-Path -LiteralPath $lineFile) { Get-Content -LiteralPath $lineFile -Raw | ConvertFrom-Json } else { $null }
$runnerOk = ($run.exitCode -eq 0 -and $null -ne $final -and $final.runner_complete -eq $true -and $final.run_id -eq $runId -and $final.date -eq $tradeDate)
$verifierOk = ($verifier.exitCode -eq 0)
$linePersonalOk = ($null -ne $line -and $line.line_push_ok -eq $true -and $line.has_user_target -eq $true)
$lineGroupOk = ($null -ne $line -and $line.line_push_ok -eq $true -and $line.has_group_target -eq $true)
$notificationAccepted = ($linePersonalOk -and $lineGroupOk) -or ($null -ne $final -and $final.notification_accepted -eq $true -and ($null -ne $final.line_quota_exception -or ($final.notification_status -eq 'paused_by_user' -and $final.completion_scope -eq 'tri_surface')) -and $verifierOk)
$terminalOk = ($null -ne $final -and $final.terminal_briefing_snapshot.ok -eq $true)
$bridgeOk = ($null -ne $final -and $final.mother_pool_bridge_attempted -eq $true -and $final.mother_pool_bridge_ok -eq $true)
$handoffAckOk = ($null -ne $final -and $final.mother_pool_handoff_ack_ok -eq $true -and $final.mother_pool_handoff_ack.complete -eq $true)
$persistenceAckOk = if ($IsolatedBacktest) { $true } else { ($persistence.exitCode -eq 0 -and $null -ne $final -and $final.mother_pool_persistence_ack_ok -eq $true -and $final.mother_pool_persistence_ack.complete -eq $true) }
$expected = if ($null -ne $final -and $null -ne $final.expected_industry_count) { [int]$final.expected_industry_count } else { 0 }
$scanned = if ($null -ne $final -and $null -ne $final.scanned_industry_count) { [int]$final.scanned_industry_count } else { 0 }
$ok = ($runnerOk -and $persistenceAckOk -and $verifierOk -and $notificationAccepted -and $terminalOk -and $bridgeOk -and $handoffAckOk -and $expected -eq 15 -and $scanned -eq 15)
$reasonCode = if ($ok) { "complete" } elseif ($sourceFreeze.exitCode -ne 0) { "source_freeze_0830_failed" } elseif (-not $runnerOk) { "runner_failed" } elseif (-not $handoffAckOk) { "mother_pool_handoff_ack_incomplete" } elseif (-not $persistenceAckOk) { "mother_pool_persistence_ack_incomplete" } elseif (-not $IsolatedBacktest -and $rendered.exitCode -ne 0) { "rendered_delivery_failed" } elseif (-not $verifierOk) { "canonical_verifier_failed" } elseif (-not ($linePersonalOk -and $lineGroupOk)) { "line_delivery_incomplete" } elseif (-not $terminalOk) { "terminal_delivery_incomplete" } elseif (-not $bridgeOk) { "mother_pool_bridge_incomplete" } else { "industry_scan_incomplete" }

$receipt = [ordered]@{
  contract = "opening-report-morning-wrapper-v1"
      stage = $Stage
      stage_contract = "opening-report-two-stage-v1"
  status = if ($ok) { "complete" } else { "failed" }
  complete = $ok
  ok = $ok
  exitCode = if ($ok) { 0 } else { 1 }
  first_blocker = if ($ok) { $null } else { $reasonCode }
  reason_code = $reasonCode
  mode = if ($IsolatedBacktest) { "isolated_backtest" } else { "production" }
  date = $today
  trade_date = $tradeDate
  run_id = $runId
  checked_at = (Get-Date).ToString("o")
  expected_industry_count = $expected
  scanned_industry_count = $scanned
  line_personal_ok = $linePersonalOk
  line_group_ok = $lineGroupOk
  notification_accepted = $notificationAccepted
  completion_scope = if ($null -ne $final) { $final.completion_scope } else { $null }
  notification_status = if ($null -ne $final) { $final.notification_status } else { $null }
  line_delivered = ($linePersonalOk -and $lineGroupOk)
  line_quota_exception = if($null -ne $final){$final.line_quota_exception}else{$null}
  line_receipt_reused = ($ReuseLineReceipt.IsPresent -or $ResumeEvidence.IsPresent)
  line_push_attempted_in_this_run = ($null -ne $final -and $final.line_push_attempted -eq $true -and -not ($ReuseLineReceipt.IsPresent -or $ResumeEvidence.IsPresent -or $FinalizeExisting.IsPresent -or $IsolatedBacktest.IsPresent))
  recovery = ($FinalizeExisting.IsPresent -or $ResumeEvidence.IsPresent -or [bool]$RecoveryContext)
  execution_mode = if ($RecoveryContext) { "authorized_same_day_recovery" } elseif ($ResumeEvidence) { "resume_existing_evidence" } else { "scheduled" }
  terminal_ok = $terminalOk
  mother_pool_bridge_ok = $bridgeOk
  mother_pool_handoff_ack_ok = $handoffAckOk
  mother_pool_handoff_ack_receipt = if ($null -ne $final) { $final.mother_pool_handoff_ack_receipt } else { $null }
  mother_pool_persistence_ack_ok = $persistenceAckOk
  mother_pool_persistence_ack_receipt = if ($null -ne $final) { $final.mother_pool_persistence_ack_receipt } else { $null }
  runner_ok = $runnerOk
  canonical_verifier_ok = $verifierOk
  rendered_delivery_ok = ($rendered.exitCode -eq 0)
  steps = @($sourceFreeze, $run, $persistence, $rendered, $verifier)
  canonical_verifier = "scripts/verify-opening-report-morning-contract.js"
  telegram_enabled = $false
}
if (Test-Path -LiteralPath $wrapperReceipt) {
  $archiveDir = Join-Path $receiptDir "history"
  New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
  Copy-Item -LiteralPath $wrapperReceipt -Destination (Join-Path $archiveDir "wrapper-$today-$stamp-$([guid]::NewGuid()).json")
}
if ($null -ne $final -and $final.run_id -eq $runId) {
  $final.complete = $ok -and -not $IsolatedBacktest
  $final.status = if ($final.complete) { "complete" } else { "failed" }
  $final.report_status = if ($final.complete) { "COMPLETE" } else { "FAIL_CLOSED" }
  $final.exitCode = if ($final.complete) { 0 } else { 1 }
  $final.first_blocker = if ($final.complete) { $null } else { $reasonCode }
  $final | Add-Member -Force -NotePropertyName canonical_verifier_ok -NotePropertyValue $verifierOk
  # Preserve hashed source timestamps exactly; PowerShell JSON date conversion changes their bytes.
  $finalPatch = [ordered]@{complete=$final.complete;status=$final.status;report_status=$final.report_status;exitCode=$final.exitCode;first_blocker=$final.first_blocker;canonical_verifier_ok=$verifierOk} | ConvertTo-Json -Compress
  & "C:\Program Files\nodejs\node.exe" -e 'const fs=require("fs");const p=process.argv[1];const v=JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));Object.assign(v,JSON.parse(process.argv[2]));fs.writeFileSync(p,JSON.stringify(v,null,2));' $finalFile $finalPatch
  if ($LASTEXITCODE -ne 0) { throw "final_receipt_serialization_failed" }
}
if ($IsolatedBacktest) { $receipt.complete = $false; $receipt.status = "isolated_backtest" }
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8
Invoke-MorningAggregate
if (-not $ok) { exit 1 }
exit 0
