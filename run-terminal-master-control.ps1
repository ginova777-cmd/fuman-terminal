param(
  [string]$ProjectRoot = $PSScriptRoot,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [ValidateSet("Auto", "Checkpoint", "Full", "CleanupMaintenance")]
  [string]$Mode = "Auto",
  [string]$MaintenanceAuthorizationFile = "",
  [switch]$RequireProtectedReadback
)

$ErrorActionPreference = "Stop"
$startedAt = Get-Date
$effectiveMode = $Mode
if ($effectiveMode -eq "Auto") {
  $effectiveMode = if ($startedAt.TimeOfDay -ge [TimeSpan]::Parse("23:10") -and $startedAt.TimeOfDay -lt [TimeSpan]::Parse("23:59")) { "Full" } else { "Checkpoint" }
}

$env:FUMAN_RUNTIME_DIR = $RuntimeRoot
if ($RequireProtectedReadback) { $env:FUMAN_REQUIRE_PROTECTED_READBACK = "1" }
$auditMode = if ($effectiveMode -eq "Full") { "full_day_read_only_audit" } else { "read_only_checkpoint" }
$receiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
$reportDir = Join-Path $RuntimeRoot "reports"
$lockDir = Join-Path $RuntimeRoot "locks"
$mutexName = "Global\FumanTerminalMasterControl"
$receiptFile = Join-Path $receiptDir "terminal-master-checkpoint-latest.json"
$receiptHistoryFile = Join-Path $receiptDir ("terminal-master-checkpoint-{0}.json" -f $startedAt.ToString("yyyyMMdd-HHmmss"))
$alertReceiptFile = Join-Path $receiptDir ("terminal-master-alert-{0}.json" -f $startedAt.ToString("yyyyMMdd-HHmmss"))
$jsonFile = Join-Path $RuntimeRoot "state\api-unattended-scorecard.json"
$mdFile = Join-Path $reportDir "api-unattended-scorecard.md"
New-Item -ItemType Directory -Force -Path $receiptDir,$reportDir,$lockDir,(Split-Path -Parent $jsonFile) | Out-Null

 . (Join-Path $PSScriptRoot 'lib/tom-runtime.ps1')
