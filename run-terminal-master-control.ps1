param(
  [string]$ProjectRoot = $PSScriptRoot,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [ValidateSet("Auto", "Checkpoint", "Full")]
  [string]$Mode = "Auto",
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

$mutex = [System.Threading.Mutex]::new($false, $mutexName)
$mutexOwned = $false
try {
  $mutexOwned = $mutex.WaitOne(0)
  if (-not $mutexOwned) {
    # Never overlap verifiers and never start a strategy as compensation.
    exit 0
  }
  Set-Location $ProjectRoot
  $env:FUMAN_API_UNATTENDED_SCORECARD_FILE = $jsonFile
  $env:FUMAN_API_UNATTENDED_REPORT_FILE = $mdFile
  & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-api-unattended-scorecard.js")
  $verifierExit = [int]$LASTEXITCODE
  & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-formal-strategy-schedule-authority.js")
  $scheduleAuthorityExit = [int]$LASTEXITCODE
  $chipSourceVerifierDue = (($startedAt.DayOfWeek -ne [DayOfWeek]::Saturday) -and ($startedAt.DayOfWeek -ne [DayOfWeek]::Sunday) -and ($startedAt.TimeOfDay -ge [TimeSpan]::Parse("20:05")))
  & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-fuman-schedule-registry-live-alignment.js")
  $scheduleAlignmentExit = [int]$LASTEXITCODE
  $chipSourceVerifierExit = $null
  $chipSourceVerifierReceipt = Join-Path $receiptDir "chip-source-sync.json"
  if ($chipSourceVerifierDue) {
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-chip-source-sync-receipt.js")
    $chipSourceVerifierExit = [int]$LASTEXITCODE
  }
  $telegramVerifierDue = (($startedAt.DayOfWeek -ne [DayOfWeek]::Saturday) -and ($startedAt.DayOfWeek -ne [DayOfWeek]::Sunday) -and ($startedAt.TimeOfDay -ge [TimeSpan]::Parse("09:00")))
  $telegramVerifierExit = $null
  if ($telegramVerifierDue) {
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-daytrade-intraday-burst-telegram.js") --require-live --require-today
    $telegramVerifierExit = [int]$LASTEXITCODE
  }
  $strategy2VerifierDue = (($startedAt.DayOfWeek -ne [DayOfWeek]::Saturday) -and ($startedAt.DayOfWeek -ne [DayOfWeek]::Sunday) -and ($startedAt.TimeOfDay -ge [TimeSpan]::Parse("12:30")))
  $strategy2VerifierExit = $null
  $strategy2VerifierReceipt = Join-Path $receiptDir "strategy2-tri-surface-canonical-latest.json"
  if ($strategy2VerifierDue) {
    # This is the only Strategy2 closure authority. It is read-only and never starts a retry.
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-strategy2-terminal-visible-readback.js")
    $strategy2VerifierExit = [int]$LASTEXITCODE
  }
  $cleanupVerifierDue = ($effectiveMode -eq "Full")
  $cleanupVerifierExit = $null
  $cleanupVerifierFile = Join-Path $RuntimeRoot ("status\daily-retention-maintenance-verifier-{0}.json" -f $startedAt.ToString("yyyyMMdd"))
  if ($cleanupVerifierDue) {
    # Final-only and read-only: this reads cleanup receipts and protected windows.
    # It never starts cleanup, a strategy scan, a retry, or a deployment.
    & node --use-system-ca (Join-Path $ProjectRoot "scripts\verify-daily-retention-maintenance.js")
    $cleanupVerifierExit = [int]$LASTEXITCODE
  }
  $finishedAt = Get-Date
  [ordered]@{
    contract = "fuman-master-checkpoint-runner-v1"
    mode = $auditMode
    checkpointId = if ($effectiveMode -eq "Full") { "23:10-final" } else { $startedAt.ToString("HH:mm") }
    fullDayAudit = ($effectiveMode -eq "Full")
    ok = (($verifierExit -eq 0) -and ($scheduleAuthorityExit -eq 0) -and ($scheduleAlignmentExit -eq 0) -and (-not $chipSourceVerifierDue -or $chipSourceVerifierExit -eq 0) -and (-not $telegramVerifierDue -or $telegramVerifierExit -eq 0) -and (-not $strategy2VerifierDue -or $strategy2VerifierExit -eq 0) -and (-not $cleanupVerifierDue -or $cleanupVerifierExit -eq 0))
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
    strategy2VerifierReceipt = $strategy2VerifierReceipt
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
  $checkpointOk = (($verifierExit -eq 0) -and ($scheduleAuthorityExit -eq 0) -and ($scheduleAlignmentExit -eq 0) -and (-not $chipSourceVerifierDue -or $chipSourceVerifierExit -eq 0) -and (-not $telegramVerifierDue -or $telegramVerifierExit -eq 0) -and (-not $strategy2VerifierDue -or $strategy2VerifierExit -eq 0) -and (-not $cleanupVerifierDue -or $cleanupVerifierExit -eq 0))
  if (-not $checkpointOk) {
    $env:FUMAN_ALERT_SOURCE = "Fuman Terminal Master Control"
    $env:FUMAN_ALERT_SUBJECT = "Fuman master control blocker detected"
    $env:FUMAN_ALERT_TEXT = "The read-only master verifier detected a hard blocker at checkpoint $($startedAt.ToString('HH:mm')). No scan, retry, publish, or deployment was started. Receipt: $receiptHistoryFile"
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
    checkpointId = if ($effectiveMode -eq "Full") { "23:10-final" } else { $startedAt.ToString("HH:mm") }
    fullDayAudit = ($effectiveMode -eq "Full")
    ok = $false
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
  exit 1
} finally {
  if ($mutexOwned) { try { $mutex.ReleaseMutex() } catch { } }
  if ($mutex) { $mutex.Dispose() }
}
