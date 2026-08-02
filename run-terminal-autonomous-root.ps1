param(
  [string]$ProjectRoot = $PSScriptRoot,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [switch]$ApplyScanners,
  [switch]$RequireProtectedReadback,
  [int]$StepTimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$Contract = "terminal-autonomous-root-runner-v1"
$StartedAt = Get-Date
$Day = $StartedAt.ToString("yyyyMMdd")
$LogDir = Join-Path $RuntimeRoot "logs"
$ReceiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
$LogFile = Join-Path $LogDir "terminal-autonomous-root-$($StartedAt.ToString("yyyyMMdd-HHmmss"))-$PID.log"
$ReceiptFile = Join-Path $ReceiptDir "terminal-autonomous-root-latest.json"
$AlertReceiptFile = Join-Path $ReceiptDir "terminal-autonomous-root-alert.json"
$PreviousReceipt = $null
$PreviousOrchestrator = $null
$RecoveryReasons = New-Object System.Collections.Generic.List[string]
if (Test-Path -LiteralPath $ReceiptFile) { try { $PreviousReceipt = Get-Content -LiteralPath $ReceiptFile -Raw | ConvertFrom-Json } catch { $RecoveryReasons.Add("previous_root_receipt_unreadable") } }
$OrchestratorStateFile = Join-Path $ProjectRoot "outputs\terminal-orchestrator\terminal-orchestrator-state.json"
if (Test-Path -LiteralPath $OrchestratorStateFile) { try { $PreviousOrchestrator = Get-Content -LiteralPath $OrchestratorStateFile -Raw | ConvertFrom-Json } catch { $RecoveryReasons.Add("previous_orchestrator_state_unreadable") } }
if ($PreviousReceipt -and $PreviousReceipt.ok -ne $true) { $RecoveryReasons.Add("previous_root_run_not_complete") }
if ($PreviousOrchestrator -and @("RUNNING","RETRYING","PENDING","RECOVERY_PENDING") -contains [string]$PreviousOrchestrator.overallState) { $RecoveryReasons.Add("orchestrator_was_in_flight") }
$RecoveryMode = $RecoveryReasons.Count -gt 0

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $ReceiptDir | Out-Null

function Write-RunnerLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "o"), $Message
  try {
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8 -ErrorAction Stop
  } catch {
    Write-Warning "runner log write skipped: $($_.Exception.Message)"
  }
  Write-Host $line
}

