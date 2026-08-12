param(
  [string]$ProjectRoot = $PSScriptRoot,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [switch]$ApplyScanners,
  [switch]$RequireProtectedReadback
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

$DailyRunId = if ($env:FUMAN_DAILY_RUN_ID) { [string]$env:FUMAN_DAILY_RUN_ID } else { "terminal-daily-$Day-$($StartedAt.ToString('yyyyMMddHHmmss'))-$PID-$([guid]::NewGuid().ToString('N').Substring(0,6))" }
$LockOwnerToken = "terminal-autonomous-root-$PID-$([guid]::NewGuid().ToString('N'))"
$OrchestratorLockFile = Join-Path $RuntimeRoot "locks\terminal-daily-orchestrator.lock"
$OrchestratorLock = $null
$OrchestratorLockRelease = $null
$nl = "`n"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $ReceiptDir | Out-Null

function Read-OrchestratorLockPayload {
  if (!(Test-Path -LiteralPath $OrchestratorLockFile)) { return $null }
  try { return Get-Content -LiteralPath $OrchestratorLockFile -Raw -ErrorAction Stop | ConvertFrom-Json } catch { return $null }
}

function Acquire-OrchestratorLock {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OrchestratorLockFile) | Out-Null
  $now = [DateTimeOffset]::UtcNow
  $payload = [ordered]@{
    contract = "terminal-orchestrator-lock-v1"
    ownerId = $LockOwnerToken
    hostId = $env:COMPUTERNAME
    pid = [int]$PID
    startedAt = $now.ToString("o")
    updatedAt = $now.ToString("o")
    expiresAt = $now.AddMinutes(45).ToString("o")
    expectedDate = $Day
    mode = "root_runner"
    daily_run_id = $DailyRunId
    trade_date = $Day
    host = $env:COMPUTERNAME
    owner_token = $LockOwnerToken
    acquired_at = $now.ToString("o")
    expires_at = $now.AddMinutes(45).ToString("o")
  }
  $json = ($payload | ConvertTo-Json -Depth 8) + $nl
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $stream = [System.IO.File]::Open($OrchestratorLockFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    return [ordered]@{ ok = $true; file = $OrchestratorLockFile; payload = $payload }
  } catch {
    $existing = Read-OrchestratorLockPayload
    if ($null -eq $existing) { return [ordered]@{ ok = $false; file = $OrchestratorLockFile; reasonCode = "orchestrator_lock_create_failed"; error = $_.Exception.Message } }
    $expired = $false
    try {
      $expiresText = if ($existing.expiresAt) { [string]$existing.expiresAt } else { [string]$existing.expires_at }
      $expired = ([DateTimeOffset]::Parse($expiresText) -le $now)
    } catch { $expired = $false }
    $holderAlive = $false
    try {
      $holderPid = [int]$existing.pid
      $holderAlive = $holderPid -gt 0 -and $null -ne (Get-Process -Id $holderPid -ErrorAction SilentlyContinue)
    } catch { $holderAlive = $false }
    if ($expired -and -not $holderAlive) {
      $stale = "$OrchestratorLockFile.stale-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
      try {
        Move-Item -LiteralPath $OrchestratorLockFile -Destination $stale -ErrorAction Stop
        return Acquire-OrchestratorLock
      } catch {
        return [ordered]@{ ok = $false; file = $OrchestratorLockFile; reasonCode = "orchestrator_lock_stale_but_not_reclaimable"; holder = $existing; error = $_.Exception.Message }
      }
    }
    return [ordered]@{ ok = $false; file = $OrchestratorLockFile; reasonCode = "orchestrator_lock_held"; holder = $existing }
  }
}

