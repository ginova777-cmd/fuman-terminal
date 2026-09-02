param(
  [string]$ProjectRoot = $PSScriptRoot,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [ValidateSet("Auto", "Checkpoint", "Full")]
  [string]$Mode = "Auto",
  [ValidatePattern("^$|^([01]\d|2[0-3]):[0-5]\d$")]
  [string]$RequestedCheckpoint = "",
  [switch]$RequireProtectedReadback
)

$ErrorActionPreference = "Stop"
$startedAt = Get-Date
$effectiveMode = $Mode
if ($effectiveMode -eq "Auto") {
  $effectiveMode = if ($startedAt.TimeOfDay -ge [TimeSpan]::Parse("23:10") -and $startedAt.TimeOfDay -lt [TimeSpan]::Parse("23:59")) { "Full" } else { "Checkpoint" }
}

$env:FUMAN_RUNTIME_DIR = $RuntimeRoot
$env:FUMAN_TERMINAL_DIR = $ProjectRoot
$checkpointId = if ($RequestedCheckpoint) { $RequestedCheckpoint } elseif ($effectiveMode -eq "Full") { "23:10" } else { $startedAt.ToString("HH:mm") }
$checkpointContracts = [ordered]@{
  "06:00" = @{ name="fugle_source_start"; verifiers=@("verify-daytrade-fugle-source-startup.js"); hardGate="unique_original_v2_collector_naturally_started" }
  "06:05" = @{ name="source_startup_guard"; verifiers=@("verify-daytrade-websocket-transport-readonly.js","verify-daytrade-fugle-source-startup.js","verify-daytrade-writer-checkpoint-health.js"); hardGate="writer_v2_transport_channels_today_cache_isolation" }
  "07:00" = @{ name="mother_pool_warmup"; verifiers=@("verify-daytrade-mother-pool-warmup-start.js"); hardGate="unique_original_warmup_task_naturally_started_no_formal_publish" }
  "07:08" = @{ name="warmup_closure"; verifiers=@("verify-daytrade-staged-warmup-checkpoint.js"); hardGate="pool_quote_1m_indicator_date_isolation" }
  "08:20" = @{ name="opening_report_external_owner_handoff"; owner="EXTERNAL_OWNER"; disposition="READ_ONLY_HANDOFF_VERIFICATION"; verifiers=@("verify-opening-report-0820-preflight.js"); hardGate="trading_day_external_owner_natural_0820_frozen_evidence_no_recalculation_retry_or_redelivery" }
  "08:29" = @{ name="opening_report_delivery_precheck"; owner="EXTERNAL_OWNER"; disposition="READ_ONLY_HANDOFF_VERIFICATION"; verifiers=@("verify-opening-report-0820-preflight.js","verify-opening-report-0830-contract.js"); hardGate="today_frozen_preflight_and_pre_delivery_contract_gate_complete_before_delivery" }
  "08:30" = @{ name="opening_report_formal_freeze"; owner="EXTERNAL_OWNER"; disposition="READ_ONLY_HANDOFF_VERIFICATION"; verifiers=@("verify-opening-report-0830-contract.js"); hardGate="single_today_formal_receipt_industry_ranking_priority_bias_only" }
  "08:35" = @{ name="opening_sort_bridge"; owner="EXTERNAL_OWNER"; disposition="READ_ONLY_BRIDGE"; verifiers=@("verify-opening-report-0830-priority-bias-bridge.js"); hardGate="today_frozen_industry_bias_json_no_overwrite" }
  "08:36" = @{ name="opening_report_bridge_closure"; owner="EXTERNAL_OWNER"; disposition="READ_ONLY_BRIDGE_CLOSURE"; verifiers=@("verify-opening-report-0830-priority-bias-bridge.js","verify-opening-report-0830-contract.js"); hardGate="same_day_bridge_aggregate_19_of_19_run_id_trade_date_and_allowed_action_no_recalculation_or_retry" }
  "08:40" = @{ name="opening_limit_order_natural_start"; verifiers=@("verify-opening-limit-order-operation-flow-contract.js","verify-opening-limit-order-0840-checkpoint-readonly.js"); hardGate="unique_original_0840_task_today_pre_candidates_upstream_evidence_no_order_formal_or_publish" }
  "08:45" = @{ name="preopen_master_gate"; verifiers=@("verify-daytrade-websocket-transport-readonly.js","verify-daytrade-source-contract-alignment.js","verify-daytrade-mother-pool-contract.js","verify-opening-limit-order-futopt-natural-evidence.js","verify-strategy2-v3-water.js"); hardGate="transport_pool_0845_futopt_trial_strategy2_formal_water_preflight_and_isolation" }
  "08:50" = @{ name="opening_limit_order_futopt_trial_second_stage"; verifiers=@("verify-opening-limit-order-futopt-natural-evidence.js"); hardGate="0845_0850_natural_futopt_trial_evidence_and_hard_reject" }
  "08:55" = @{ name="opening_limit_order_ranked_watchlist"; verifiers=@("verify-opening-limit-order-0855-readonly.js"); hardGate="ranked_watchlist_watch_at_open_only_no_order_formal_or_publish" }
  "09:00" = @{ name="intraday_operation"; verifiers=@("verify-daytrade-writer-checkpoint-health.js","verify-daytrade-mother-pool-contract.js","verify-opening-limit-order-closed-loop.js","verify-strategy2-v3-unified-contract.js","verify-daytrade-intraday-burst-telegram.js"); hardGate="writer_mother_pool_opening_second_confirmation_strategy2_unique_natural_start_and_event_only_telegram" }
  "12:30" = @{ name="strategy2_finalize"; verifiers=@("verify-strategy2-v3-live-closure.js"); hardGate="single_canonical_run_expected_scanned_result_data_gap_complete_publish_gate" }
  "12:40" = @{ name="strategy2_four_surface"; verifiers=@(); hardGate="desktop_mobile_api_88_same_run_deduplicated" }
  "12:50" = @{ name="strategy3_readiness"; verifiers=@("verify-strategy3-v2-readiness-guard-contract.js","verify-strategy3-v2-water-universe.js"); hardGate="v2_quote_1m_universe_no_legacy" }
  "12:55" = @{ name="strategy3_isolation_preflight"; verifiers=@("verify-strategy3-v2-1255-first-attempt.js","verify-strategy3-api-entry-immutability.js"); hardGate="no_supabase_telegram_surface_switch" }
  "13:00" = @{ name="strategy3_formal_scan"; verifiers=@("verify-strategy3-natural-start.js"); hardGate="unique_original_task_started_1259_1302_no_second_run" }
  "13:15" = @{ name="strategy3_closure"; verifiers=@("verify-strategy3-v2-full-closure.js","verify-terminal-row-audit-consistency.js"); hardGate="supabase_api_desktop_mobile_line_88_same_run_count_symbols_prices_scores" }
  "13:30" = @{ name="postclose_transition"; verifiers=@("verify-daytrade-writer-checkpoint-health.js","verify-daytrade-source-contract-alignment.js","verify-daytrade-postclose-1330.js"); hardGate="collector_writer_natural_completion_final_quote_1m_no_residual_lock_or_cross_day_rollback" }
  "15:35" = @{ name="strategy4_prewarm"; verifiers=@("verify-strategy4-prewarm-receipt.js","verify-strategy4-source-root.js"); hardGate="natural_prewarm_receipt_full_universe_latest_daily_ohlcv" }
  "16:00" = @{ name="strategy4_scan_start"; verifiers=@("verify-strategy4-scan-start.js"); hardGate="unique_original_scan_task_started_no_second_run" }
  "17:00" = @{ name="strategy4_closure"; verifiers=@("verify-strategy4-postscan-closure.js","verify-terminal-row-audit-consistency.js"); hardGate="supabase_api_desktop_mobile_88_same_run_count_symbols_prices_scores" }
  "17:10" = @{ name="cleanup_stage1"; verifiers=@("verify-cleanup-natural-completion.js","verify-cleanup-root-authority.js","verify-cleanup-stage-receipt.js"); hardGate="retired_api_runtime_artifact_receipt" }
  "17:40" = @{ name="cleanup_stage2"; verifiers=@("verify-cleanup-natural-completion.js","verify-cleanup-stage-receipt.js"); hardGate="supabase_history_retention_receipt" }
  "18:10" = @{ name="cleanup_stage3"; verifiers=@("verify-cleanup-natural-completion.js","verify-global-cost-janitor-scorecard.js"); hardGate="global_janitor_no_legacy_vercel_monitor" }
  "18:40" = @{ name="cleanup_stage4"; verifiers=@("verify-cleanup-natural-completion.js","verify-daytrade-intraday-retention.js"); hardGate="1m_15d_batch5000_max60_protect_latest" }
  "19:10" = @{ name="cleanup_stage5"; verifiers=@("verify-cleanup-natural-completion.js","verify-source-observability-retention.js","verify-daily-retention-maintenance.js"); hardGate="runtime_priority_observability_five_receipts" }
  "20:05" = @{ name="chip_source_sync"; verifiers=@("verify-chip-source-sync-receipt.js"); hardGate="today_institution_official_margin_dates_counts_sources" }
  "21:00" = @{ name="strategy5_and_institution"; verifiers=@("verify-evening-natural-task-start.js"); hardGate="independent_unique_original_tasks_naturally_started" }
  "21:10" = @{ name="institution_battle"; verifiers=@("verify-evening-natural-task-start.js"); hardGate="battle_unique_original_task_naturally_started" }
  "21:15" = @{ name="institution_watchdog"; verifiers=@("verify-institution-watchdog-2115.js"); hardGate="read_only_missed_run_guard_no_retry_if_running_run_id_or_failure_receipt" }
  "21:40" = @{ name="evening_four_surface"; verifiers=@("verify-strategy5-e2e-closure.js","verify-institution-e2e-closure.js","verify-institution-battle-state.js","verify-terminal-row-audit-consistency.js","verify-terminal-row-audit-consistency.js"); hardGate="strategy5_institution_battle_api_desktop_mobile_88_same_run_count_symbols_prices_scores" }
  "22:00" = @{ name="production_window"; verifiers=@("verify-production-mirror-guard.js"); hardGate="go_hard_gates_source_mirror_clean" }
  "23:10" = @{ name="final_daily_control"; verifiers=@(); hardGate="all_chains_surfaces_88_notifications_cleanup_blockers_single_deduplicated_readback" }
}
# Each Windows trigger owns exactly one checkpoint. Missing earlier receipts are
# reported by coverage verification; they must never retarget a later trigger.
# StartWhenAvailable can launch a queued trigger a few minutes late, so accept only
# the most recent checkpoint inside a bounded window and never perform cross-slot catch-up.
if (-not $RequestedCheckpoint -and $effectiveMode -eq "Checkpoint") {
  $exactCheckpointId = $startedAt.ToString("HH:mm")
  if ($checkpointContracts.Contains($exactCheckpointId)) {
    $checkpointId = $exactCheckpointId
  } else {
    $boundedCheckpointIds = @($checkpointContracts.Keys | Where-Object {
      $checkpointTime = [TimeSpan]::Parse($_)
      $delayMinutes = ($startedAt.TimeOfDay - $checkpointTime).TotalMinutes
      $delayMinutes -ge 0 -and $delayMinutes -le 5
    } | Sort-Object { [TimeSpan]::Parse($_) })
    if ($boundedCheckpointIds.Count -gt 0) {
      $checkpointId = [string]$boundedCheckpointIds[-1]
    }
  }
}
# Receipt history is coverage evidence only. It cannot select or retarget this run.
$receiptCheckpointIds = @()
$earlyReceiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
if (Test-Path -LiteralPath $earlyReceiptDir) {
  foreach ($history in @(Get-ChildItem -LiteralPath $earlyReceiptDir -Filter "terminal-master-checkpoint-$($startedAt.ToString('yyyyMMdd'))-*.json" -File -ErrorAction SilentlyContinue)) {
    try {
      $prior = Get-Content -LiteralPath $history.FullName -Raw | ConvertFrom-Json
      $priorDate = if ($prior.tradeDate) { [string]$prior.tradeDate } elseif ($prior.startedAt) { ([datetime]$prior.startedAt).ToString("yyyy-MM-dd") } else { "" }
      $priorCheckpoint = [string]$prior.checkpointId -replace "-final$", ""
      if ($priorDate -eq $startedAt.ToString("yyyy-MM-dd") -and $checkpointContracts.Contains($priorCheckpoint)) {
        $receiptCheckpointIds += $priorCheckpoint
      }
    } catch { }
  }
}
$receiptCheckpointIds = @($receiptCheckpointIds | Sort-Object -Unique)