function Invoke-NpmStep {
  param(
    [string]$Name,
    [string]$Script,
    [int]$MaxAttempts = 1,
    [int]$RetryDelaySeconds = 0,
    [int[]]$ToleratedExitCodes = @(),
    [int]$TimeoutSeconds = $StepTimeoutSeconds
  )
  $attempt = 1
  $stepStarted = Get-Date
  $exitCode = 0
  $timedOut = $false
  do {
    $attemptStarted = Get-Date
    $stdoutFile = Join-Path $LogDir ("step-{0}-{1}-{2}-stdout.log" -f $Name, $PID, $attempt)
    $stderrFile = Join-Path $LogDir ("step-{0}-{1}-{2}-stderr.log" -f $Name, $PID, $attempt)
    Write-RunnerLog "START $Name attempt=$attempt/$MaxAttempts timeout=${TimeoutSeconds}s :: npm run $Script"
    $process = $null
    try {
      $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/s", "/c", "npm run $Script") -WorkingDirectory $ProjectRoot -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -WindowStyle Hidden -PassThru
      if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
        $timedOut = $true
        $exitCode = 124
        Write-RunnerLog "TIMEOUT $Name after=${TimeoutSeconds}s pid=$($process.Id)"
        try { & taskkill.exe /PID $process.Id /T /F | Out-Null } catch { Write-RunnerLog "taskkill skipped: $($_.Exception.Message)" }
      } else {
        $exitCode = $process.ExitCode
      }
    } catch {
      $exitCode = 1
      Write-RunnerLog "EXEC_ERROR $Name error=$($_.Exception.Message)"
    }
    foreach ($file in @($stdoutFile, $stderrFile)) {
      if (Test-Path -LiteralPath $file) {
        Get-Content -LiteralPath $file -ErrorAction SilentlyContinue | ForEach-Object {
          Add-Content -LiteralPath $LogFile -Value $_ -Encoding UTF8
          Write-Host $_
        }
      }
    }
    if ($exitCode -eq 0) { break }
    if ($attempt -lt $MaxAttempts) {
      Write-RunnerLog "RETRY $Name exit=$exitCode wait=${RetryDelaySeconds}s"
      Start-Sleep -Seconds $RetryDelaySeconds
    }
    $attempt += 1
  } while ($attempt -le $MaxAttempts)
  $stepFinished = Get-Date
  $row = [ordered]@{
    name = $Name
    script = $Script
    attempts = $attempt
    exitCode = $exitCode
    timeoutSeconds = $TimeoutSeconds
    timedOut = $timedOut
    startedAt = $stepStarted.ToString("o")
    finishedAt = $stepFinished.ToString("o")
    durationSeconds = [math]::Round(($stepFinished - $stepStarted).TotalSeconds, 3)
  }
  if ($exitCode -ne 0) {
    if ($ToleratedExitCodes -contains $exitCode) {
      $row.exitCode = 0
      $row.toleratedExitCode = $exitCode
      $row.toleratedReason = "CONTINUE_TO_STATE_MACHINE"
      Write-RunnerLog "PASS $Name toleratedExit=$exitCode reason=CONTINUE_TO_STATE_MACHINE"
      return $row
    }
    $rollForwardFile = Join-Path $ProjectRoot "outputs\terminal-roll-forward\terminal-auto-roll-forward.json"
    $idleNoRetry = $false
    if ($Name -eq "job-queue-roll-forward" -and (Test-Path -LiteralPath $rollForwardFile)) {
      try {
        $rollForwardPayload = Get-Content -LiteralPath $rollForwardFile -Raw | ConvertFrom-Json
        $idleNoRetry = ($rollForwardPayload.decision.ok -eq $true -and $rollForwardPayload.decision.state -eq "IDLE_NO_RETRY_NEEDED")
      } catch {
        $idleNoRetry = $false
      }
    }
    if ($idleNoRetry) {
      $row.exitCode = 0
      $row.toleratedExitCode = $exitCode
      $row.toleratedReason = "IDLE_NO_RETRY_NEEDED"
      Write-RunnerLog "PASS $Name toleratedExit=$exitCode reason=IDLE_NO_RETRY_NEEDED"
      return $row
    }
    if ($timedOut) { throw [System.Exception]::new(("step_timeout:{0}:{1}s" -f $Name, $TimeoutSeconds)) }
    Write-RunnerLog "FAIL $Name exit=$exitCode"
    throw [System.Exception]::new(("step_failed:{0}:{1}" -f $Name, $exitCode))
  }
  Write-RunnerLog "PASS $Name"
  return $row
}
function Write-Receipt {
  param(
    [bool]$Ok,
    [array]$Steps,
    [string]$FailedStep = "",
    [string]$ErrorMessage = ""
  )
  $finishedAt = Get-Date
  $tail = @()
  if (Test-Path -LiteralPath $LogFile) {
    $tail = Get-Content -LiteralPath $LogFile -Tail 80
  }
  $payload = [ordered]@{
    ok = $Ok
    contract = $Contract
    runId = "terminal-autonomous-root-$($StartedAt.ToString('yyyyMMdd-HHmmss'))"
    startedAt = $StartedAt.ToString("o")
    finishedAt = $finishedAt.ToString("o")
    durationSeconds = [math]::Round(($finishedAt - $StartedAt).TotalSeconds, 3)
    projectRoot = $ProjectRoot
    runtimeRoot = $RuntimeRoot
    applyScanners = [bool]$ApplyScanners
    requireProtectedReadback = [bool]$RequireProtectedReadback
    stepTimeoutSeconds = $StepTimeoutSeconds
    recovery = [ordered]@{ mode = $RecoveryMode; reasons = $RecoveryReasons.ToArray(); previousRunId = if ($PreviousReceipt) { [string]$PreviousReceipt.runId } else { "" }; previousOk = if ($PreviousReceipt) { [bool]$PreviousReceipt.ok } else { $null }; previousOrchestratorState = if ($PreviousOrchestrator) { [string]$PreviousOrchestrator.overallState } else { "" } }
    failedStep = $FailedStep
    errorMessage = $ErrorMessage
    logFile = $LogFile
    steps = $Steps
    logTail = $tail
  }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptFile -Encoding UTF8
  return $payload
}

function Send-FailureAlert {
  param([string]$FailedStep, [string]$ErrorMessage)
  $alertScript = Join-Path $ProjectRoot "scripts\send-workflow-alert.js"
  if (!(Test-Path -LiteralPath $alertScript)) {
    Write-RunnerLog "alert skipped: send-workflow-alert.js missing"
    return
  }
  try {
    $env:FUMAN_ALERT_KIND = "terminal-autonomous-root"
    $env:FUMAN_ALERT_TITLE = "Terminal autonomous root failed"
    $env:FUMAN_ALERT_MESSAGE = "failedStep=$FailedStep error=$ErrorMessage log=$LogFile"
    $env:FUMAN_ALERT_RECEIPT_PATH = $AlertReceiptFile
    & node --use-system-ca $alertScript 2>&1 | Tee-Object -FilePath $LogFile -Append
    Write-RunnerLog "alert command exit=$LASTEXITCODE"
  } catch {
    Write-RunnerLog "alert failed: $($_.Exception.Message)"
  }
}