function Release-OrchestratorLock {
  if ($null -eq $OrchestratorLock -or $OrchestratorLock.ok -ne $true) { return [ordered]@{ ok = $true; released = $false } }
  $current = Read-OrchestratorLockPayload
  if ($null -eq $current -or (([string]$current.ownerId -ne $LockOwnerToken) -and ([string]$current.owner_token -ne $LockOwnerToken))) {
    return [ordered]@{ ok = $false; released = $false; reasonCode = "orchestrator_lock_owner_mismatch"; file = $OrchestratorLockFile }
  }
  try {
    Remove-Item -LiteralPath $OrchestratorLockFile -Force -ErrorAction Stop
    return [ordered]@{ ok = $true; released = $true; file = $OrchestratorLockFile }
  } catch {
    return [ordered]@{ ok = $false; released = $false; reasonCode = "orchestrator_lock_release_failed"; error = $_.Exception.Message; file = $OrchestratorLockFile }
  }
}
function Renew-OrchestratorLock {
  if ($null -eq $OrchestratorLock -or $OrchestratorLock.ok -ne $true) { return }
  try {
    $current = Read-OrchestratorLockPayload
    if ($null -eq $current -or (([string]$current.ownerId -ne $LockOwnerToken) -and ([string]$current.owner_token -ne $LockOwnerToken))) { return }
    $now = [DateTimeOffset]::UtcNow
    $current.updatedAt = $now.ToString("o")
    $current.expiresAt = $now.AddMinutes(45).ToString("o")
    $current.expires_at = $current.expiresAt
    ($current | ConvertTo-Json -Depth 8) + $nl | Set-Content -LiteralPath $OrchestratorLockFile -Encoding UTF8
  } catch { Write-RunnerLog "ORCHESTRATOR_LOCK_RENEW_WARNING $($_.Exception.Message)" }
}

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
    [int]$TimeoutSeconds = 180
  )
  Renew-OrchestratorLock
  $attempt = 1
  $stepStarted = Get-Date
  $exitCode = 0
  $timedOut = $false
  do {
    Write-RunnerLog "START $Name attempt=$attempt/$MaxAttempts timeout=${TimeoutSeconds}s :: npm run $Script"
    $stdoutFile = Join-Path $ReceiptDir "terminal-autonomous-step-$([guid]::NewGuid().ToString('N')).out.log"
    $stderrFile = Join-Path $ReceiptDir "terminal-autonomous-step-$([guid]::NewGuid().ToString('N')).err.log"
    $process = $null
    try {
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = "cmd.exe"
      $psi.Arguments = "/d /c npm.cmd run `"$Script`""
      $psi.WorkingDirectory = $ProjectRoot
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true
      $psi.RedirectStandardOutput = $true
      $psi.RedirectStandardError = $true
      $process = New-Object System.Diagnostics.Process
      $process.StartInfo = $psi
      [void]$process.Start()
      $stdoutTask = $process.StandardOutput.ReadToEndAsync()
      $stderrTask = $process.StandardError.ReadToEndAsync()
      if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
        $timedOut = $true
        $exitCode = 124
        Write-RunnerLog "TIMEOUT $Name after=${TimeoutSeconds}s"
        try { $process.Kill($true) } catch {
          try { $process.Kill() } catch { Write-RunnerLog "TIMEOUT_KILL_WARNING $Name $($_.Exception.Message)" }
        }
        try { $process.WaitForExit(5000) } catch {}
      } else {
        $process.Refresh()
        $exitCode = [int]$process.ExitCode
        $timedOut = $false
      }
      # Child npm/node processes can inherit redirected handles. Bound the
      # capture wait so a timed-out step always reaches its fail-closed receipt.
      $stdoutText = ""
      $stderrText = ""
      try { if ($stdoutTask.Wait(5000)) { $stdoutText = $stdoutTask.Result } else { Write-RunnerLog "STDOUT_CAPTURE_TIMEOUT $Name" } } catch { Write-RunnerLog "STDOUT_CAPTURE_WARNING $Name $($_.Exception.Message)" }
      try { if ($stderrTask.Wait(5000)) { $stderrText = $stderrTask.Result } else { Write-RunnerLog "STDERR_CAPTURE_TIMEOUT $Name" } } catch { Write-RunnerLog "STDERR_CAPTURE_WARNING $Name $($_.Exception.Message)" }
      try { [System.IO.File]::WriteAllText($stdoutFile, $stdoutText) } catch { Write-RunnerLog "STDOUT_CAPTURE_WARNING $Name $($_.Exception.Message)" }
      try { [System.IO.File]::WriteAllText($stderrFile, $stderrText) } catch { Write-RunnerLog "STDERR_CAPTURE_WARNING $Name $($_.Exception.Message)" }
      if (Test-Path -LiteralPath $stdoutFile) { Get-Content -LiteralPath $stdoutFile | Tee-Object -FilePath $LogFile -Append | Write-Host }
      if (Test-Path -LiteralPath $stderrFile) { Get-Content -LiteralPath $stderrFile | Tee-Object -FilePath $LogFile -Append | Write-Host }
    } finally {
      Remove-Item -LiteralPath $stdoutFile,$stderrFile -Force -ErrorAction SilentlyContinue
    }
    if ($exitCode -eq 0) { break }
    if ($attempt -lt $MaxAttempts) {
      Write-RunnerLog "RETRY $Name exit=$exitCode wait=${RetryDelaySeconds}s"
      Start-Sleep -Seconds $RetryDelaySeconds
    }
    $attempt += 1
  } while ($attempt -le $MaxAttempts)
  $resourceChainEvidenceAccepted = $false
  $waterRootEvidenceAccepted = $false
  if ($timedOut -and $Name -match "resource-chain-readback") {
    $auditFile = Join-Path $ProjectRoot "outputs\terminal-resource-chain-audit\terminal-resource-chain-audit.json"
    try {
      $auditItem = Get-Item -LiteralPath $auditFile -ErrorAction Stop
      $auditPayload = Get-Content -LiteralPath $auditFile -Raw -ErrorAction Stop | ConvertFrom-Json
      if ($auditItem.LastWriteTime -ge $stepStarted -and $auditPayload.ok -eq $true) {
        $timedOut = $false
        $exitCode = 0
        $resourceChainEvidenceAccepted = $true
        Write-RunnerLog "PASS $Name evidence=terminal-resource-chain-audit.ok_after_process_timeout"
      }
    } catch { }
  }
  if ($timedOut -and $Name -match "water-root") {
    $auditFile = Join-Path $ProjectRoot "outputs\terminal-water-root\terminal-water-root.json"
    try {
      $auditItem = Get-Item -LiteralPath $auditFile -ErrorAction Stop
      $auditPayload = Get-Content -LiteralPath $auditFile -Raw -ErrorAction Stop | ConvertFrom-Json
      if ($auditItem.LastWriteTime -ge $stepStarted -and $auditPayload.ok -eq $true) {
        $timedOut = $false
        $exitCode = 0
        $waterRootEvidenceAccepted = $true
        Write-RunnerLog "PASS $Name evidence=terminal-water-root.ok_after_process_timeout"
      }
    } catch { }
  }
  $stepFinished = Get-Date
  $row = [ordered]@{
    name = $Name
    script = $Script
    attempts = $attempt
    exitCode = $exitCode
    timedOut = [bool]$timedOut
    timeoutSeconds = $TimeoutSeconds
    evidenceAccepted = [bool]($resourceChainEvidenceAccepted -or $waterRootEvidenceAccepted)
    startedAt = $stepStarted.ToString("o")
    finishedAt = $stepFinished.ToString("o")
    durationSeconds = [math]::Round(($stepFinished - $stepStarted).TotalSeconds, 3)
  }
  if ($timedOut) {
    $row.reasonCode = "AUTONOMOUS_STEP_TIMEOUT"
    Write-RunnerLog "FAIL $Name reason=AUTONOMOUS_STEP_TIMEOUT"
    throw [System.Exception]::new(("step_timeout:{0}:{1}" -f $Name, $TimeoutSeconds))
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
  $safeSteps = @()
  foreach ($step in @($Steps)) {
    $safeSteps += [ordered]@{
      name = [string]$step.name
      script = [string]$step.script
      attempts = [int]$step.attempts
      exitCode = [int]$step.exitCode
      toleratedExitCode = if ($null -ne $step.toleratedExitCode) { [int]$step.toleratedExitCode } else { $null }
      toleratedReason = [string]$step.toleratedReason
      timedOut = [bool]$step.timedOut
      timeoutSeconds = [int]$step.timeoutSeconds
    evidenceAccepted = [bool]$resourceChainEvidenceAccepted
      startedAt = [string]$step.startedAt
      finishedAt = [string]$step.finishedAt
      durationSeconds = [double]$step.durationSeconds
      reasonCode = [string]$step.reasonCode
    }
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
    daily_run_id = $DailyRunId
    orchestrator_lock = [ordered]@{ acquired = ($null -ne $OrchestratorLock -and $OrchestratorLock.ok -eq $true); released = ($null -ne $OrchestratorLockRelease -and $OrchestratorLockRelease.released -eq $true); file = $OrchestratorLockFile; release = $OrchestratorLockRelease }
    applyScanners = [bool]$ApplyScanners
    requireProtectedReadback = [bool]$RequireProtectedReadback
    failedStep = $FailedStep
    errorMessage = $ErrorMessage
    logFile = $LogFile
    toleratedStepCount = @($safeSteps | Where-Object { $null -ne $_.toleratedExitCode }).Count
    unattendedStatus = if ($Ok) { "YES" } else { "NO" }
    steps = $safeSteps
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
$env:FUMAN_DAILY_RUN_ID = $DailyRunId
$env:FUMAN_RUNTIME_DIR = $RuntimeRoot
$env:FUMAN_TRADE_DATE = $Day
$env:FUMAN_ORCHESTRATOR_LOCK_OWNER = $LockOwnerToken
$OrchestratorLock = Acquire-OrchestratorLock
if ($OrchestratorLock.ok -ne $true) {
  # Another autonomous root run already owns the daily lock. Treat this trigger as
  # a no-op success and do not overwrite terminal-autonomous-root-latest.json.
  Write-RunnerLog "Orchestrator lock not acquired reason=$($OrchestratorLock.reasonCode); noop_success_no_latest_overwrite=true"
  $OrchestratorLockRelease = [ordered]@{ ok = $true; released = $false; reasonCode = $OrchestratorLock.reasonCode; file = $OrchestratorLockFile }
  exit 0
}
if ($RequireProtectedReadback) {
  $env:FUMAN_REQUIRE_PROTECTED_READBACK = "1"
}

$steps = New-Object System.Collections.Generic.List[object]
try {
  Write-RunnerLog "Autonomous root started contract=$Contract applyScanners=$([bool]$ApplyScanners) requireProtectedReadback=$([bool]$RequireProtectedReadback)"
  # Pick one Taipei target date before queue/scanner work. Pre-open runs may
  # inspect and self-heal, but must never apply formal scanners before the
  # calendar gate allows the target trading session.
  $datePreflightStep = Invoke-NpmStep "market-calendar-date-gate" "full-scan:date-preflight" -ToleratedExitCodes @(10, 11)
  $steps.Add($datePreflightStep)
  $datePreflightPath = Join-Path $RuntimeRoot "data\scan-receipts\full-scan-date-preflight.json"
  $datePreflight = $null
  if (Test-Path -LiteralPath $datePreflightPath) {
    try { $datePreflight = Get-Content -LiteralPath $datePreflightPath -Raw | ConvertFrom-Json } catch { }
  }
  $scannerApplyAllowed = $false
  $targetTradeDate = ""
  if ($datePreflight) {
    $targetTradeDate = [string]$datePreflight.scannerTargetTradeDate
    if ([string]::IsNullOrWhiteSpace($targetTradeDate)) { $targetTradeDate = [string]$datePreflight.taipeiToday }
    if (-not [string]::IsNullOrWhiteSpace($targetTradeDate)) {
      $env:FUMAN_SCANNER_TARGET_DATE = $targetTradeDate
      $env:FUMAN_SCANNER_TARGET_TRADE_DATE = $targetTradeDate
      $env:FUMAN_TERMINAL_TARGET_TRADE_DATE = $targetTradeDate
      $env:FUMAN_EXPECTED_DATE = $targetTradeDate
      $env:FUMAN_SCORECARD_EXPECTED_DATE = $targetTradeDate
      $env:FUMAN_REQUIRE_SOURCE_DATE_MATCH = "1"
    }
    $tradingDayOpen = ($datePreflight.marketCalendar.tradingDayOpen -eq $true -or $datePreflight.marketCalendar.tradingDay.isTradingDay -eq $true -or $datePreflight.afterCloseProfile -eq $true)
    $calendarOverride = ($datePreflight.marketCalendar.override -eq $true)
    $calendarClosedReason = [string]$datePreflight.marketCalendar.closedReason
    $scannerApplyAllowed = ($datePreflight.ok -eq $true -and $tradingDayOpen -and -not $calendarOverride -and [string]::IsNullOrWhiteSpace($calendarClosedReason))
    Write-RunnerLog ("Date gate target={0} marketOpen={1} formalScanSkipped={2} scannerApplyAllowed={3}" -f $targetTradeDate, $datePreflight.marketOpen, $datePreflight.formalScanSkipped, $scannerApplyAllowed)
  } else {
    Write-RunnerLog "Date gate receipt missing; scanner apply disabled fail-closed"
  }
  $marketClosedPreviousGood = ($datePreflight -and $datePreflight.marketOpen -ne $true -and ($datePreflight.preservePreviousGood -eq $true -or $datePreflight.formalScanSkipped -eq $true))
  $steps.Add((Invoke-NpmStep "predictive-preflight" "ops:predictive-preflight"))
  # A transient Water Root failure enters the bounded warmup/self-heal path before
  # the run stops. Rewater never backfills natural evidence or publishes scanners.
  $waterRoot = Invoke-NpmStep "water-root" "verify:terminal-water-root" -MaxAttempts 3 -RetryDelaySeconds 20 -ToleratedExitCodes @(1) -TimeoutSeconds 300
  $steps.Add($waterRoot)
  if ($waterRoot.toleratedExitCode -eq 1) {
    $steps.Add((Invoke-NpmStep "warmup-self-heal" "daytrade-warmup:root:apply" -ToleratedExitCodes @(1)))
    $steps.Add((Invoke-NpmStep "water-root-after-rewater" "verify:terminal-water-root" -MaxAttempts 3 -RetryDelaySeconds 20 -ToleratedExitCodes @(1) -TimeoutSeconds 300))
  }
    $steps.Add((Invoke-NpmStep "daily-manifest" "manifest:daily-terminal-run" -TimeoutSeconds 600 -ToleratedExitCodes @(1)))
  # Read current live/terminal alignment before planning recovery; otherwise the queue can plan from stale manifest data.
  if ($marketClosedPreviousGood) {
    $steps.Add([ordered]@{ name = "initial-resource-chain-readback"; script = "skipped_market_closed_previous_good"; attempts = 0; exitCode = 0; timedOut = $false; ok = $true; skipped = $true; skipReason = "market_closed_previous_good"; executionGuard = "skip_heavy_live_readback_on_market_closed" })
    Write-RunnerLog "SKIP initial-resource-chain-readback reason=market_closed_previous_good"
  } else {
    $steps.Add((Invoke-NpmStep "initial-resource-chain-readback" "verify:terminal-resource-chain:unattended" -TimeoutSeconds 600 -ToleratedExitCodes @(1)))
  }
  $steps.Add((Invoke-NpmStep "state-machine" "orchestrator:state:from-existing" -ToleratedExitCodes @(1)))
  $steps.Add((Invoke-NpmStep "autonomous-policy" "policy:autonomous-ops"))
  if ($scannerApplyAllowed) {
    if ($ApplyScanners) {
      $steps.Add((Invoke-NpmStep "job-queue-roll-forward" "rollforward:terminal:apply-scanners" -ToleratedExitCodes @(1)))
    } else {
      $steps.Add((Invoke-NpmStep "job-queue-roll-forward" "rollforward:terminal:apply" -ToleratedExitCodes @(1)))
    }
  } else {
    $skipReason = if ($datePreflight -and $datePreflight.marketOpen -ne $true) { "market_closed" } elseif ($datePreflight -and $datePreflight.formalScanSkipped -eq $true) { "formal_scan_not_due" } else { "date_preflight_not_ready" }
    $steps.Add([ordered]@{ name = "job-queue-roll-forward"; script = "skipped_by_date_gate"; attempts = 0; exitCode = 0; timedOut = $false; ok = $true; skipped = $true; skipReason = $skipReason; executionGuard = "date_gate_blocks_formal_scanner_apply" })
    Write-RunnerLog ("SKIP job-queue-roll-forward reason={0} scannerApplyAllowed=false" -f $skipReason)
  }
  # Rebuild the daily manifest after repair actions, before canary/publish decisions.
  $steps.Add((Invoke-NpmStep "post-roll-forward-manifest" "manifest:daily-terminal-run" -ToleratedExitCodes @(1)))
  if ($marketClosedPreviousGood) {
    $steps.Add([ordered]@{ name = "canary-publish-readback"; script = "skipped_market_closed_previous_good"; attempts = 0; exitCode = 0; timedOut = $false; ok = $true; skipped = $true; skipReason = "market_closed_previous_good"; executionGuard = "skip_live_canary_on_market_closed" })
    Write-RunnerLog "SKIP canary-publish-readback reason=market_closed_previous_good"
  } else {
    $steps.Add((Invoke-NpmStep "canary-publish-readback" "verify:terminal-canary-publish:live" -ToleratedExitCodes @(1)))
  }
  $steps.Add((Invoke-NpmStep "control-plane-readback" "verify:terminal-control-plane:from-existing"))
  if ($marketClosedPreviousGood) {
    $steps.Add([ordered]@{ name = "resource-chain-readback"; script = "skipped_market_closed_previous_good"; attempts = 0; exitCode = 0; timedOut = $false; ok = $true; skipped = $true; skipReason = "market_closed_previous_good"; executionGuard = "skip_heavy_live_readback_on_market_closed" })
    $steps.Add([ordered]@{ name = "runid-closure-readback"; script = "skipped_market_closed_previous_good"; attempts = 0; exitCode = 0; timedOut = $false; ok = $true; skipped = $true; skipReason = "market_closed_previous_good"; executionGuard = "skip_runid_live_readback_on_market_closed" })
    Write-RunnerLog "SKIP resource-chain-readback/runid-closure-readback reason=market_closed_previous_good"
  } else {
    $steps.Add((Invoke-NpmStep "resource-chain-readback" "verify:terminal-resource-chain:unattended" -TimeoutSeconds 600 -ToleratedExitCodes @(1)))
    $steps.Add((Invoke-NpmStep "runid-closure-readback" "verify:terminal-runid-closure" -ToleratedExitCodes @(1)))
  }
  $steps.Add((Invoke-NpmStep "ops-status-export" "ops:status:export" -ToleratedExitCodes @(1)))
  $steps.Add((Invoke-NpmStep "ops-status-api-readback" "verify:terminal-ops-status-api" -ToleratedExitCodes @(1)))
    # The final audit reads all 26 unattended surfaces and may legitimately exceed
  # the normal step budget; keep its bound finite while leaving other steps at 180s.
  $steps.Add((Invoke-NpmStep "unattended-final-audit" "final-audit:terminal" -TimeoutSeconds 600 -ToleratedExitCodes @(1)))
  $steps.Add((Invoke-NpmStep "production-live-readback" "verify:terminal-ops-production-live" -ToleratedExitCodes @(1)))
  if ($marketClosedPreviousGood) {
    $steps.Add((Invoke-NpmStep "production-readiness-report" "ops:production-unattended-readiness-report" -ToleratedExitCodes @(1)))
  } else {
    $steps.Add((Invoke-NpmStep "production-readiness-report" "ops:production-unattended-readiness-report:fresh" -ToleratedExitCodes @(1)))
  }
  $steps.Add((Invoke-NpmStep "production-readiness-report-verify" "verify:production-unattended-readiness-report" -ToleratedExitCodes @(1)))
  $hasToleratedFailure = @($steps | Where-Object { $null -ne $_.toleratedExitCode }).Count -gt 0
  $OrchestratorLockRelease = Release-OrchestratorLock
  $receipt = Write-Receipt -Ok (-not $hasToleratedFailure) -Steps $steps.ToArray()
  if ($hasToleratedFailure) {
    # The root runner completed its duty and wrote fail-closed evidence. Keep
    # Windows Task Scheduler green; YES/NO lives in Final Audit and readiness JSON.
    Write-RunnerLog "Autonomous root completed with blocked/degraded evidence receipt=$ReceiptFile"
    exit 0
  }
  Write-RunnerLog "Autonomous root complete receipt=$ReceiptFile"
  exit 0
} catch {
  $message = $_.Exception.Message
  $failedStep = if ($message -match "step_failed:([^:]+):") { $Matches[1] } else { "unknown" }
  $OrchestratorLockRelease = Release-OrchestratorLock
  $receipt = Write-Receipt -Ok $false -Steps $steps.ToArray() -FailedStep $failedStep -ErrorMessage $message
  Send-FailureAlert -FailedStep $failedStep -ErrorMessage $message
  Write-RunnerLog "Autonomous root failed failedStep=$failedStep error=$message receipt=$ReceiptFile"
  exit 1
}