$checkpointContract = $checkpointContracts[$checkpointId]
if (-not $checkpointContract -and -not $RequestedCheckpoint) {
  $dueCheckpointIds = @($checkpointContracts.Keys | Where-Object {
    [TimeSpan]::Parse($_) -le $startedAt.TimeOfDay
  } | Sort-Object { [TimeSpan]::Parse($_) })
  if ($dueCheckpointIds.Count -gt 0) {
    $checkpointId = [string]$dueCheckpointIds[-1]
    $checkpointContract = $checkpointContracts[$checkpointId]
  }
}
if (-not $checkpointContract) { throw "unsupported master checkpoint: $checkpointId" }
if ($RequireProtectedReadback) { $env:FUMAN_REQUIRE_PROTECTED_READBACK = "1" }
$auditMode = if ($effectiveMode -eq "Full") { "full_day_read_only_audit" } else { "read_only_checkpoint" }
$receiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
$reportDir = Join-Path $RuntimeRoot "reports"
$failClosedCheckpointIds = @("06:00","06:05","07:00","07:08","08:20","08:29","08:45","09:00","12:30","12:50","13:00","13:30","15:35","18:40","22:00","23:10")
$checkpointFailureClass = if ($failClosedCheckpointIds -contains $checkpointId) { "FAIL_CLOSED" } else { "BLOCKED" }
$lockDir = Join-Path $RuntimeRoot "locks"
$mutexName = "Global\FumanTerminalMasterControl"
$receiptFile = Join-Path $receiptDir "terminal-master-checkpoint-latest.json"
$receiptHistoryFile = Join-Path $receiptDir ("terminal-master-checkpoint-{0}.json" -f $startedAt.ToString("yyyyMMdd-HHmmss"))
$alertReceiptFile = Join-Path $receiptDir ("terminal-master-alert-{0}.json" -f $startedAt.ToString("yyyyMMdd-HHmmss"))
$jsonFile = Join-Path $RuntimeRoot "state\api-unattended-scorecard.json"
$mdFile = Join-Path $reportDir "api-unattended-scorecard.md"
New-Item -ItemType Directory -Force -Path $receiptDir,$reportDir,$lockDir,(Split-Path -Parent $jsonFile) | Out-Null
function Get-FumanTaskStartGuard {
  param(
    [Parameter(Mandatory = $true)][string]$TaskName,
    [Parameter(Mandatory = $true)][datetime]$ControlDate,
    [switch]$RequireNeverRunToday
  )

  $matches = @(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
  if ($matches.Count -ne 1) {
    return [ordered]@{ allowed=$false; reason="scheduled_task_not_unique"; taskCount=$matches.Count; state=$null; lastRunTime=$null }
  }

  $task = $matches[0]
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  $lastRunTime = if ($taskInfo) { [datetime]$taskInfo.LastRunTime } else { [datetime]::MinValue }
  $ranToday = ($lastRunTime -ne [datetime]::MinValue -and $lastRunTime.Date -eq $ControlDate.Date)
  if ([string]$task.State -eq "Running") {
    return [ordered]@{ allowed=$false; reason="original_task_already_running"; taskCount=1; state=[string]$task.State; lastRunTime=$lastRunTime.ToString("o") }
  }
  if ($RequireNeverRunToday -and $ranToday) {
    return [ordered]@{ allowed=$false; reason="original_task_already_ran_today_no_second_writer_run"; taskCount=1; state=[string]$task.State; lastRunTime=$lastRunTime.ToString("o") }
  }
  return [ordered]@{ allowed=$true; reason="original_unique_task_start_allowed"; taskCount=1; state=[string]$task.State; lastRunTime=if ($lastRunTime -eq [datetime]::MinValue) { $null } else { $lastRunTime.ToString("o") } }
}

function Wait-FumanOriginalTaskCompletion {
  param(
    [Parameter(Mandatory = $true)][string]$TaskName,
    [Parameter(Mandatory = $true)][datetime]$ControlDate,
    [int]$TimeoutSeconds = 180
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $matches = @(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
    if ($matches.Count -ne 1) { return [ordered]@{ completed=$false; reason="scheduled_task_not_unique"; taskCount=$matches.Count } }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    $lastRun = if ($info) { [datetime]$info.LastRunTime } else { [datetime]::MinValue }
    $ranToday = ($lastRun -ne [datetime]::MinValue -and $lastRun.Date -eq $ControlDate.Date)
    if ([string]$matches[0].State -ne "Running" -and $ranToday) {
      return [ordered]@{ completed=$true; reason="original_task_naturally_completed"; state=[string]$matches[0].State; lastRunTime=$lastRun.ToString("o"); lastTaskResult=$info.LastTaskResult }
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return [ordered]@{ completed=$false; reason="original_task_completion_timeout"; state=[string]$matches[0].State; lastRunTime=if ($lastRun -eq [datetime]::MinValue) { $null } else { $lastRun.ToString("o") } }
}

function Wait-FumanOriginalTaskStart {
  param(
    [Parameter(Mandatory = $true)][string]$TaskName,
    [Parameter(Mandatory = $true)][datetime]$ControlDate,
    [int]$TimeoutSeconds = 120
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $matches = @(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
    if ($matches.Count -ne 1) { return [ordered]@{ started=$false; reason="scheduled_task_not_unique"; taskCount=$matches.Count } }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    $lastRun = if ($info) { [datetime]$info.LastRunTime } else { [datetime]::MinValue }
    $ranToday = ($lastRun -ne [datetime]::MinValue -and $lastRun.Date -eq $ControlDate.Date)
    if ($ranToday -or [string]$matches[0].State -eq "Running") {
      return [ordered]@{
        started=$true
        reason="original_task_naturally_started"
        taskCount=1
        state=[string]$matches[0].State
        lastRunTime=if ($lastRun -eq [datetime]::MinValue) { $null } else { $lastRun.ToString("o") }
        lastTaskResult=if ($info) { $info.LastTaskResult } else { $null }
      }
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return [ordered]@{ started=$false; reason="original_task_natural_start_timeout"; taskCount=1; state=[string]$matches[0].State; lastRunTime=$null }
}

function Send-FumanMasterAlert {
  param(
    [Parameter(Mandatory = $true)][string]$Status,
    [Parameter(Mandatory = $true)][string]$FirstBlocker,
    [Parameter(Mandatory = $true)][string]$ReceiptPath
  )
  try {
    $alertScript = Join-Path $ProjectRoot "scripts\send-workflow-alert.js"
    if (-not (Test-Path -LiteralPath $alertScript)) { return }
    $env:FUMAN_ALERT_SOURCE = "Fuman Terminal Master Control"
    $env:FUMAN_ALERT_SUBJECT = "Fuman master control blocker detected"
    $env:FUMAN_ALERT_TEXT = "Master control returned $Status at checkpoint $checkpointId; firstBlocker=$FirstBlocker. No strategy retry, second canonical run, receipt rewrite, or deployment was started. Receipt: $ReceiptPath"
    & node --use-system-ca $alertScript --kind master-control --receipt $alertReceiptFile
  } catch { }
}
$mutex = [System.Threading.Mutex]::new($false, $mutexName)
$mutexOwned = $false
try {
  $apiScorecardRequired = @("12:40", "13:15", "17:00", "21:40", "23:10") -contains $checkpointId
  $mutexOwned = $mutex.WaitOne(0)
  if (-not $mutexOwned) {
    # Never overlap verifiers. A skipped checkpoint is BLOCKED, never a silent success.
    $finishedAt = Get-Date
    [ordered]@{
      contract = "fuman-master-checkpoint-runner-v1"
      mode = $auditMode
      checkpointId = if ($effectiveMode -eq "Full") { "23:10-final" } else { $checkpointId }
      fullDayAudit = ($effectiveMode -eq "Full")
      ok = $false
      status = "BLOCKED"
      allowedStatuses = @("PASS", "SELF_HEALED_PASS", "FAIL_CLOSED", "BLOCKED")
      firstBlocker = "master_controller_already_running"
      tradeDate = $startedAt.ToString("yyyy-MM-dd")
      runId = $null
      keyCounts = [ordered]@{ expectedCount=$null; scannedCount=$null; resultCount=$null; dataGapCount=$null; formalWaterCoverageRatio=$null }
      publishAllowed = $null
      complete = $null
      surfaceConsistency = [ordered]@{ required=$false; ok=$null; scope=$null }
      canonicalEvidenceSource = $null
      limitedSelfHealPerformed = $false
      limitedSelfHealActions = @()
      startedAt = $startedAt.ToString("o")
      finishedAt = $finishedAt.ToString("o")
      durationSeconds = [math]::Round(($finishedAt - $startedAt).TotalSeconds, 3)
      strategyExecutionAllowed = $false
      scannerApplyAllowed = $false
      deploymentAllowed = $false
      killedProcess = $false
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptFile -Encoding UTF8
    Copy-Item -LiteralPath $receiptFile -Destination $receiptHistoryFile -Force
    Send-FumanMasterAlert -Status "BLOCKED" -FirstBlocker "master_controller_already_running" -ReceiptPath $receiptHistoryFile
    exit 1
  }
  Set-Location $ProjectRoot
  $calendarOutput = & node --use-system-ca (Join-Path $ProjectRoot "scripts\check-strategy2-trading-day.js") "--date=$($startedAt.ToString('yyyy-MM-dd'))" "--closed-exit-code=10" 2>&1 | Out-String
  $calendarExit = [int]$LASTEXITCODE
  $marketCalendar = $null
  try { $marketCalendar = $calendarOutput | ConvertFrom-Json } catch { }
  $calendarUnavailable = ($calendarExit -notin @(0, 10)) -or (-not $marketCalendar) -or ([string]$marketCalendar.reason -eq "weekday_fallback")
  $nonTradingDay = ($calendarExit -eq 10 -and $marketCalendar.status -eq "market_closed")
  # Weekday triggers cannot encode exchange holidays. The authoritative market
  # calendar therefore performs a quiet no-op: no controller receipt, alert,
  # repair, strategy run, or formal state is produced on a non-trading day.
  if ($nonTradingDay) {
    Write-Output ("[terminal-master-control] quiet_non_trading_day_skip tradeDate={0}" -f $startedAt.ToString("yyyy-MM-dd"))
    exit 0
  }
  if ($calendarUnavailable) {
    $finishedAt = Get-Date
    [ordered]@{
      contract = "fuman-master-checkpoint-runner-v1"
      mode = $auditMode
      checkpointId = if ($effectiveMode -eq "Full") { "23:10-final" } else { $checkpointId }
      fullDayAudit = ($effectiveMode -eq "Full")
      ok = $false
      status = "FAIL_CLOSED"
      allowedStatuses = @("PASS", "SELF_HEALED_PASS", "FAIL_CLOSED", "BLOCKED")
      firstBlocker = "market_calendar_unavailable_fail_closed"
      tradeDate = if ($marketCalendar.tradeDate) { [string]$marketCalendar.tradeDate } else { $startedAt.ToString("yyyy-MM-dd") }
      runId = $null
      keyCounts = [ordered]@{ expectedCount=$null; scannedCount=$null; resultCount=$null; dataGapCount=$null; formalWaterCoverageRatio=$null }
      publishAllowed = $false
      complete = $false
      surfaceConsistency = [ordered]@{ required=$false; ok=$null; scope="market_calendar_unavailable" }
      canonicalEvidenceSource = $null
      marketCalendar = $marketCalendar
      limitedSelfHealPerformed = $false
      limitedSelfHealActions = @()
      startedAt = $startedAt.ToString("o")
      finishedAt = $finishedAt.ToString("o")
      durationSeconds = [math]::Round(($finishedAt - $startedAt).TotalSeconds, 3)
      strategyExecutionAllowed = $false
      scannerApplyAllowed = $false
      deploymentAllowed = $false
      killedProcess = $false
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptFile -Encoding UTF8
    Copy-Item -LiteralPath $receiptFile -Destination $receiptHistoryFile -Force
    if ($nonTradingDay) { exit 0 }
    Send-FumanMasterAlert -Status "FAIL_CLOSED" -FirstBlocker "market_calendar_unavailable_fail_closed" -ReceiptPath $receiptHistoryFile
    exit 1
  }
  $env:FUMAN_API_UNATTENDED_SCORECARD_FILE = $jsonFile
  $env:FUMAN_API_UNATTENDED_REPORT_FILE = $mdFile
  $verifierExit = $null
  if ($apiScorecardRequired) {
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-api-unattended-scorecard.js")
    $verifierExit = [int]$LASTEXITCODE
  }
  & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-formal-strategy-schedule-authority.js")
  $scheduleAuthorityExit = [int]$LASTEXITCODE
  & node (Join-Path $ProjectRoot "scripts\verify-terminal-autonomous-root-runner.js")
  $masterContractExit = [int]$LASTEXITCODE
  & node (Join-Path $ProjectRoot "scripts\verify-daytrade-writer-root-authority.js")
  $writerRootAuthorityExit = [int]$LASTEXITCODE
  $chipSourceVerifierDue = @("20:05", "21:00", "21:10", "21:40", "23:10") -contains $checkpointId
  & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-fuman-schedule-registry-live-alignment.js")
  $scheduleAlignmentExit = [int]$LASTEXITCODE
  & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-scorecard88-fixed-collection-contract.js")
  $scorecard88ContractExit = [int]$LASTEXITCODE
  & node (Join-Path $ProjectRoot "scripts\verify-strategy2-v3-unified-contract.js")
  $strategy2UnifiedContractExit = [int]$LASTEXITCODE
  # Wait for already-scheduled original tasks before any business readback.
  # Waiting never starts or reruns a task and never creates a canonical run.
  $originalTaskWait = @()
  $waitSpecs = switch ($checkpointId) {
    "07:08" { @(@{ task="Fuman Daytrade Source Gate 0700"; timeout=300 }) }
    "08:20" { @(@{ task="Fuman Opening Report 0820 Preflight"; timeout=300 }) }
    "08:30" { @(@{ task="Fuman Opening Report 0830 Telegram"; timeout=600 }) }
    "08:40" { @(@{ task="Fuman Opening Limit Order Morning Readonly 0840"; timeout=300 }) }
    "08:45" { @(@{ task="Fuman Daytrade Futopt Preopen Evidence 0845"; timeout=180 }) }
    "08:50" { @(@{ task="Fuman Daytrade Futopt Preopen Evidence 0850"; timeout=180 }) }
    "08:55" { @(@{ task="Fuman Opening Limit Order Morning Readonly 0840"; timeout=600 }) }
    "09:00" { @(@{ task="Fuman Opening Limit Order Morning Readonly 0840"; timeout=600 }) }
    "12:30" { @(@{ task="Fuman Strategy2 Unified 0845-1230"; timeout=600 }) }
    "12:40" { @(@{ task="Fuman Scorecard88 Collect Strategy2 1240"; timeout=600 }) }
    "13:15" { @(
      @{ task="Fuman Strategy3 V2 Complete Scan 1300"; timeout=600 },
      @{ task="Fuman Scorecard88 Collect Strategy3 1315"; timeout=600 }
    ) }
    "13:30" { @(
      @{ task="Fuman Daytrade Source Writer 0600-1330"; timeout=300 },
      @{ task="Fuman Fugle Daytrade WebSocket Collector 0600-1330"; timeout=300 }
    ) }
    "15:35" { @(@{ task="Fuman Strategy4 Source Prewarm 1535"; timeout=900 }) }
    "17:00" { @(
      @{ task="Fuman Strategy4 Cache 1600"; timeout=900 },
      @{ task="Fuman Scorecard88 Collect Strategy4 1700"; timeout=600 }
    ) }
    "17:10" { @(@{ task="Fuman API-Only Retired Artifact Cleanup 1535"; timeout=300 }) }
    "17:40" { @(@{ task="Fuman Supabase Vercel History Cleanup 1545"; timeout=300 }) }
    "18:10" { @(@{ task="Fuman Global Cost Janitor Scorecard 1555"; timeout=300 }) }
    "18:40" { @(@{ task="Fuman Daytrade Intraday Retention 1605"; timeout=600 }) }
    "19:10" { @(@{ task="Fuman Daily Retention Maintenance 1625"; timeout=600 }) }
    "20:05" { @(@{ task="Fuman Chip Source Sync 2005"; timeout=180 }) }
    "21:15" { @(@{ task="Fuman 買賣超 Watchdog 2115"; timeout=180 }) }
    "21:40" { @(
      @{ task="Fuman Strategy5 Cache 2100"; timeout=600 },
      @{ task="Fuman 買賣超 Cache 2100"; timeout=600 },
      @{ task="Fuman Institution Battle Verify 2110"; timeout=300 },
      @{ task="Fuman Scorecard88 Collect Evening 2140"; timeout=600 }
    ) }
    default { @() }
  }
  foreach ($waitSpec in @($waitSpecs)) {
    $originalTaskWait += Wait-FumanOriginalTaskCompletion -TaskName $waitSpec.task -ControlDate $startedAt -TimeoutSeconds $waitSpec.timeout
  }
  $daytradeWriterVerifierDue = @("06:05", "07:08", "08:45", "09:00", "12:30", "12:50", "13:00", "13:30") -contains $checkpointId
  $originalTaskStart = $null
  if ($checkpointId -eq "08:40") {
    $originalTaskStart = Wait-FumanOriginalTaskStart -TaskName "Fuman Opening Limit Order Morning Readonly 0840" -ControlDate $startedAt -TimeoutSeconds 120
  } elseif ($checkpointId -eq "08:45" -or $checkpointId -eq "09:00") {
    $originalTaskStart = Wait-FumanOriginalTaskStart -TaskName "Fuman Strategy2 Unified 0845-1230" -ControlDate $startedAt -TimeoutSeconds 120
  }
  $originalTaskStartFailure = ($null -ne $originalTaskStart -and $originalTaskStart.started -ne $true)
  $daytradeWriterVerifierInCheckpoint = @($checkpointContract.verifiers) -contains "verify-daytrade-writer-checkpoint-health.js"
  $daytradeWriterVerifierExit = $null
  $daytradeWriterVerifierReceipt = Join-Path $receiptDir ("daytrade-writer-checkpoint-health-{0}.json" -f $startedAt.ToString("yyyyMMdd"))
  if ($daytradeWriterVerifierDue -and -not $daytradeWriterVerifierInCheckpoint) {
    # Local readback only: task metadata, wrapper completion log, V2 status and Mother Pool receipt.
    # It never queries Supabase and never starts a writer, collector, strategy or retry.
    & node (Join-Path $ProjectRoot "scripts\verify-daytrade-writer-checkpoint-health.js") "--trade-date=$($startedAt.ToString('yyyy-MM-dd'))"
    $daytradeWriterVerifierExit = [int]$LASTEXITCODE
  }
  $stagedWarmupVerifierDue = $checkpointId -eq "07:08"
  $stagedWarmupVerifierInCheckpoint = @($checkpointContract.verifiers) -contains "verify-daytrade-staged-warmup-checkpoint.js"
  $stagedWarmupVerifierExit = $null
  if ($stagedWarmupVerifierDue -and -not $stagedWarmupVerifierInCheckpoint) {
    & node (Join-Path $ProjectRoot "scripts\verify-daytrade-staged-warmup-checkpoint.js")
    $stagedWarmupVerifierExit = [int]$LASTEXITCODE
  }
  $openingPreflightVerifierDue = $false
  $openingPreflightVerifierExit = $null
  if ($openingPreflightVerifierDue) {
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-opening-report-0820-preflight.js") --require-current
    $openingPreflightVerifierExit = [int]$LASTEXITCODE
  }
  $openingReportVerifierDue = $false
  $openingReportVerifierExit = $null
  $openingReportVerifierReceipt = Join-Path $RuntimeRoot ("data\opening-report-0830\opening-report-0830-contract-verifier-{0}.json" -f $startedAt.ToString("yyyyMMdd"))
  if ($openingReportVerifierDue) {
    # Read-only closure check: never regenerate, late-backfill, or redeliver the report.
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-opening-report-0830-contract.js") --require-current
    $openingReportVerifierExit = [int]$LASTEXITCODE
  }
  $chipSourceVerifierExit = $null
  $chipSourceVerifierReceipt = Join-Path $receiptDir "chip-source-sync.json"
  if ($chipSourceVerifierDue) {
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-chip-source-sync-receipt.js")
    $chipSourceVerifierExit = [int]$LASTEXITCODE
  }
  $telegramVerifierDue = @("09:00", "12:30", "23:10") -contains $checkpointId
  $telegramVerifierExit = $null
  if ($telegramVerifierDue) {
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-daytrade-intraday-burst-telegram.js") --require-live --require-today
    $telegramVerifierExit = [int]$LASTEXITCODE
  }
  $telegramVerifierPassed = (-not $telegramVerifierDue) -or ($telegramVerifierExit -eq 0)
  $strategy2VerifierDue = @("12:40", "23:10") -contains $checkpointId
  $strategy2VerifierExit = $null
  $strategy2VerifierReceipt = Join-Path $receiptDir "strategy2-tri-surface-canonical-latest.json"
  if ($strategy2VerifierDue) {
    # This is the only Strategy2 closure authority. It is read-only and never starts a retry.
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-strategy2-terminal-visible-readback.js")
    $strategy2VerifierExit = [int]$LASTEXITCODE
  }
  $strategy3VerifierDue = @("13:15", "13:30", "23:10") -contains $checkpointId
  $strategy3VerifierExit = $null
  if ($strategy3VerifierDue) {
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-strategy3-v2-daily-unattended-closure.js") "--trade-date=$($startedAt.ToString('yyyy-MM-dd'))"
    $strategy3VerifierExit = [int]$LASTEXITCODE
  }
  $strategy4VerifierDue = @("17:00", "23:10") -contains $checkpointId
  $strategy4VerifierExit = $null
  if ($checkpointId -eq "23:10") {
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-strategy4-postscan-closure.js")
    $strategy4VerifierExit = [int]$LASTEXITCODE
  }
  # Execute only the verifier set owned by this exact checkpoint.  These commands are
  $limitedSelfHealPerformed = $false
  $limitedSelfHealActions = @()
  # read-only; they may not start scanners, create runIds, publish, deploy, or kill.
  $checkpointVerifierChecks = @()
  foreach ($checkpointVerifier in @($checkpointContract.verifiers)) {
    $checkpointVerifierPath = Join-Path $ProjectRoot ("scripts\{0}" -f $checkpointVerifier)
    $checkpointVerifierArgs = @()
    if ($checkpointVerifier -eq "verify-daytrade-writer-checkpoint-health.js") {
      $checkpointVerifierArgs += "--trade-date=$($startedAt.ToString('yyyy-MM-dd'))"
    }
    if ($checkpointVerifier -eq "verify-daytrade-postclose-1330.js") {
      $checkpointVerifierArgs += "--trade-date=$($startedAt.ToString('yyyy-MM-dd'))"
    }
    if ($checkpointVerifier -eq "verify-daytrade-fugle-source-startup.js") {
      $checkpointVerifierArgs += "--phase=$(if ($checkpointId -eq '06:00') { 'start' } else { 'closure' })"
    }
    if ($checkpointVerifier -match "opening-report-08(20|30)") {
      if ($checkpointId -eq "08:29" -and $checkpointVerifier -eq "verify-opening-report-0830-contract.js") {
        $checkpointVerifierArgs += "--pre-delivery"
      } else {
        $checkpointVerifierArgs += "--require-current"
      }
    }
    if ($checkpointVerifier -eq "verify-strategy2-v3-live-closure.js" -and [TimeSpan]::Parse($checkpointId) -ge [TimeSpan]::Parse("12:30")) {
      $checkpointVerifierArgs += "--expect-complete"
    }
    if ($checkpointVerifier -eq "verify-daytrade-intraday-burst-telegram.js") {
      $checkpointVerifierArgs += @("--require-live", "--require-today")
    }
    if ($checkpointVerifier -eq "verify-opening-limit-order-closed-loop.js" -or $checkpointVerifier -eq "verify-opening-limit-order-0840-checkpoint-readonly.js") {
      $checkpointVerifierArgs += "--trade-date=$($startedAt.ToString('yyyy-MM-dd'))"
    }
    if ($checkpointVerifier -eq "verify-opening-limit-order-futopt-natural-evidence.js") {
      $checkpointVerifierArgs += "--trade-date=$($startedAt.ToString('yyyy-MM-dd'))"
      if ($checkpointId -eq "08:45") { $checkpointVerifierArgs += "--slots=0845" }
    }
    if ($checkpointVerifier -eq "verify-strategy2-v3-water.js") {
      $checkpointVerifierArgs += "--trade-date=$($startedAt.ToString('yyyy-MM-dd'))"
    }
    if ($checkpointVerifier -eq "verify-scorecard88-collection-receipts.js") {
      $checkpointVerifierArgs += "--slot=$checkpointId"
    }
    if ($checkpointVerifier -eq "verify-cleanup-stage-receipt.js") {
      $checkpointVerifierArgs += "--stage=$(if ($checkpointId -eq '17:10') { '1' } else { '2' })"
    }
    if ($checkpointVerifier -eq "verify-cleanup-natural-completion.js") {
      $cleanupStage = ([ordered]@{ "17:10"="1"; "17:40"="2"; "18:10"="3"; "18:40"="4"; "19:10"="5" })[$checkpointId]
      if (-not $cleanupStage) { throw "cleanup stage mapping missing for checkpoint $checkpointId" }
      $checkpointVerifierArgs += "--stage=$cleanupStage"
    }
    if ($checkpointVerifier -eq "verify-evening-natural-task-start.js") {
      $checkpointVerifierArgs += "--phase=$(if ($checkpointId -eq '21:00') { 'chains' } else { 'battle' })"
    }
    if ($checkpointVerifier -match "strategy3" -and $checkpointVerifier -match "closure") {
      $checkpointVerifierArgs += "--trade-date=$($startedAt.ToString('yyyy-MM-dd'))"
    }
    if ($checkpointVerifier -eq "verify-terminal-row-audit-consistency.js") {
      $rowAuditStrategy = if ($checkpointId -eq "13:15") { "strategy3" } elseif ($checkpointId -eq "17:00") { "strategy4" } elseif ($checkpointId -eq "21:40" -and @($checkpointVerifierChecks | Where-Object { $_.verifier -eq "verify-terminal-row-audit-consistency.js" }).Count -eq 0) { "strategy5" } else { "institution" }
      $checkpointVerifierArgs += "--strategy=$rowAuditStrategy"
    }
    $checkpointVerifierOutput = @(& node --use-system-ca $checkpointVerifierPath @checkpointVerifierArgs 2>&1)
    $checkpointVerifierExitCode = [int]$LASTEXITCODE
    $checkpointVerifierOutput | ForEach-Object { Write-Host ([string]$_) }
    $checkpointVerifierRaw = (@($checkpointVerifierOutput | ForEach-Object { [string]$_ }) -join "`n").Trim()
    $checkpointVerifierParsed = $null
    if ($checkpointVerifierRaw) {
      try { $checkpointVerifierParsed = $checkpointVerifierRaw | ConvertFrom-Json }
      catch {
        $jsonStart = $checkpointVerifierRaw.IndexOf("{")
        $jsonEnd = $checkpointVerifierRaw.LastIndexOf("}")
        if ($jsonStart -ge 0 -and $jsonEnd -gt $jsonStart) {
          try { $checkpointVerifierParsed = $checkpointVerifierRaw.Substring($jsonStart, $jsonEnd - $jsonStart + 1) | ConvertFrom-Json } catch { }
        }
      }
    }
    $reportedFailedChecks = @()
    if ($checkpointVerifierParsed) {
      if ($checkpointVerifierParsed.failed_checks) { $reportedFailedChecks = @($checkpointVerifierParsed.failed_checks) }
      elseif ($checkpointVerifierParsed.issues) { $reportedFailedChecks = @($checkpointVerifierParsed.issues) }
    }
    $reportedFirstBlocker = if ($checkpointVerifierParsed.first_blocker) { [string]$checkpointVerifierParsed.first_blocker }
      elseif ($checkpointVerifierParsed.firstBlocker) { [string]$checkpointVerifierParsed.firstBlocker }
      elseif ($reportedFailedChecks.Count -gt 0) { [string]$reportedFailedChecks[0] }
      else { $null }
    $checkpointVerifierChecks += [ordered]@{
      verifier = $checkpointVerifier
      arguments = $checkpointVerifierArgs
      exitCode = $checkpointVerifierExitCode
      reportedStatus = if ($checkpointVerifierParsed.status) { [string]$checkpointVerifierParsed.status } elseif ($checkpointVerifierParsed.ok -eq $true) { "PASS" } else { $null }
      reportedFirstBlocker = $reportedFirstBlocker
      reportedFailedChecks = $reportedFailedChecks
    }
  }
  if ($checkpointId -eq "17:00") {
    $strategy4CheckpointCheck = @($checkpointVerifierChecks | Where-Object { $_.verifier -eq "verify-strategy4-postscan-closure.js" }) | Select-Object -First 1
    if ($strategy4CheckpointCheck) { $strategy4VerifierExit = [int]$strategy4CheckpointCheck.exitCode }
  }
  $checkpointVerifierFailure = @($checkpointVerifierChecks | Where-Object { $_.exitCode -ne 0 }).Count -gt 0
  # Finite self-heal: only wake the already-installed unique source task once.
  # Never invoke a scanner, create a runId, publish, deploy, or replace canonical data.
  $sourceRecoveryCheckpoints = @("06:05", "12:30", "12:50")
  $sourceRecoveryVerifierNames = @("verify-daytrade-fugle-source-startup.js", "verify-strategy3-v2-readiness-guard-contract.js", "verify-strategy3-v2-water-universe.js")
  $failedSourceChecks = @($checkpointVerifierChecks | Where-Object { $_.exitCode -ne 0 -and $sourceRecoveryVerifierNames -contains $_.verifier })
  if ($sourceRecoveryCheckpoints -contains $checkpointId -and $failedSourceChecks.Count -gt 0) {
    $collectorTaskName = "Fuman Fugle Daytrade WebSocket Collector 0600-1330"
    $collectorTask = Get-ScheduledTask -TaskName $collectorTaskName -ErrorAction SilentlyContinue
    if ($collectorTask -and [string]$collectorTask.State -ne "Running") {
      Start-ScheduledTask -TaskName $collectorTaskName
      $limitedSelfHealPerformed = $true
      $limitedSelfHealActions += [ordered]@{ action="start_original_unique_collector_once"; task=$collectorTaskName; reason="checkpoint_source_verifier_failed" }
      Start-Sleep -Seconds 8
      foreach ($failedCheck in $failedSourceChecks) {
        $retryPath = Join-Path $ProjectRoot ("scripts\{0}" -f $failedCheck.verifier)
        & node --use-system-ca $retryPath @($failedCheck.arguments)
        $failedCheck.exitCode = [int]$LASTEXITCODE
        $failedCheck.recheckedAfterSelfHeal = $true
      }
    }
  }
  if ($checkpointId -eq "06:05" -and $checkpointVerifierFailure) {
    $writerTaskName = "Fuman Daytrade Source Writer 0600-1330"
    $writerStartGuard = Get-FumanTaskStartGuard -TaskName $writerTaskName -ControlDate $startedAt -RequireNeverRunToday
    if ($writerStartGuard.allowed) {
      Start-ScheduledTask -TaskName $writerTaskName
      $limitedSelfHealPerformed = $true
      $limitedSelfHealActions += [ordered]@{ action="start_missed_original_writer_once"; task=$writerTaskName; reason="writer_health_verifier_failed_and_task_never_ran_today"; guard=$writerStartGuard }
      Start-Sleep -Seconds 8
      foreach ($failedCheck in @($checkpointVerifierChecks | Where-Object { $_.exitCode -ne 0 -and $_.verifier -eq "verify-daytrade-writer-checkpoint-health.js" })) {
        $retryPath = Join-Path $ProjectRoot ("scripts\{0}" -f $failedCheck.verifier)
        & node --use-system-ca $retryPath @($failedCheck.arguments)
        $failedCheck.exitCode = [int]$LASTEXITCODE
        $failedCheck.recheckedAfterSelfHeal = $true
      }
    } else {
      $limitedSelfHealActions += [ordered]@{ action="writer_self_heal_refused"; task=$writerTaskName; reason=$writerStartGuard.reason; guard=$writerStartGuard }
    }
  }
  if ($checkpointId -eq "20:05" -and $checkpointVerifierFailure) {
    $chipTaskName = "Fuman Chip Source Sync 2005"
    $chipReceiptExists = Test-Path -LiteralPath $chipSourceVerifierReceipt
    $chipStartGuard = Get-FumanTaskStartGuard -TaskName $chipTaskName -ControlDate $startedAt -RequireNeverRunToday
    if (-not $chipReceiptExists -and $chipStartGuard.allowed) {
      Start-ScheduledTask -TaskName $chipTaskName
      $limitedSelfHealPerformed = $true
      $limitedSelfHealActions += [ordered]@{ action="start_missed_original_chip_source_sync_once"; task=$chipTaskName; reason="today_receipt_missing_and_original_task_never_ran_today"; guard=$chipStartGuard }
      Start-Sleep -Seconds 8
      foreach ($failedCheck in @($checkpointVerifierChecks | Where-Object { $_.exitCode -ne 0 -and $_.verifier -eq "verify-chip-source-sync-receipt.js" })) {
        & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-chip-source-sync-receipt.js")
        $failedCheck.exitCode = [int]$LASTEXITCODE
        $failedCheck.recheckedAfterSelfHeal = $true
      }
    } else {
      $limitedSelfHealActions += [ordered]@{ action="chip_source_self_heal_refused"; task=$chipTaskName; reason=if ($chipReceiptExists) { "today_or_immutable_receipt_exists" } else { $chipStartGuard.reason }; guard=$chipStartGuard }
    }
  }
  $sourceChecksNeedingRecheck = @($failedSourceChecks | Where-Object { $_.recheckedAfterSelfHeal -ne $true })
  if ($sourceChecksNeedingRecheck.Count -gt 0) {
    Start-Sleep -Seconds 2
    foreach ($failedCheck in $sourceChecksNeedingRecheck) {
      $retryPath = Join-Path $ProjectRoot ("scripts\{0}" -f $failedCheck.verifier)
      & node --use-system-ca $retryPath @($failedCheck.arguments)
      $failedCheck.exitCode = [int]$LASTEXITCODE
      $failedCheck.recheckedAfterTransient = $true
    }
    $limitedSelfHealActions += [ordered]@{
      action="rerun_failed_source_verifier_once"
      verifiers=@($sourceChecksNeedingRecheck | ForEach-Object { $_.verifier })
      reason="bounded_transient_readback_recheck"
    }
  }
  $checkpointVerifierFailure = @($checkpointVerifierChecks | Where-Object { $_.exitCode -ne 0 }).Count -gt 0
  if ($daytradeWriterVerifierInCheckpoint) {
    $writerCheckpointCheck = @($checkpointVerifierChecks | Where-Object { $_.verifier -eq "verify-daytrade-writer-checkpoint-health.js" }) | Select-Object -First 1
    if ($writerCheckpointCheck) { $daytradeWriterVerifierExit = [int]$writerCheckpointCheck.exitCode }
  }
  if ($stagedWarmupVerifierInCheckpoint) {
    $stagedCheckpointCheck = @($checkpointVerifierChecks | Where-Object { $_.verifier -eq "verify-daytrade-staged-warmup-checkpoint.js" }) | Select-Object -First 1
    if ($stagedCheckpointCheck) { $stagedWarmupVerifierExit = [int]$stagedCheckpointCheck.exitCode }
  }
  if ($checkpointId -eq "20:05") {
    $chipCheckpointCheck = @($checkpointVerifierChecks | Where-Object { $_.verifier -eq "verify-chip-source-sync-receipt.js" }) | Select-Object -First 1
    if ($chipCheckpointCheck) { $chipSourceVerifierExit = [int]$chipCheckpointCheck.exitCode }
  }
  $eveningVerifierDue = @("21:40", "23:10") -contains $checkpointId
  $strategy5VerifierExit = $null
  $institutionVerifierExit = $null
  $institutionBattleVerifierExit = $null
  if ($checkpointId -eq "23:10") {
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-strategy5-e2e-closure.js")
    $strategy5VerifierExit = [int]$LASTEXITCODE
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-institution-e2e-closure.js")
    $institutionVerifierExit = [int]$LASTEXITCODE
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-institution-battle-state.js")
    $institutionBattleVerifierExit = [int]$LASTEXITCODE
  }
  if ($checkpointId -eq "21:40") {
    $strategy5CheckpointCheck = @($checkpointVerifierChecks | Where-Object { $_.verifier -eq "verify-strategy5-e2e-closure.js" }) | Select-Object -First 1
    $institutionCheckpointCheck = @($checkpointVerifierChecks | Where-Object { $_.verifier -eq "verify-institution-e2e-closure.js" }) | Select-Object -First 1
    $battleCheckpointCheck = @($checkpointVerifierChecks | Where-Object { $_.verifier -eq "verify-institution-battle-state.js" }) | Select-Object -First 1
    if ($strategy5CheckpointCheck) { $strategy5VerifierExit = [int]$strategy5CheckpointCheck.exitCode }
    if ($institutionCheckpointCheck) { $institutionVerifierExit = [int]$institutionCheckpointCheck.exitCode }
    if ($battleCheckpointCheck) { $institutionBattleVerifierExit = [int]$battleCheckpointCheck.exitCode }
  }
  $scorecard88ReceiptChecks = @()
  $scorecard88Slots = @(
    @{ Time = "12:40"; Slot = "12:40" },
    @{ Time = "13:15"; Slot = "13:15" },
    @{ Time = "17:00"; Slot = "17:00" },
    @{ Time = "21:40"; Slot = "21:40" }
  )
  if ($scorecard88Slots.Time -contains $checkpointId) {
    foreach ($slotSpec in $scorecard88Slots) {
      if ($checkpointId -eq $slotSpec.Time) {
        & node (Join-Path $ProjectRoot "scripts\verify-scorecard88-collection-receipts.js") "--slot=$($slotSpec.Slot)"
        $scorecard88ReceiptChecks += [ordered]@{ slot = $slotSpec.Slot; exitCode = [int]$LASTEXITCODE }
      }
    }
  }
  $scorecard88ReceiptFailure = @($scorecard88ReceiptChecks | Where-Object { $_.exitCode -ne 0 }).Count -gt 0
  $productionGateVerifierDue = @("22:00", "23:10") -contains $checkpointId
  $productionGateVerifierExit = $null
  if ($productionGateVerifierDue) {
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-publish-gate.js")
    $productionGateVerifierExit = [int]$LASTEXITCODE
  }
  $cleanupVerifierDue = ($effectiveMode -eq "Full") # one final invocation; checkpoint verifier list intentionally omits the duplicate
  $cleanupVerifierExit = $null
  $cleanupVerifierFile = Join-Path $RuntimeRoot ("status\daily-retention-maintenance-verifier-{0}.json" -f $startedAt.ToString("yyyyMMdd"))
  if ($cleanupVerifierDue) {
    # Final-only and read-only: this reads cleanup receipts and protected windows.
    # It never starts cleanup, a strategy scan, a retry, or a deployment.
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-daily-retention-maintenance.js")
    $cleanupVerifierExit = [int]$LASTEXITCODE
  }
  $dueCheckpointIdsForCoverage = @($checkpointContracts.Keys | Where-Object {
    [TimeSpan]::Parse($_) -le $startedAt.TimeOfDay
  } | Sort-Object { [TimeSpan]::Parse($_) })
  $currentCoverageCheckpoint = [string]$checkpointId -replace "-final$", ""
  $coveredCheckpointIds = @($receiptCheckpointIds + $currentCoverageCheckpoint | Where-Object { $_ } | Sort-Object -Unique)
  $missingCheckpointIds = @($dueCheckpointIdsForCoverage | Where-Object { $coveredCheckpointIds -notcontains $_ })
  $dailyCheckpointCoverage = [ordered]@{
    expectedDue = $dueCheckpointIdsForCoverage.Count
    covered = @($dueCheckpointIdsForCoverage | Where-Object { $coveredCheckpointIds -contains $_ }).Count
    missing = $missingCheckpointIds.Count
    coveredCheckpointIds = $coveredCheckpointIds
    missingCheckpointIds = $missingCheckpointIds
    complete = ($missingCheckpointIds.Count -eq 0)
  }
  $dailyCheckpointCoverageFailure = ($effectiveMode -eq "Full" -and $missingCheckpointIds.Count -gt 0)
  $dailyCheckpointResults = @()
  if ($effectiveMode -eq "Full") {
    $historyFiles = @(Get-ChildItem -LiteralPath $receiptDir -Filter "terminal-master-checkpoint-$($startedAt.ToString('yyyyMMdd'))-*.json" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    foreach ($expectedCheckpointId in @($dueCheckpointIdsForCoverage | Where-Object { $_ -ne "23:10" })) {
      $selected = $null
      $selectedFile = $null
      foreach ($history in $historyFiles) {
        try {
          $candidate = Get-Content -LiteralPath $history.FullName -Raw | ConvertFrom-Json
          $candidateId = [string]$candidate.checkpointId -replace "-final$", ""
          if ($candidateId -eq $expectedCheckpointId) { $selected = $candidate; $selectedFile = $history.FullName; break }
        } catch { }
      }
      $dailyCheckpointResults += [ordered]@{
        checkpointId = $expectedCheckpointId
        name = $checkpointContracts[$expectedCheckpointId].name
        status = if ($selected.status) { [string]$selected.status } else { "MISSING" }
        firstBlocker = if ($selected.firstBlocker) { [string]$selected.firstBlocker } else { $null }
        tradeDate = if ($selected.tradeDate) { [string]$selected.tradeDate } else { $null }
        runId = if ($selected.runId) { [string]$selected.runId } else { $null }
        keyCounts = if ($selected.keyCounts) { $selected.keyCounts } else { $null }
        surfaceConsistency = if ($selected.surfaceConsistency) { $selected.surfaceConsistency } else { $null }
        limitedSelfHealPerformed = if ($null -ne $selected.limitedSelfHealPerformed) { [bool]$selected.limitedSelfHealPerformed } else { $false }
        receipt = $selectedFile
      }
    }
  }
  $priorCheckpointFailures = @($dailyCheckpointResults | Where-Object { @("PASS","SELF_HEALED_PASS") -notcontains $_.status })
  $priorCheckpointFailure = ($effectiveMode -eq "Full" -and $priorCheckpointFailures.Count -gt 0)
  $originalTaskWaitFailure = @($originalTaskWait | Where-Object { $_.completed -ne $true }).Count -gt 0
  $contractFailure = ((($apiScorecardRequired -and $verifierExit -ne 0)) -or ($scheduleAuthorityExit -ne 0) -or ($masterContractExit -ne 0) -or ($writerRootAuthorityExit -ne 0) -or ($scheduleAlignmentExit -ne 0) -or ($scorecard88ContractExit -ne 0) -or ($strategy2UnifiedContractExit -ne 0))
  $runtimeHealthFailure = (($daytradeWriterVerifierDue -and $daytradeWriterVerifierExit -ne 0) -or ($stagedWarmupVerifierDue -and $stagedWarmupVerifierExit -ne 0))
  $dependencyBlocked = ($checkpointVerifierFailure -or $originalTaskStartFailure -or ($openingPreflightVerifierDue -and $openingPreflightVerifierExit -ne 0) -or ($openingReportVerifierDue -and $openingReportVerifierExit -ne 0) -or ($chipSourceVerifierDue -and $chipSourceVerifierExit -ne 0) -or ($telegramVerifierDue -and $telegramVerifierExit -ne 0) -or ($strategy2VerifierDue -and $strategy2VerifierExit -ne 0) -or ($strategy3VerifierDue -and $strategy3VerifierExit -ne 0) -or ($strategy4VerifierDue -and $strategy4VerifierExit -ne 0) -or ($eveningVerifierDue -and (($strategy5VerifierExit -ne 0) -or ($institutionVerifierExit -ne 0) -or ($institutionBattleVerifierExit -ne 0))) -or $scorecard88ReceiptFailure -or ($productionGateVerifierDue -and $productionGateVerifierExit -ne 0) -or ($cleanupVerifierDue -and $cleanupVerifierExit -ne 0) -or $dailyCheckpointCoverageFailure -or $priorCheckpointFailure -or $originalTaskWaitFailure)
  $canonicalFailClosed = (-not $checkpointVerifierFailure -and -not $scorecard88ReceiptFailure -and (
    ($strategy2VerifierDue -and $strategy2VerifierExit -ne 0) -or
    ($strategy3VerifierDue -and $strategy3VerifierExit -ne 0) -or
    ($strategy4VerifierDue -and $strategy4VerifierExit -ne 0) -or
    ($eveningVerifierDue -and (($strategy5VerifierExit -ne 0) -or ($institutionVerifierExit -ne 0)))
  ))
  $checkpointOk = (-not $contractFailure -and -not $runtimeHealthFailure -and -not $dependencyBlocked)
  $checkpointStatus = if ($checkpointOk -and $limitedSelfHealPerformed) { "SELF_HEALED_PASS" } elseif ($checkpointOk) { "PASS" } elseif ($canonicalFailClosed -or $contractFailure -or $runtimeHealthFailure -or ($checkpointVerifierFailure -and $checkpointFailureClass -eq "FAIL_CLOSED")) { "FAIL_CLOSED" } else { "BLOCKED" }
  $firstFailedCheckpointVerifier = @($checkpointVerifierChecks | Where-Object { $_.exitCode -ne 0 } | Select-Object -First 1)
  $firstBlocker = if ($originalTaskWaitFailure) { "original_task_natural_completion_timeout" }
    elseif ($dailyCheckpointCoverageFailure) { "daily_checkpoint_receipts_missing" }
    elseif ($priorCheckpointFailure) { "prior_checkpoint_failed:$([string]$priorCheckpointFailures[0].checkpointId):$([string]$(if ($priorCheckpointFailures[0].firstBlocker) { $priorCheckpointFailures[0].firstBlocker } else { $priorCheckpointFailures[0].status }))" }
    elseif ($canonicalFailClosed -and $strategy2VerifierDue -and $strategy2VerifierExit -ne 0) { "strategy2_canonical_fail_closed" }
    elseif ($canonicalFailClosed -and $strategy3VerifierDue -and $strategy3VerifierExit -ne 0) { "strategy3_canonical_fail_closed" }
    elseif ($originalTaskStartFailure) { "opening_limit_order_0840_natural_start_missing" }
    elseif ($canonicalFailClosed -and $strategy4VerifierDue -and $strategy4VerifierExit -ne 0) { "strategy4_canonical_fail_closed" }
    elseif ($canonicalFailClosed -and $eveningVerifierDue) { "evening_canonical_fail_closed" }
    elseif ($apiScorecardRequired -and $verifierExit -ne 0) { "api_unattended_scorecard_failed" }
    elseif ($checkpointVerifierFailure) { "checkpoint_specific_verifier_failed:$([string]$firstFailedCheckpointVerifier[0].verifier):$([string]$(if ($firstFailedCheckpointVerifier[0].reportedFirstBlocker) { $firstFailedCheckpointVerifier[0].reportedFirstBlocker } else { 'verifier_exit_nonzero' }))" }
    elseif ($scheduleAuthorityExit -ne 0) { "formal_schedule_authority_failed" }
    elseif ($masterContractExit -ne 0) { "terminal_master_self_contract_failed" }
    elseif ($writerRootAuthorityExit -ne 0) { "daytrade_writer_root_authority_failed" }
    elseif ($scheduleAlignmentExit -ne 0) { "schedule_registry_live_alignment_failed" }
    elseif ($scorecard88ContractExit -ne 0) { "scorecard88_contract_failed" }
    elseif ($strategy2UnifiedContractExit -ne 0) { "strategy2_unified_contract_failed" }
    elseif ($daytradeWriterVerifierDue -and $daytradeWriterVerifierExit -ne 0) { "daytrade_writer_checkpoint_health_failed" }
    elseif ($stagedWarmupVerifierDue -and $stagedWarmupVerifierExit -ne 0) { "daytrade_staged_warmup_failed" }
    elseif ($openingPreflightVerifierDue -and $openingPreflightVerifierExit -ne 0) { "opening_report_0820_preflight_blocked" }
    elseif ($openingReportVerifierDue -and $openingReportVerifierExit -ne 0) { "opening_report_0830_closure_blocked" }
    elseif ($chipSourceVerifierDue -and $chipSourceVerifierExit -ne 0) { "chip_source_readiness_blocked" }
    elseif ($telegramVerifierDue -and $telegramVerifierExit -ne 0) { "intraday_telegram_closure_blocked" }
    elseif ($strategy2VerifierDue -and $strategy2VerifierExit -ne 0) { "strategy2_canonical_closure_blocked" }
    elseif ($strategy3VerifierDue -and $strategy3VerifierExit -ne 0) { "strategy3_canonical_closure_blocked" }
    elseif ($strategy4VerifierDue -and $strategy4VerifierExit -ne 0) { "strategy4_canonical_closure_blocked" }
    elseif ($eveningVerifierDue -and $strategy5VerifierExit -ne 0) { "strategy5_canonical_closure_blocked" }
    elseif ($eveningVerifierDue -and $institutionVerifierExit -ne 0) { "institution_canonical_closure_blocked" }
    elseif ($eveningVerifierDue -and $institutionBattleVerifierExit -ne 0) { "institution_battle_closure_blocked" }
    elseif ($scorecard88ReceiptFailure) { "scorecard88_fixed_slot_collection_blocked" }
    elseif ($productionGateVerifierDue -and $productionGateVerifierExit -ne 0) { "production_gate_blocked" }
    elseif ($cleanupVerifierDue -and $cleanupVerifierExit -ne 0) { "cleanup_five_stage_closure_blocked" }
    else { $null }
  # Stable evidence envelope: every checkpoint receipt exposes the same audit fields.
  $canonicalEvidence = [ordered]@{
    tradeDate = $startedAt.ToString("yyyy-MM-dd")
    runId = $null
    expectedCount = $null
    scannedCount = $null
    resultCount = $null
    dataGapCount = $null
    formalWaterCoverageRatio = $null
    publishAllowed = $null
    complete = $null
    surfaceConsistency = [ordered]@{ required=$false; ok=$null; scope=$null }
    sourceReceipt = $null
  }
  $strategy2LiveReceipt = Join-Path $receiptDir "strategy2-v3-live.json"
  if ($checkpointId -eq "09:00" -and (Test-Path -LiteralPath $strategy2LiveReceipt)) {
    try {
      $s2Live = Get-Content -LiteralPath $strategy2LiveReceipt -Raw | ConvertFrom-Json
      $s2Coverage = $s2Live.sourceCoverage
      $canonicalEvidence.tradeDate = if ($s2Live.tradeDate) { [string]$s2Live.tradeDate } else { $canonicalEvidence.tradeDate }
      $canonicalEvidence.runId = [string]$s2Live.runId
      $canonicalEvidence.expectedCount = $s2Live.expectedCount
      $canonicalEvidence.scannedCount = $s2Live.scannedCount
      $canonicalEvidence.resultCount = $s2Live.resultCount
      $canonicalEvidence.dataGapCount = $s2Live.dataGapCount
      $ready = [double]$(if ($s2Coverage.formalIntradayOneMinuteReadySymbols) { $s2Coverage.formalIntradayOneMinuteReadySymbols } else { 0 })
      $expected = [double]$(if ($s2Live.expectedCount) { $s2Live.expectedCount } else { 0 })
      $canonicalEvidence.formalWaterCoverageRatio = if ($expected -gt 0) { [math]::Round($ready / $expected, 6) } else { 0 }
      $canonicalEvidence.publishAllowed = $s2Live.publishAllowed
      $canonicalEvidence.complete = $s2Live.complete
      $canonicalEvidence.surfaceConsistency = [ordered]@{ required=$false; ok=$null; scope="not_due_until_12:40" }
      $canonicalEvidence.sourceReceipt = $strategy2LiveReceipt
    } catch { }
  } elseif ($strategy2VerifierDue -and (Test-Path -LiteralPath $strategy2VerifierReceipt)) {
    try {
      $s2 = Get-Content -LiteralPath $strategy2VerifierReceipt -Raw | ConvertFrom-Json
      $s2RowCheck = @($s2.checks | Where-Object { $_.code -eq "scorecard_strategy2_row_run_id_matches" }) | Select-Object -First 1
      $s2CountCheck = @($s2.checks | Where-Object { $_.code -eq "tri_surface_result_count_matches" }) | Select-Object -First 1
      $s2DateCheck = @($s2.checks | Where-Object { $_.code -eq "tri_surface_trade_date_matches" }) | Select-Object -First 1
      $s2Row = $s2RowCheck.evidence.row
      $canonicalEvidence.tradeDate = if ($s2Row.tradeDate) { [string]$s2Row.tradeDate } else { $canonicalEvidence.tradeDate }
      $canonicalEvidence.runId = if ($s2.expectedRunId) { [string]$s2.expectedRunId } else { [string]$s2Row.runId }
      $canonicalEvidence.scannedCount = $s2Row.scannedCount
      $canonicalEvidence.resultCount = if ($s2CountCheck) { $s2CountCheck.evidence.expectedResultCount } else { $s2Row.resultCount }
      $canonicalEvidence.publishAllowed = $s2Row.publishAllowed
      $canonicalEvidence.complete = $s2Row.complete
      $canonicalEvidence.surfaceConsistency = [ordered]@{ required=$true; ok=[bool]($s2CountCheck.ok -and $s2DateCheck.ok); scope="desktop_mobile_api_scorecard_88" }
      $canonicalEvidence.sourceReceipt = $strategy2VerifierReceipt
    } catch {
      $canonicalEvidence.surfaceConsistency = [ordered]@{ required=$true; ok=$false; scope="desktop_mobile_api_scorecard_88" }
    }
  } elseif ($strategy3VerifierDue) {
    $s3Receipt = Join-Path $receiptDir ("strategy3-v2-daily-unattended-closure-{0}.json" -f $startedAt.ToString("yyyyMMdd"))
    if (Test-Path -LiteralPath $s3Receipt) {
      try {
        $s3 = Get-Content -LiteralPath $s3Receipt -Raw | ConvertFrom-Json
        $canonicalEvidence.tradeDate = [string]$s3.trade_date
        $canonicalEvidence.runId = [string]$s3.run_id
        $canonicalEvidence.scannedCount = $s3.scanned_count
        $canonicalEvidence.resultCount = $s3.result_count
        $canonicalEvidence.publishAllowed = $s3.publish_allowed
        $canonicalEvidence.complete = [bool]$s3.ok
        $canonicalEvidence.surfaceConsistency = [ordered]@{ required=$true; ok=[bool]$s3.ok; scope="supabase_api_terminal_telegram_88" }
        $canonicalEvidence.sourceReceipt = $s3Receipt
      } catch {
        $canonicalEvidence.surfaceConsistency = [ordered]@{ required=$true; ok=$false; scope="supabase_api_terminal_telegram_88" }
      }
    }
  } elseif ($strategy4VerifierDue) {
    $s4Receipt = Join-Path $receiptDir "strategy4.json"
    if (Test-Path -LiteralPath $s4Receipt) {
      try {
        $s4 = Get-Content -LiteralPath $s4Receipt -Raw | ConvertFrom-Json
        $canonicalEvidence.tradeDate = if ($s4.marketDate) { [string]$s4.marketDate } else { $canonicalEvidence.tradeDate }
        $canonicalEvidence.runId = [string]$s4.runId
        $canonicalEvidence.scannedCount = $s4.scanned
        $canonicalEvidence.expectedCount = $s4.total
        $canonicalEvidence.resultCount = $s4.matches
        $canonicalEvidence.complete = [bool]$s4.complete
        $canonicalEvidence.surfaceConsistency = [ordered]@{ required=$true; ok=($strategy4VerifierExit -eq 0); scope="desktop_mobile_api_88" }
        $canonicalEvidence.sourceReceipt = $s4Receipt
      } catch {
        $canonicalEvidence.surfaceConsistency = [ordered]@{ required=$true; ok=$false; scope="desktop_mobile_api_88" }
      }
    }
  } elseif ($eveningVerifierDue) {
    $s5Receipt = Join-Path $receiptDir "strategy5.json"
    if (Test-Path -LiteralPath $s5Receipt) {
      try {
        $s5 = Get-Content -LiteralPath $s5Receipt -Raw | ConvertFrom-Json
        $canonicalEvidence.tradeDate = if ($s5.marketDate) { [string]$s5.marketDate } else { $canonicalEvidence.tradeDate }
        $canonicalEvidence.runId = [string]$s5.runId
        $canonicalEvidence.scannedCount = $s5.scanned
        $canonicalEvidence.expectedCount = $s5.total
        $canonicalEvidence.resultCount = $s5.matches
        $canonicalEvidence.complete = [bool]$s5.complete
        $canonicalEvidence.surfaceConsistency = [ordered]@{ required=$true; ok=(($strategy5VerifierExit -eq 0) -and ($institutionVerifierExit -eq 0) -and ($institutionBattleVerifierExit -eq 0)); scope="strategy5_institution_battle_terminal_api_88" }
        $canonicalEvidence.sourceReceipt = $s5Receipt
      } catch {
        $canonicalEvidence.surfaceConsistency = [ordered]@{ required=$true; ok=$false; scope="strategy5_institution_battle_terminal_api_88" }
      }
    }
  }
  $finishedAt = Get-Date
  [ordered]@{
    checkpointContract = [ordered]@{
      name = $checkpointContract.name
      owner = if ($checkpointContract.owner) { $checkpointContract.owner } else { "MASTER_CONTROLLER" }
      disposition = if ($checkpointContract.disposition) { $checkpointContract.disposition } else { "VERIFIED_BY_THIS_CONTROLLER" }
      hardGate = $checkpointContract.hardGate
      verifiers = @($checkpointContract.verifiers)
    }
    checkpointVerifierChecks = $checkpointVerifierChecks
    originalTaskWait = $originalTaskWait
    originalTaskWaitFailure = $originalTaskWaitFailure
    dailyCheckpointCoverage = $dailyCheckpointCoverage
    dailyCheckpointResults = $dailyCheckpointResults
    priorCheckpointFailures = $priorCheckpointFailures
    tradeDate = $canonicalEvidence.tradeDate
    originalTaskStart = $originalTaskStart
    originalTaskStartFailure = $originalTaskStartFailure
    runId = $canonicalEvidence.runId
    keyCounts = [ordered]@{
      expectedCount = $canonicalEvidence.expectedCount
      scannedCount = $canonicalEvidence.scannedCount
      resultCount = $canonicalEvidence.resultCount
      dataGapCount = $canonicalEvidence.dataGapCount
      formalWaterCoverageRatio = $canonicalEvidence.formalWaterCoverageRatio
    }
    publishAllowed = $canonicalEvidence.publishAllowed
    complete = $canonicalEvidence.complete
    surfaceConsistency = $canonicalEvidence.surfaceConsistency
    canonicalEvidenceSource = $canonicalEvidence.sourceReceipt
    contract = "fuman-master-checkpoint-runner-v1"
    mode = $auditMode
    checkpointId = if ($effectiveMode -eq "Full") { "23:10-final" } else { $checkpointId }
    fullDayAudit = ($effectiveMode -eq "Full")
    ok = $checkpointOk
    status = $checkpointStatus
    allowedStatuses = @("PASS", "SELF_HEALED_PASS", "FAIL_CLOSED", "BLOCKED")
    firstBlocker = $firstBlocker
    limitedSelfHealPerformed = $limitedSelfHealPerformed
    startedAt = $startedAt.ToString("o")
    limitedSelfHealActions = $limitedSelfHealActions
    finishedAt = $finishedAt.ToString("o")
    durationSeconds = [math]::Round(($finishedAt - $startedAt).TotalSeconds, 3)
    verifierExitCode = $verifierExit
    scheduleAuthorityExitCode = $scheduleAuthorityExit
    masterContractExitCode = $masterContractExit
    writerRootAuthorityExitCode = $writerRootAuthorityExit
    chipSourceVerifierDue = $chipSourceVerifierDue
    chipSourceVerifierExitCode = $chipSourceVerifierExit
    apiScorecardRequired = $apiScorecardRequired
    chipSourceVerifierReceipt = $chipSourceVerifierReceipt
    telegramVerifierDue = $telegramVerifierDue
    telegramVerifierExitCode = $telegramVerifierExit
    telegramVerifierPassed = $telegramVerifierPassed
    strategy2VerifierDue = $strategy2VerifierDue
    strategy2VerifierExitCode = $strategy2VerifierExit
    scheduleAlignmentExitCode = $scheduleAlignmentExit
    scorecard88ContractExitCode = $scorecard88ContractExit
    strategy2UnifiedContractExitCode = $strategy2UnifiedContractExit
    daytradeWriterVerifierDue = $daytradeWriterVerifierDue
    daytradeWriterVerifierExitCode = $daytradeWriterVerifierExit
    daytradeWriterVerifierReceipt = $daytradeWriterVerifierReceipt
    stagedWarmupVerifierDue = $stagedWarmupVerifierDue
    stagedWarmupVerifierExitCode = $stagedWarmupVerifierExit
    openingPreflightVerifierDue = $openingPreflightVerifierDue
    openingPreflightVerifierExitCode = $openingPreflightVerifierExit
    openingReportVerifierDue = $openingReportVerifierDue
    openingReportVerifierExitCode = $openingReportVerifierExit
    openingReportVerifierReceipt = $openingReportVerifierReceipt
    recoveryPolicy = [ordered]@{
      allowed = @("start_stopped_unique_collector_once","start_missed_original_writer_once","start_missed_original_chip_source_sync_once","rerun_read_only_verifier")
      forbidden = @("second_canonical_run","verifier_executes_strategy_or_scan","yesterday_or_legacy_as_today","overwrite_supabase_for_blank_ui","surface_recalculation","delete_today_canonical_or_scorecards","continuous_redeploy")
      strategyExecutionAllowed = $false
      scannerApplyAllowed = $false
      deploymentAllowed = $false
      killedProcess = $false
    }
    strategy2VerifierReceipt = $strategy2VerifierReceipt
    strategy3VerifierDue = $strategy3VerifierDue
    strategy3VerifierExitCode = $strategy3VerifierExit
    strategy4VerifierDue = $strategy4VerifierDue
    strategy4VerifierExitCode = $strategy4VerifierExit
    eveningVerifierDue = $eveningVerifierDue
    checkpointFailureClass = $checkpointFailureClass
    strategy5VerifierExitCode = $strategy5VerifierExit
    institutionVerifierExitCode = $institutionVerifierExit
    institutionBattleVerifierExitCode = $institutionBattleVerifierExit
    scorecard88ReceiptChecks = $scorecard88ReceiptChecks
    scorecard88ReceiptFailure = $scorecard88ReceiptFailure
    productionGateVerifierDue = $productionGateVerifierDue
    productionGateVerifierExitCode = $productionGateVerifierExit
    cleanupVerifierDue = $cleanupVerifierDue
    cleanupVerifierExitCode = $cleanupVerifierExit
    cleanupVerifierReceipt = $cleanupVerifierFile
    strategyExecutionAllowed = $false
    scannerApplyAllowed = $false
    deploymentAllowed = $false
    killedProcess = $false
    scorecardJson = $jsonFile
    scorecardMarkdown = $mdFile
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptFile -Encoding UTF8
  Copy-Item -LiteralPath $receiptFile -Destination $receiptHistoryFile -Force
  if (-not $checkpointOk) {
    $env:FUMAN_ALERT_SOURCE = "Fuman Terminal Master Control"
    $env:FUMAN_ALERT_SUBJECT = "Fuman master control blocker detected"
    $env:FUMAN_ALERT_TEXT = "The read-only master verifier returned $checkpointStatus at checkpoint $($startedAt.ToString('HH:mm')); firstBlocker=$firstBlocker. No scan, retry, publish, or deployment was started. Receipt: $receiptHistoryFile"
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\send-workflow-alert.js") --kind master-control --receipt $alertReceiptFile
  }
  # Fail closed with a real scheduler failure code. Never retry or create a second formal run.
  if ($checkpointOk) { exit 0 }
  exit 1
} catch {
  $finishedAt = Get-Date
  [ordered]@{
    contract = "fuman-master-checkpoint-runner-v1"
    mode = $auditMode
    checkpointId = if ($effectiveMode -eq "Full") { "23:10-final" } else { $checkpointId }
    fullDayAudit = ($effectiveMode -eq "Full")
    ok = $false
    status = "FAIL_CLOSED"
    allowedStatuses = @("PASS", "SELF_HEALED_PASS", "FAIL_CLOSED", "BLOCKED")
    firstBlocker = "master_controller_exception"
    tradeDate = $startedAt.ToString("yyyy-MM-dd")
    runId = $null
    keyCounts = [ordered]@{ expectedCount=$null; scannedCount=$null; resultCount=$null; dataGapCount=$null; formalWaterCoverageRatio=$null }
    publishAllowed = $null
    complete = $null
    surfaceConsistency = [ordered]@{ required=$false; ok=$null; scope=$null }
    canonicalEvidenceSource = $null
    limitedSelfHealPerformed = $false
    startedAt = $startedAt.ToString("o")
    finishedAt = $finishedAt.ToString("o")
    durationSeconds = [math]::Round(($finishedAt - $startedAt).TotalSeconds, 3)
    verifierExitCode = 1
    strategyExecutionAllowed = $false
    scannerApplyAllowed = $false
    deploymentAllowed = $false
    killedProcess = $false
    error = $_.Exception.Message
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptFile -Encoding UTF8
  Copy-Item -LiteralPath $receiptFile -Destination $receiptHistoryFile -Force
  Send-FumanMasterAlert -Status "FAIL_CLOSED" -FirstBlocker "master_controller_exception" -ReceiptPath $receiptHistoryFile
  exit 1
} finally {
  if ($mutexOwned) { try { $mutex.ReleaseMutex() } catch { } }
  if ($mutex) { $mutex.Dispose() }
}