Set-Location $ProjectRoot
if ($RequireProtectedReadback) {
  $env:FUMAN_REQUIRE_PROTECTED_READBACK = "1"
}

$steps = New-Object System.Collections.Generic.List[object]
try {
  Write-RunnerLog "Autonomous root started contract=$Contract recovery=$RecoveryMode reasons=$($RecoveryReasons -join ",") applyScanners=$([bool]$ApplyScanners) requireProtectedReadback=$([bool]$RequireProtectedReadback)"
  $steps.Add((Invoke-NpmStep "power-recovery-contract" "verify:terminal-power-recovery-contract"))
  $steps.Add((Invoke-NpmStep "predictive-preflight" "ops:predictive-preflight"))
  $steps.Add((Invoke-NpmStep "websocket-source-layer" "verify:fugle-websocket-sources" -ToleratedExitCodes @(1)))
    # Water Root is an observation gate; failure must reach self-heal.
  $steps.Add((Invoke-NpmStep "water-root" "verify:terminal-water-root" -MaxAttempts 3 -RetryDelaySeconds 20 -ToleratedExitCodes @(1)))
  $steps.Add((Invoke-NpmStep "warmup-phase-state-machine" "verify:daytrade-warmup-root" -ToleratedExitCodes @(1)))
  $steps.Add((Invoke-NpmStep "rewater-runner" "daytrade-warmup:root" -ToleratedExitCodes @(1)))
  $steps.Add((Invoke-NpmStep "reason-code-classifier" "verify:terminal-reason-code-classifier"))
  $steps.Add((Invoke-NpmStep "formal-entry-gate" "verify:strategy-scan-formal-gate"))
  $steps.Add((Invoke-NpmStep "job-queue-contract" "verify:terminal-job-queue-contract"))
  $steps.Add((Invoke-NpmStep "idempotent-scanner-contract" "verify:terminal-idempotent-runner"))
  $steps.Add((Invoke-NpmStep "daily-manifest" "manifest:daily-terminal-run" -ToleratedExitCodes @(1)))
  $steps.Add((Invoke-NpmStep "state-machine" "orchestrator:state:from-existing"))
  $steps.Add((Invoke-NpmStep "autonomous-policy" "policy:autonomous-ops"))
  if ($ApplyScanners) {
    $steps.Add((Invoke-NpmStep "job-queue-roll-forward" "rollforward:terminal:apply-scanners"))
  } else {
    $steps.Add((Invoke-NpmStep "job-queue-roll-forward" "rollforward:terminal:apply"))
  }
  $steps.Add((Invoke-NpmStep "rewater-verification" "verify:terminal-water-root" -MaxAttempts 2 -RetryDelaySeconds 10 -ToleratedExitCodes @(1)))
    $steps.Add((Invoke-NpmStep "canary-publish-readback" "verify:terminal-canary-publish:live" -ToleratedExitCodes @(1)))
  $steps.Add((Invoke-NpmStep "control-plane-readback" "verify:terminal-control-plane:from-existing"))
  $steps.Add((Invoke-NpmStep "resource-chain-readback" "verify:terminal-resource-chain:unattended" -ToleratedExitCodes @(1)))
  $steps.Add((Invoke-NpmStep "surface-monitor-readback" "verify:terminal-surface-monitor" -ToleratedExitCodes @(1)))
  $steps.Add((Invoke-NpmStep "runid-closure-readback" "verify:terminal-runid-closure" -ToleratedExitCodes @(1)))
  $steps.Add((Invoke-NpmStep "ops-status-export" "ops:status:export"))
  $steps.Add((Invoke-NpmStep "ops-status-api-readback" "verify:terminal-ops-status-api"))
  $steps.Add((Invoke-NpmStep "production-live-readback" "verify:terminal-ops-production-live"))
  $steps.Add((Invoke-NpmStep "production-readiness-report" "ops:production-unattended-readiness-report:fresh"))
  $steps.Add((Invoke-NpmStep "production-readiness-report-verify" "verify:production-unattended-readiness-report"))
  $receipt = Write-Receipt -Ok $true -Steps $steps.ToArray()
  Write-RunnerLog "Autonomous root complete receipt=$ReceiptFile"
  exit 0
} catch {
  $message = $_.Exception.Message
  $failedStep = if ($message -match "step_failed:([^:]+):") { $Matches[1] } else { "unknown" }
  $receipt = Write-Receipt -Ok $false -Steps $steps.ToArray() -FailedStep $failedStep -ErrorMessage $message
  Send-FailureAlert -FailedStep $failedStep -ErrorMessage $message
  Write-RunnerLog "Autonomous root failed failedStep=$failedStep error=$message receipt=$ReceiptFile"
  exit 1
}