$script:TomDate=$startedAt.ToString('yyyy-MM-dd')
$script:TomRun='tom-root-'+$startedAt.ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N')
$script:TomJournal=Join-Path $receiptDir ($script:TomRun+'.jsonl')
$script:TomTimeoutMs=300000
$script:TomDeadline=[DateTimeOffset]::UtcNow.AddMinutes(15)
$script:TomKilledChild=$false
Write-TomJournal 'STARTED' 'root'
$mutex=$null
$mutexOwned = $false
try {
  $mutex = [System.Threading.Mutex]::new($false, $mutexName)
  try { $mutexOwned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $mutexOwned=$true; Write-TomJournal 'ABANDONED_MUTEX_ACQUIRED' 'mutex' }
  if (-not $mutexOwned) {
    # Never overlap verifiers and never start a strategy as compensation.
    Write-TomJournal 'BLOCKED_LOCK_BUSY' 'mutex' 2
    Write-TomEvent 'BLOCKED_LOCK_BUSY'
    exit 2
  }
  Initialize-TomTakeover
  Set-Location $ProjectRoot
  Invoke-TomNode (Join-Path $ProjectRoot "scripts\verify-verifier-retirement.js") --require-live
  if ($LASTEXITCODE -ne 0) { throw "VERIFIER_AUTHORITY_DRIFT" }
  if ($effectiveMode -eq "CleanupMaintenance") {
    if (-not $MaintenanceAuthorizationFile) { throw "CleanupMaintenance requires explicit authorization file" }
    Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\verify-release-root-authority.js") --require-production-root
    if ($LASTEXITCODE -ne 0) { throw "RELEASE_ROOT_DRIFT" }
    Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\verify-daily-retention-maintenance.js") "--maintenance-authorization=$MaintenanceAuthorizationFile"
    $maintenanceExit = [int]$LASTEXITCODE
    # The canonical cleanup verifier writes a scope-specific receipt. Never relabel a full-system checkpoint.
    exit $maintenanceExit
  }
  $marketCalendarOutput = Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\check-market-calendar-action.js") "--label=terminal-master-control" 2>$null
  $marketCalendarExit = [int]$LASTEXITCODE
  $marketOpenToday = ($marketCalendarExit -eq 0)
  if ($marketCalendarExit -notin @(0, 10)) { throw "market calendar check failed exit=$marketCalendarExit output=$($marketCalendarOutput -join ' ')" }
  $env:FUMAN_API_UNATTENDED_SCORECARD_FILE = $jsonFile
  $env:FUMAN_API_UNATTENDED_REPORT_FILE = $mdFile
  Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\verify-api-unattended-scorecard.js")
  $verifierExit = [int]$LASTEXITCODE
  Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\verify-formal-strategy-schedule-authority.js")
  $scheduleAuthorityExit = [int]$LASTEXITCODE
  $chipSourceVerifierDue = ($marketOpenToday -and ($startedAt.TimeOfDay -ge [TimeSpan]::Parse("20:05")))
  Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\verify-fuman-schedule-registry-live-alignment.js")
  $scheduleAlignmentExit = [int]$LASTEXITCODE
  Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\verify-scorecard88-fixed-collection-contract.js")
  $scorecard88ContractExit = [int]$LASTEXITCODE
  $daytradeWriterVerifierDue = ($marketOpenToday -and ($startedAt.TimeOfDay -ge [TimeSpan]::Parse("06:05")) -and ($startedAt.TimeOfDay -le [TimeSpan]::Parse("13:35")))
  $daytradeWriterVerifierExit = $null
  $daytradeWriterVerifierReceipt = Join-Path $receiptDir ("daytrade-writer-checkpoint-health-{0}.json" -f $startedAt.ToString("yyyyMMdd"))
  if ($daytradeWriterVerifierDue) {
    # Local readback only: task metadata, wrapper completion log, V2 status and Mother Pool receipt.
    # It never queries Supabase and never starts a writer, collector, strategy or retry.
    Invoke-TomNode (Join-Path $ProjectRoot "scripts\verify-daytrade-writer-checkpoint-health.js") "--trade-date=$($startedAt.ToString('yyyy-MM-dd'))"
    $daytradeWriterVerifierExit = [int]$LASTEXITCODE
  }
  $chipSourceVerifierExit = $null
  $chipSourceVerifierReceipt = Join-Path $receiptDir "chip-source-sync.json"
  if ($chipSourceVerifierDue) {
    Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\verify-chip-source-sync-receipt.js")
    $chipSourceVerifierExit = [int]$LASTEXITCODE
  }
  $telegramVerifierDue = ($marketOpenToday -and ($startedAt.TimeOfDay -ge [TimeSpan]::Parse("09:00")))
  $telegramVerifierExit = $null
  if ($telegramVerifierDue) {
    Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\verify-telegram-three-detectors.js") --require-live --require-today
    $telegramVerifierExit = [int]$LASTEXITCODE
  }
  $strategy2Task = Get-ScheduledTask -TaskName 'Fuman Strategy2 Unified 0845-1230' -ErrorAction Stop
  $strategy2Paused = ([string]$strategy2Task.State -eq 'Disabled')
  $strategy2VerifierDue = (-not $strategy2Paused -and $marketOpenToday -and ($startedAt.TimeOfDay -ge [TimeSpan]::Parse("12:30")))
  $strategy2VerifierExit = $null
  $strategy2VerifierReceipt = Join-Path $receiptDir "strategy2-tri-surface-canonical-latest.json"
  if ($strategy2VerifierDue) {
    # This is the only Strategy2 closure authority. It is read-only and never starts a retry.
    Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\verify-strategy2-terminal-visible-readback.js")
    $strategy2VerifierExit = [int]$LASTEXITCODE
  }
  $cleanupVerifierDue = ($effectiveMode -eq "Full" -and $marketOpenToday)
  $cleanupVerifierExit = $null
  $cleanupVerifierFile = Join-Path $RuntimeRoot ("status\daily-retention-maintenance-verifier-{0}.json" -f $startedAt.ToString("yyyyMMdd"))
  if ($cleanupVerifierDue) {
    # Final-only and read-only: this reads cleanup receipts and protected windows.
    # It never starts cleanup, a strategy scan, a retry, or a deployment.
    Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\verify-daily-retention-maintenance.js")
    $cleanupVerifierExit = [int]$LASTEXITCODE
  }
  $contractFailure = (($verifierExit -ne 0) -or ($scheduleAuthorityExit -ne 0) -or ($scheduleAlignmentExit -ne 0) -or ($scorecard88ContractExit -ne 0))
  $runtimeHealthFailure = ($daytradeWriterVerifierDue -and $daytradeWriterVerifierExit -ne 0)
  $dependencyBlocked = (($chipSourceVerifierDue -and $chipSourceVerifierExit -ne 0) -or ($telegramVerifierDue -and $telegramVerifierExit -ne 0) -or ($strategy2VerifierDue -and $strategy2VerifierExit -ne 0) -or ($cleanupVerifierDue -and $cleanupVerifierExit -ne 0))
  $checkpointOk = (-not $contractFailure -and -not $runtimeHealthFailure -and -not $dependencyBlocked)
  $limitedSelfHealPerformed = $false
  $checkpointStatus = if ($checkpointOk -and $limitedSelfHealPerformed) { "SELF_HEALED_PASS" } elseif ($checkpointOk) { "PASS" } elseif ($contractFailure -or $runtimeHealthFailure) { "FAIL_CLOSED" } else { "BLOCKED" }
  $firstBlocker = if ($verifierExit -ne 0) { "api_unattended_scorecard_failed" }
    elseif ($scheduleAuthorityExit -ne 0) { "formal_schedule_authority_failed" }
    elseif ($scheduleAlignmentExit -ne 0) { "schedule_registry_live_alignment_failed" }
    elseif ($scorecard88ContractExit -ne 0) { "scorecard88_contract_failed" }
    elseif ($daytradeWriterVerifierDue -and $daytradeWriterVerifierExit -ne 0) { "daytrade_writer_checkpoint_health_failed" }
    elseif ($chipSourceVerifierDue -and $chipSourceVerifierExit -ne 0) { "chip_source_readiness_blocked" }
    elseif ($telegramVerifierDue -and $telegramVerifierExit -ne 0) { "intraday_telegram_closure_blocked" }
    elseif ($strategy2VerifierDue -and $strategy2VerifierExit -ne 0) { "strategy2_canonical_closure_blocked" }
    elseif ($cleanupVerifierDue -and $cleanupVerifierExit -ne 0) { "cleanup_five_stage_closure_blocked" }
    else { $null }
  $strategyObservation = @{scope='receipt_only';complete=$false;status='MANIFEST_NOT_CONFIGURED';rows=@()}
  $generatedManifest = Invoke-TomNode (Join-Path $ProjectRoot 'scripts/build-tom-manifest.cjs') $RuntimeRoot
  if ($LASTEXITCODE -ne 0) { throw 'TOM_MANIFEST_GENERATION_FAILED' }
  $manifestBundle = $generatedManifest | ConvertFrom-Json
  $observationManifest = Join-Path $receiptDir ("tom-manifest-{0}.json" -f $script:TomRun)
  $manifestBundle.manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $observationManifest -Encoding utf8
  if (Test-Path -LiteralPath $observationManifest) {
    $observationOutput = Invoke-TomNode (Join-Path $ProjectRoot 'scripts/read-tom-strategy-receipts.cjs') $observationManifest "--as-of=$script:TomDate"
    if ($LASTEXITCODE -ne 0) { throw 'TOM_RECEIPT_OBSERVATION_FAILED' }
    $strategyObservation = $observationOutput | ConvertFrom-Json
  }
  if ($strategyObservation.complete -ne $true) {
    $checkpointOk = $false
    if (-not $firstBlocker) { $firstBlocker = 'tom_strategy_acceptance_incomplete'; $checkpointStatus = 'BLOCKED' }
  }
  $finishedAt = Get-Date
  [ordered]@{
    contract = "fuman-master-checkpoint-runner-v1"
    trade_date = $script:TomDate
    runId = $script:TomRun
    journal = $script:TomJournal
    mode = $auditMode
    checkpointId = if ($effectiveMode -eq "Full") { "23:10-final" } else { $startedAt.ToString("HH:mm") }
    fullDayAudit = ($effectiveMode -eq "Full")
    ok = $checkpointOk
    status = $checkpointStatus
    allowedStatuses = @("PASS", "SELF_HEALED_PASS", "FAIL_CLOSED", "BLOCKED")
    firstBlocker = $firstBlocker
    limitedSelfHealPerformed = $limitedSelfHealPerformed
    startedAt = $startedAt.ToString("o")
    finishedAt = $finishedAt.ToString("o")
    durationSeconds = [math]::Round(($finishedAt - $startedAt).TotalSeconds, 3)
    verifierExitCode = $verifierExit
    scheduleAuthorityExitCode = $scheduleAuthorityExit
    chipSourceVerifierDue = $chipSourceVerifierDue
    chipSourceVerifierExitCode = $chipSourceVerifierExit
    chipSourceVerifierReceipt = $chipSourceVerifierReceipt
    telegramVerifierDue = $telegramVerifierDue
    telegramVerifierExitCode = $telegramVerifierExit
    strategy2VerifierDue = $strategy2VerifierDue
    strategy2VerifierExitCode = $strategy2VerifierExit
    scheduleAlignmentExitCode = $scheduleAlignmentExit
    scorecard88ContractExitCode = $scorecard88ContractExit
    marketOpenToday = $marketOpenToday
    marketCalendarExitCode = $marketCalendarExit
    daytradeWriterVerifierDue = $daytradeWriterVerifierDue
    daytradeWriterVerifierExitCode = $daytradeWriterVerifierExit
    daytradeWriterVerifierReceipt = $daytradeWriterVerifierReceipt
    strategy2VerifierReceipt = $strategy2VerifierReceipt
    cleanupVerifierDue = $cleanupVerifierDue
    cleanupVerifierExitCode = $cleanupVerifierExit
    cleanupVerifierReceipt = $cleanupVerifierFile
    strategyExecutionAllowed = $false
    scannerApplyAllowed = $false
    deploymentAllowed = $false
    killedProcess = $script:TomKilledChild
    strategyObservation = $strategyObservation
    scorecardJson = $jsonFile
    scorecardMarkdown = $mdFile
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptFile -Encoding UTF8
  Copy-Item -LiteralPath $receiptFile -Destination $receiptHistoryFile -Force
  if (@($strategyObservation.rows).Count -gt 0) {
    Invoke-TomNode (Join-Path $ProjectRoot 'scripts/record-tom-business-events.cjs') $receiptHistoryFile (Join-Path $RuntimeRoot 'data/tom-business-events')
    if ($LASTEXITCODE -ne 0) { throw 'TOM_BUSINESS_EVENT_PERSISTENCE_FAILED' }
  }
  Write-TomJournal 'BUSINESS_VERIFIED' $checkpointStatus $(if($checkpointOk){0}else{1})
  Write-TomEvent $checkpointStatus
  if ($false) { # Existing external notifications stay disabled until Phase 4 approval.
    $env:FUMAN_ALERT_SOURCE = "Fuman Terminal Master Control"
    $env:FUMAN_ALERT_SUBJECT = "Fuman master control blocker detected"
    $env:FUMAN_ALERT_TEXT = "The read-only master verifier returned $checkpointStatus at checkpoint $($startedAt.ToString('HH:mm')); firstBlocker=$firstBlocker. No scan, retry, publish, or deployment was started. Receipt: $receiptHistoryFile"
    Invoke-TomNode --use-system-ca (Join-Path $ProjectRoot "scripts\send-workflow-alert.js") --kind master-control --receipt $alertReceiptFile
  }
  # Fail closed with a real scheduler failure code. Never retry or create a second formal run.
  if ($checkpointOk) { exit 0 }
  exit 1
 } catch {
  Write-TomJournal 'FAILED' 'root_exception' 1
  Write-TomEvent 'FAILED'
  $finishedAt = Get-Date
  [ordered]@{
    contract = "fuman-master-checkpoint-runner-v1"
    trade_date = $script:TomDate
    runId = $script:TomRun
    journal = $script:TomJournal
    mode = $auditMode
    checkpointId = if ($effectiveMode -eq "Full") { "23:10-final" } else { $startedAt.ToString("HH:mm") }
    fullDayAudit = ($effectiveMode -eq "Full")
    ok = $false
    status = "FAIL_CLOSED"
    allowedStatuses = @("PASS", "SELF_HEALED_PASS", "FAIL_CLOSED", "BLOCKED")
    firstBlocker = "master_controller_exception"
    limitedSelfHealPerformed = $false
    startedAt = $startedAt.ToString("o")
    finishedAt = $finishedAt.ToString("o")
    durationSeconds = [math]::Round(($finishedAt - $startedAt).TotalSeconds, 3)
    verifierExitCode = 1
    strategyExecutionAllowed = $false
    scannerApplyAllowed = $false
    deploymentAllowed = $false
    killedProcess = $script:TomKilledChild
    error = $_.Exception.Message
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptFile -Encoding UTF8
  Copy-Item -LiteralPath $receiptFile -Destination $receiptHistoryFile -Force
  exit 1
 } finally {
  Write-TomJournal 'ENDED' 'root'
  if ($mutexOwned) { try { $mutex.ReleaseMutex() } catch { } }
  if ($mutex) { $mutex.Dispose() }
}






