param(
  [string]$FumanRoot = "C:\fuman-release-owner\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$Apply,
  [switch]$Fetch,
  [switch]$Once,
  [switch]$Continuous,
  [switch]$LocalCheck,
  [switch]$ClosingWaterOnly
)

# Run-DaytradeSourceWriter.ps1 is a release-owner wrapper.
# Default mode is dry-run/no-fetch/once. Use -Apply only in an approved writer window.
$ErrorActionPreference = "Stop"
function Test-ClosingWaterWindow {
  param([DateTimeOffset]$Now)
  $local = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($Now, "Taipei Standard Time")
  $minute = $local.Hour * 60 + $local.Minute
  return $local.DayOfWeek -notin @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday) -and $minute -ge 813 -and $minute -lt 816
}
function Test-ClosingWaterSyncReceipt {
  param($Receipt, [string]$Date, [DateTimeOffset]$StartedAt)
  if ($null -eq $Receipt -or $Receipt.ok -ne $true -or $Receipt.mode -ne 'apply' -or $Receipt.trade_date -ne $Date) { return $false }
  try {
    $checked = [DateTimeOffset]::Parse([string]$Receipt.checked_at)
    $completed = [DateTimeOffset]::Parse([string]$Receipt.completed_at)
    return $checked -ge $StartedAt -and $completed -ge $checked -and $completed -le [DateTimeOffset]::UtcNow
  } catch { return $false }
}
if ($ClosingWaterOnly -and (-not $Apply -or $Fetch -or $Continuous -or $LocalCheck)) { throw 'CLOSING_WATER_MODE_INVALID' }
if ($ClosingWaterOnly -and -not (Test-ClosingWaterWindow -Now ([DateTimeOffset]::UtcNow))) {
  Write-Output '{"status":"not_due","complete":false,"reason":"CLOSING_WATER_WINDOW_1333_1335"}'
  exit 0
}
$WrapperClock = [Diagnostics.Stopwatch]::StartNew()

function Get-WriterProcessBudget {
  param([double]$ElapsedSeconds, [int]$MaximumSeconds = 285, [int]$ReserveSeconds = 15)
  if ([double]::IsNaN($ElapsedSeconds) -or [double]::IsInfinity($ElapsedSeconds) -or $ElapsedSeconds -lt 0 -or $MaximumSeconds -lt 1 -or $ReserveSeconds -lt 5) { throw 'WRITER_TIME_BUDGET_INVALID' }
  return [int][Math]::Max(0, [Math]::Min($MaximumSeconds, [Math]::Floor(300 - $ReserveSeconds - $ElapsedSeconds)))
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = $FumanRoot
$WriterScript = Join-Path $RepoRoot "scripts\run-daytrade-source-writer.js"
$LogDir = Join-Path $RuntimeDir "logs"
$StateDir = Join-Path $RuntimeDir "state"
$TradeDate = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, "Taipei Standard Time").ToString("yyyy-MM-dd")
$Stamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMddHHmmss")
$RunId = "fugle_daytrade_source-writer-$Stamp-$PID"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$StdoutLog = Join-Path $LogDir "daytrade-source-writer-$($TradeDate.Replace('-',''))-$Stamp.stdout.log"
$StderrLog = Join-Path $LogDir "daytrade-source-writer-$($TradeDate.Replace('-',''))-$Stamp.stderr.log"
$WrapperLog = Join-Path $LogDir "daytrade-source-writer-$($TradeDate.Replace('-','')).wrapper.log"
$FutoptCollectorRelease = "futopt-daytrade-candles-v8"
$MutexName = "Global\FumanFugleDaytradeSourceWriter"
$CrossSessionLockPath = Join-Path $StateDir "daytrade-source-writer.cross-session.lock"
$CrossSessionLockStream = $null
$CrossSessionLockMaxAgeSeconds = 330
$Mutex = New-Object System.Threading.Mutex($false, $MutexName)
$MutexAcquired = $false

function Write-WrapperLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $WrapperLog -Value $line -Encoding utf8
}

function Invoke-MotherPoolReceiptRollover {
  param([int]$FastSyncExitCode)
  if (-not $Apply -or $FastSyncExitCode -ne 0) { return }

  $receiptPath = Join-Path $RuntimeDir "data\scan-receipts\daytrade-mother-pool-closed-loop-$($TradeDate.Replace('-','')).json"
  $snapshotPath = Join-Path $RuntimeDir "state\daytrade-mother-pool-snapshot-latest.json"
  $currentScript = Join-Path $RepoRoot "lib\mother-pool-receipt-current.cjs"
  $receiptComplete = $false
  if (Test-Path -LiteralPath $currentScript) {
    & node $currentScript $receiptPath $snapshotPath $TradeDate
    $receiptComplete = ($LASTEXITCODE -eq 0)
  }
  if ($receiptComplete) {
    Write-WrapperLog "MOTHER_POOL_RECEIPT_ROLLOVER skip=today_complete path=$receiptPath"
    return
  }

  $verifierScript = Join-Path $RepoRoot "scripts\verify-daytrade-mother-pool-closed-loop.js"
  if (-not (Test-Path -LiteralPath $verifierScript)) {
    Write-WrapperLog "MOTHER_POOL_RECEIPT_ROLLOVER skip=verifier_missing path=$verifierScript"
    return
  }
  $budget = Get-WriterProcessBudget -ElapsedSeconds $WrapperClock.Elapsed.TotalSeconds -MaximumSeconds 60 -ReserveSeconds 5
  if ($budget -lt 1) {
    Write-WrapperLog 'MOTHER_POOL_RECEIPT_ROLLOVER pending=WRAPPER_TIME_BUDGET_EXHAUSTED'
    return
  }
  $verifyLog = Join-Path $LogDir "mother-pool-rollover-$Stamp-$PID.log"
  $process = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('--use-system-ca', ('"' + $verifierScript + '"'), '--write-receipt') -RedirectStandardOutput $verifyLog -RedirectStandardError ($verifyLog + '.stderr') -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit($budget * 1000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction Stop
    $verifyExit = 124
  } else { $verifyExit = [int]$process.ExitCode }
  # Empty stderr is normal; force a scalar before applying string methods.
  [string]$verifyText = Get-Content -LiteralPath ($verifyLog + '.stderr') -Raw -ErrorAction SilentlyContinue
  $verifyText = ($verifyText -replace "[\r\n]+", " ").Trim()
  if ($verifyText.Length -gt 700) { $verifyText = $verifyText.Substring(0, 700) }
  Write-WrapperLog "MOTHER_POOL_RECEIPT_ROLLOVER exit=$verifyExit output=$verifyText"
}

function Get-IsoAgeSeconds {
  param([object]$Value)
  try {
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return 999999 }
    if ($Value -is [DateTime]) {
      $parsed = [DateTimeOffset]::new($Value.ToUniversalTime())
    } elseif ($Value -is [DateTimeOffset]) {
      $parsed = $Value.ToUniversalTime()
    } else {
      $parsed = [DateTimeOffset]::Parse([string]$Value).ToUniversalTime()
    }
    return [Math]::Max(0, [Math]::Floor(([DateTimeOffset]::UtcNow - $parsed).TotalSeconds))
  } catch {
    return 999999
  }
}

function Invoke-DaytradeWebSocketCollectorSelfHeal {
  if ($Apply) {
    $ensureScript = Join-Path $RepoRoot "scripts\ensure-daytrade-websocket-collector.js"
    if (Test-Path -LiteralPath $ensureScript) {
      $ensureOutput = & $node --use-system-ca $ensureScript "--phase=writer" "--apply" "--trade-date=$TradeDate" 2>&1
      $ensureExit = $LASTEXITCODE
      $compact = (($ensureOutput -join " ") -replace "[\r\n]+", " ").Trim()
      if ($compact.Length -gt 500) { $compact = $compact.Substring(0, 500) }
      Write-WrapperLog "WEBSOCKET_SELF_HEAL_V2 exit=$ensureExit output=$compact"
    } else {
      Write-WrapperLog "WEBSOCKET_SELF_HEAL_V2 skip=ensure_script_missing path=$ensureScript"
    }
  }
  if (-not $Apply) { return }

  $taipeiNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, "Taipei Standard Time")
  $minuteOfDay = ($taipeiNow.Hour * 60) + $taipeiNow.Minute
  if ($taipeiNow.DayOfWeek -in @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday) -or $minuteOfDay -lt 360 -or $minuteOfDay -gt 810) {
    return
  }

  $statusPath = Join-Path $StateDir "fugle-daytrade-websocket-status-v2.json"
  $supervisorPath = Join-Path $StateDir "fugle-daytrade-websocket-supervisor.json"
  $receiptDir = Join-Path $RuntimeDir "data\scan-receipts"
  $latestPath = Join-Path $receiptDir "daytrade-ws-collector-self-heal-latest.json"
  $receiptPath = Join-Path $receiptDir "daytrade-ws-collector-self-heal-$($TradeDate.Replace('-','')).json"
  New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null

  $status = $null
  $supervisor = $null
  try { if (Test-Path -LiteralPath $statusPath) { $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } } catch {}
  try { if (Test-Path -LiteralPath $supervisorPath) { $supervisor = Get-Content -LiteralPath $supervisorPath -Raw | ConvertFrom-Json } } catch {}

  $heartbeatAt = if ($status.websocket_heartbeat_at) { $status.websocket_heartbeat_at } elseif ($status.heartbeat_at) { $status.heartbeat_at } else { $status.updatedAt }
  $heartbeatAgeSeconds = Get-IsoAgeSeconds $heartbeatAt
  $pidAlive = $false
  if ($supervisor.pid) {
    try { $null = Get-Process -Id ([int]$supervisor.pid) -ErrorAction Stop; $pidAlive = $true } catch {}
  }
  if ($pidAlive -and $heartbeatAgeSeconds -le 90) { return }

  $previous = $null
  try { if (Test-Path -LiteralPath $latestPath) { $previous = Get-Content -LiteralPath $latestPath -Raw | ConvertFrom-Json } } catch {}
  $previousAgeSeconds = Get-IsoAgeSeconds $previous.checked_at
  $receipt = [ordered]@{
    contract = "daytrade_websocket_collector_self_heal_v1"
    trade_date = $TradeDate
    checked_at = [DateTimeOffset]::UtcNow.ToString("o")
    websocket_heartbeat_at = $heartbeatAt
    heartbeat_age_seconds = $heartbeatAgeSeconds
    supervisor_pid = if ($supervisor.pid) { [int]$supervisor.pid } else { 0 }
    supervisor_pid_alive = $pidAlive
    action = "not_requested"
    task_name = "Fuman Fugle Daytrade WebSocket Collector 0600-1330"
    first_blocker = $null
    ok = $false
  }

  if ($previousAgeSeconds -lt 240 -and [string]$previous.action -eq "scheduled_task_start_requested") {
    $receipt.action = "restart_rate_limited"
    $receipt.first_blocker = "collector_heartbeat_stale_restart_cooldown"
  } else {
    try {
      & schtasks.exe /Run /TN "Fuman Fugle Daytrade WebSocket Collector 0600-1330" | Out-Null
      $taskExit = [int]$LASTEXITCODE
      $receipt.task_exit_code = $taskExit
      if ($taskExit -eq 0) {
        $receipt.action = "scheduled_task_start_requested"
      } else {
        $receipt.action = "scheduled_task_start_failed"
        $receipt.first_blocker = "collector_task_start_failed"
      }
    } catch {
      $receipt.action = "scheduled_task_start_failed"
      $receipt.first_blocker = "collector_task_start_exception"
      $receipt.error = $_.Exception.Message
    }
  }

  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $latestPath -Encoding utf8
  Write-WrapperLog "WEBSOCKET_SELF_HEAL action=$($receipt.action) heartbeat_age_seconds=$heartbeatAgeSeconds receipt=$receiptPath"
}
function Test-FutoptCollectorHealthy {
  param([object]$Status)
  if ($null -eq $Status) { return $false }
  foreach ($field in @('ok','websocketConnected','websocketAuthenticated','formalReady')) {
    if ($Status.$field -isnot [bool] -or $Status.$field -ne $true) { return $false }
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$Status.error)) { return $false }
  try {
    if ($Status.updatedAt -is [DateTime]) { $stamp = [DateTimeOffset]::new($Status.updatedAt.ToUniversalTime()) }
    elseif ($Status.updatedAt -is [DateTimeOffset]) { $stamp = $Status.updatedAt.ToUniversalTime() }
    else { $stamp = [DateTimeOffset]::Parse([string]$Status.updatedAt).ToUniversalTime() }
    $age = ([DateTimeOffset]::UtcNow - $stamp).TotalSeconds
    return ($age -ge 0 -and $age -le 90)
  } catch { return $false }
}
function Invoke-FugleFutoptCollectorReleaseReconcile {
  $statusPath = Join-Path $StateDir "fugle-futopt-websocket-status.json"
  $receiptPath = Join-Path $StateDir "fugle-daytrade-futopt-collector-rotation.json"
  $current = $null
  try { if (Test-Path -LiteralPath $statusPath) { $current = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } } catch {}
  $currentRelease = if ($null -ne $current) { [string]$current.collector_release } else { "" }
  $targetProcessId = 0
  try { if ($null -ne $current) { $targetProcessId = [int]$current.pid } } catch {}
  $alive = $false
  if ($targetProcessId -gt 0) { try { $alive = $null -ne (Get-Process -Id $targetProcessId -ErrorAction Stop) } catch {} }
  $streamStale = $false
  $transportStamp = if ($null -ne $current.transportHealth) { $current.transportHealth.last_transport_at } else { $current.lastMessageAt }
  if ($null -ne $current -and -not [string]::IsNullOrWhiteSpace($transportStamp)) {
    try {
      $streamStale = (Get-IsoAgeSeconds $transportStamp) -gt 300
    } catch { $streamStale = $true }
  }
  $receipt = [ordered]@{ contract="fugle_daytrade_futopt_collector_rotation_v1"; checked_at=[DateTimeOffset]::UtcNow.ToString("o"); trade_date=$TradeDate; desired_release=$FutoptCollectorRelease; current_release=$currentRelease; current_pid=$targetProcessId; status="pending"; reason="" }
  if ($alive -and $currentRelease -eq $FutoptCollectorRelease -and -not $streamStale) {
    if (-not (Test-FutoptCollectorHealthy $current)) {
      $receipt.status = "blocked"
      $receipt.reason = "collector_alive_but_health_unverified"
      $receipt.source_error = [string]$current.error
      $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8
      return $false
    }
    $receipt.status = "current"
    $receipt.reason = "collector_release_current"
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8
    return $true
  }
  if ($alive) {
    try {
      Stop-Process -Id $targetProcessId -Force -ErrorAction Stop
      Start-Sleep -Milliseconds 800
      if (Get-Process -Id $targetProcessId -ErrorAction SilentlyContinue) { throw "collector_pid_still_running" }
      $receipt.status = "retired"
      $receipt.reason = if ($streamStale) { "collector_stream_stale" } else { "collector_release_mismatch" }
      Write-WrapperLog "futopt collector retired pid=$targetProcessId for release=$FutoptCollectorRelease"
    } catch {
      $receipt.status = "blocked"
      $receipt.reason = "collector_rotation_stop_failed"
      $receipt.error = $_.Exception.Message
      $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8
      Write-WrapperLog "WARN futopt collector rotation failed pid=${targetProcessId}: $($_.Exception.Message)"
      return $false
    }
  }
  $collector = Join-Path $RepoRoot "scripts\fugle-futopt-websocket-collector.js"
  $nodeExe = "C:\Program Files\nodejs\node.exe"
  if (-not (Test-Path -LiteralPath $collector) -or -not (Test-Path -LiteralPath $nodeExe)) {
    $receipt.status = "blocked"
    $receipt.reason = "collector_or_node_missing"
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8
    return $false
  }
  $env:FUGLE_FUTOPT_STREAMING_CHANNELS = "trades,aggregates,candles"
  $env:FUGLE_FUTOPT_STREAMING_AFTER_HOURS = "false"
  $env:FUGLE_FUTOPT_STREAMING_MAX_TOTAL_SUBSCRIPTIONS = "1800"
  $env:FUGLE_FUTOPT_STREAMING_MAX_SYMBOLS = "500"
  $env:FUGLE_FUTOPT_COLLECTOR_RELEASE = $FutoptCollectorRelease
  try {
    $collectorLogId = [DateTimeOffset]::UtcNow.ToString("yyyyMMddHHmmss") + "-" + [Guid]::NewGuid().ToString("N")
    $collectorStdout = Join-Path $LogDir "fugle-futopt-collector-$collectorLogId.stdout.log"
    $collectorStderr = Join-Path $LogDir "fugle-futopt-collector-$collectorLogId.stderr.log"
    $receipt.previous_pid_alive = $alive
    $receipt.stdout_path = $collectorStdout
    $receipt.stderr_path = $collectorStderr
    $process = Start-Process -FilePath $nodeExe -ArgumentList @("--use-system-ca", $collector) -WorkingDirectory (Split-Path -Parent $collector) -WindowStyle Hidden -RedirectStandardOutput $collectorStdout -RedirectStandardError $collectorStderr -PassThru -ErrorAction Stop
    $receipt.status = "started"
    $receipt.reason = "collector_release_started"
    $receipt.started_pid = $process.Id
    Write-WrapperLog "futopt collector started pid=$($process.Id) release=$FutoptCollectorRelease"
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8
    return $true
  } catch {
    $receipt.status = "blocked"
    $receipt.reason = "collector_start_failed"
    $receipt.error = $_.Exception.Message
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8
    Write-WrapperLog "WARN futopt collector start failed: $($_.Exception.Message)"
    return $false
  }
}

function Write-FailureArtifact {
  param([int]$ExitCode, [string]$Reason)
  $artifact = [ordered]@{
    ok = $false
    source_name = "fugle_daytrade_source"
    checked_at = [DateTimeOffset]::UtcNow.ToString("o")
    trade_date = $TradeDate
    run_id = $RunId
    gate_grade = "D"
    daytrade_gate_grade = "D"
    status = "runtime_failure"
    message = $Reason
    formal_entry_allowed = $false
    latest_update_allowed = $false
    preserve_previous_good = $true
    no_empty_latest = $true
    no_latest_pointer_update = $true
    stop_new_signals = $true
    failed_checks = @($Reason)
    stdout_log = $StdoutLog
    stderr_log = $StderrLog
    wrapper_log = $WrapperLog
    exit_code = $ExitCode
  }
  $artifact | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $StateDir "daytrade-source-writer.failure.json") -Encoding utf8
}

function Invoke-DaytradeSideVolumeCanonicalVerifier {
  if (-not $Apply -or $LocalCheck) { return }
  $taipeiNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, "Taipei Standard Time")
  $minuteOfDay = ($taipeiNow.Hour * 60) + $taipeiNow.Minute
  if ($minuteOfDay -lt 540 -or $minuteOfDay -gt 810) { return }
  $modulePolicyScript = Join-Path $RepoRoot 'scripts\read-daytrade-side-verifier-policy.cjs'
  $modulePolicyRaw = & node $modulePolicyScript $StdoutLog $TradeDate
  if ($LASTEXITCODE -ne 0) { throw 'SIDE_VOLUME_MODULE_POLICY_UNVERIFIED' }
  $modulePolicy = ($modulePolicyRaw -join "`n") | ConvertFrom-Json
  if ($modulePolicy.status -eq 'PAUSED') {
    Write-WrapperLog "SIDE_VOLUME_VERIFIER_PAUSED writer_run_id=$($modulePolicy.writer_run_id) complete=false reason=$($modulePolicy.reason)"
    return
  }
  if ($modulePolicy.status -ne 'RUN') { throw 'SIDE_VOLUME_MODULE_POLICY_INVALID' }
  $verifierScript = Join-Path $RepoRoot "scripts\verify-daytrade-side-volume-contract.js"
  if (-not (Test-Path -LiteralPath $verifierScript)) {
    Write-WrapperLog "SIDE_VOLUME_VERIFIER_SKIP reason=verifier_missing path=$verifierScript"
    return
  }

  $throttleSeconds = if ($env:FUMAN_SIDE_VOLUME_VERIFY_INTERVAL_SECONDS) { [int]$env:FUMAN_SIDE_VOLUME_VERIFY_INTERVAL_SECONDS } else { 300 }
  if ($throttleSeconds -lt 60) { $throttleSeconds = 60 }
  $scheduleStatePath = Join-Path $StateDir "daytrade-side-volume-verifier-schedule.json"
  $previous = $null
  try { if (Test-Path -LiteralPath $scheduleStatePath) { $previous = Get-Content -LiteralPath $scheduleStatePath -Raw | ConvertFrom-Json } } catch {}
  $previousAgeSeconds = Get-IsoAgeSeconds $previous.started_at
  if ($previousAgeSeconds -lt $throttleSeconds) {
    Write-WrapperLog "SIDE_VOLUME_VERIFIER_THROTTLED age_seconds=$previousAgeSeconds interval_seconds=$throttleSeconds"
    return
  }

  $verifierStamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMddHHmmss")
  $verifierLog = Join-Path $LogDir "daytrade-side-volume-verifier-$($TradeDate.Replace('-',''))-$verifierStamp.log"
  $state = [ordered]@{
    contract = "daytrade_side_volume_writer_schedule_v1"
    trade_date = $TradeDate
    started_at = [DateTimeOffset]::UtcNow.ToString("o")
    completed_at = $null
    verifier = "scripts/verify-daytrade-side-volume-contract.js"
    arguments = @("--write-receipt", "--publish-receipt")
    status = "running"
    exit_code = $null
    receipt_status = $null
    receipt_complete = $false
    log = $verifierLog
  }
  $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $scheduleStatePath -Encoding utf8
  $verifierBudget = Get-WriterProcessBudget -ElapsedSeconds $WrapperClock.Elapsed.TotalSeconds -ReserveSeconds 5
  if ($verifierBudget -lt 1) {
    $state.status = 'failed'; $state.exit_code = 124; $state.first_blocker = 'WRAPPER_TIME_BUDGET_EXHAUSTED'
    $state.completed_at = [DateTimeOffset]::UtcNow.ToString('o')
    $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $scheduleStatePath -Encoding utf8
    throw 'WRAPPER_TIME_BUDGET_EXHAUSTED:side_volume_verifier'
  }
  $verifierProcess = Start-Process -FilePath $node -ArgumentList @('--use-system-ca', $verifierScript, '--write-receipt', '--publish-receipt') -RedirectStandardOutput $verifierLog -RedirectStandardError ($verifierLog + '.stderr') -PassThru -WindowStyle Hidden
  if (-not $verifierProcess.WaitForExit($verifierBudget * 1000)) {
    Stop-Process -Id $verifierProcess.Id -Force -ErrorAction Stop
    $verifierExit = 124
  } else { $verifierExit = [int]$verifierProcess.ExitCode }
  $verifierPayload = $null
  # Native stdout can be transcoded by a scheduled PowerShell host and corrupt
  # non-ASCII stock names. The verifier's UTF-8 canonical receipt is the
  # parsing authority; stdout remains diagnostic-only.
  $canonicalReceiptPath = Join-Path $RuntimeDir "data\scan-receipts\daytrade-side-volume-2000-canonical-receipt-latest.json"
  $receiptReadError = ""
  for ($receiptReadAttempt = 1; $receiptReadAttempt -le 5 -and $null -eq $verifierPayload; $receiptReadAttempt++) {
    try {
      if (Test-Path -LiteralPath $canonicalReceiptPath) {
        $candidate = Get-Content -LiteralPath $canonicalReceiptPath -Raw | ConvertFrom-Json -DateKind String
        # Force both ISO-8601 values to UTC. On a Taiwan host the one-argument
        # Parse overload can reinterpret a trailing Z as local +08:00 and make
        # a newly written receipt appear eight hours older than this attempt.
        $utcStyle = [Globalization.DateTimeStyles]::RoundtripKind
        $invariantCulture = [Globalization.CultureInfo]::InvariantCulture
        $candidateTime = [DateTimeOffset]::Parse([string]$candidate.checked_at, $invariantCulture, $utcStyle)
        $startedTime = [DateTimeOffset]::Parse([string]$state.started_at, $invariantCulture, $utcStyle)
        if ([string]$candidate.trade_date -eq $TradeDate -and $candidateTime -ge $startedTime) {
          $verifierPayload = $candidate
        } else {
          $receiptReadError = "canonical_receipt_not_from_current_attempt"
        }
      } else {
        $receiptReadError = "canonical_receipt_missing"
      }
    } catch {
      $receiptReadError = $_.Exception.Message
    }
    if ($null -eq $verifierPayload -and $receiptReadAttempt -lt 5) {
      Start-Sleep -Milliseconds 200
    }
  }
  $state.completed_at = [DateTimeOffset]::UtcNow.ToString("o")
  $state.exit_code = $verifierExit
  $state.receipt_status = if ($null -ne $verifierPayload) { [string]$verifierPayload.status } else { "unparseable" }
  $state.receipt_complete = $null -ne $verifierPayload -and $verifierPayload.complete -eq $true
  $state.status = if ($verifierExit -eq 0 -and $state.receipt_complete -eq $true) { "complete" } elseif ($null -ne $verifierPayload -and [string]$verifierPayload.status -eq "partial") { "partial" } else { "failed" }
  $state.verification_run_id = if ($null -ne $verifierPayload) { [string]$verifierPayload.verification_run_id } else { "" }
  $state.first_blocker = if ($null -ne $verifierPayload) { [string]$verifierPayload.first_blocker } else { "verifier_output_unparseable" }
  $state.receipt_read_error = if ($null -ne $verifierPayload) { $null } else { $receiptReadError }
  $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $scheduleStatePath -Encoding utf8
  Write-WrapperLog "SIDE_VOLUME_VERIFIER_DONE status=$($state.status) receipt_status=$($state.receipt_status) complete=$($state.receipt_complete) exit=$verifierExit verification_run_id=$($state.verification_run_id)"
  if ($verifierExit -ne 0 -or $state.receipt_complete -ne $true) { throw 'SIDE_VOLUME_VERIFIER_INCOMPLETE' }
}

if (-not (Test-Path -LiteralPath $WriterScript)) {
  Write-FailureArtifact 9002 "writer_script_missing"
  throw "Missing writer script: $WriterScript"
}

$env:FUMAN_RUNTIME_DIR = $RuntimeDir
$env:FUGLE_COLLECTOR_ROLE = "daytrade"
$env:FUMAN_DAYTRADE_SOURCE_ROLE = "writer"
$env:DAYTRADE_SUPABASE_READ_TIMEOUT_MS = "10000"
$env:DAYTRADE_SUPABASE_WRITE_TIMEOUT_MS = "20000"
$env:DAYTRADE_SUPABASE_TRANSIENT_RETRIES = "2"
$env:DAYTRADE_SUPABASE_RETRY_BASE_DELAY_MS = "1000"
$env:FUMAN_FORMAL_SOURCE_WINDOW_START = "0600"
$env:FUMAN_FORMAL_SOURCE_WINDOW_END = "1330"

# Closeout shares the same cross-session and OS mutex as the Writer.
$closeoutNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, "Taipei Standard Time")
$runCloseout = $Apply -and -not $LocalCheck -and (($closeoutNow.Hour * 60 + $closeoutNow.Minute) -ge 810)

# Serializes the entire round, including fast sync before the legacy Writer lock.
# File ownership is released by Windows even on an early exit or process crash.
$DatabaseRoundLock = $null
$BackoffScript = Join-Path $RepoRoot 'scripts\writer-database-backoff.cjs'
$BackoffState = Join-Path $StateDir 'writer-database-backoff.json'
function Update-WriterDatabaseBackoff {
  param([string]$Action, [string]$Diagnostic = '')
  if (-not $Apply -or $LocalCheck) { return }
  $out = $Diagnostic | & node $BackoffScript $Action $BackoffState 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'WRITER_BACKOFF_STATE_UPDATE_FAILED' }
}
if ($Apply -and -not $LocalCheck) {
  if (-not (Test-Path -LiteralPath $BackoffScript)) { throw 'WRITER_BACKOFF_HELPER_MISSING' }
  try {
    $DatabaseRoundLock = [IO.File]::Open((Join-Path $StateDir 'writer-database-round.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  } catch [IO.IOException] {
    Write-WrapperLog 'SKIP database_round_already_running'
    exit 0
  }
  $backoffOutput = & node $BackoffScript check $BackoffState 2>&1
  $backoffExit = $LASTEXITCODE
  if ($backoffExit -ne 0) {
    Write-WrapperLog "STOP database_backoff exit=$backoffExit evidence=$backoffOutput"
    exit $backoffExit
  }
}
# FUMAN_MARKET_CLOSED_RUNNER_GUARD_V1
. "$RepoRoot\schedule-guard.ps1"
# A trading-day pre-open run writes warmup evidence only. It must not be
# treated as a formal scan, but it must not be skipped by the generic formal
# source-window guard either.
$preopenWarmup = $false
if ($Apply) {
  $taipeiNow = Get-FumanTaipeiNow
  $minuteOfDay = ($taipeiNow.Hour * 60) + $taipeiNow.Minute
  $preopenWarmup = $minuteOfDay -ge 360 -and $minuteOfDay -lt 510
}
if ($preopenWarmup) {
  $calendarScript = Join-Path $RepoRoot "scripts\check-market-calendar-action.js"
  $calendarOutput = & node $calendarScript "--label=Daytrade source writer warmup" "--receipt=1" 2>&1
  $calendarExit = $LASTEXITCODE
  $calendarPayload = $null
  try { $calendarPayload = (($calendarOutput | Out-String).Trim() | ConvertFrom-Json) } catch {}
  if ($calendarExit -ne 0 -or $null -eq $calendarPayload -or $calendarPayload.tradingDay.isTradingDay -ne $true) {
    Write-WrapperLog "PREOPEN_WARMUP_BLOCKED calendar_exit=$calendarExit; no source write"
    exit 0
  }
  Write-WrapperLog "PREOPEN_WARMUP_ALLOWED trade_date=$($calendarPayload.tradingDay.date); warmup_only=true; formal_entry_allowed=false"
} elseif (-not $runCloseout) {
  Invoke-FumanWeekdayGuard -Label "Daytrade source writer" -LogPath $WrapperLog
}

# Keep the pre-open scorecard bounded to A01-A19. This is explicitly reset on
# every post-open invocation so 09:00+ retains the full scorecard payload.
$env:DAYTRADE_PREOPEN_LIGHT_MODE = if ($preopenWarmup) { "1" } else { "0" }

$node = "node"
$args = @("--use-system-ca", $WriterScript)

if ($LocalCheck) {
  $args += "--local-check"
} elseif ($Apply) {
  $args += "--apply"
  if ($Once) {
    $args += "--once"
  } else {
    $args += "--max-seconds=420"
  }
} else {
  $args += "--dry-run"
  $args += "--no-fetch"
  $args += "--once"
}

if ($Fetch -and -not $Apply) {
  $args = @("--use-system-ca", $WriterScript, "--dry-run", "--fetch")
  if ($Once -or -not $Continuous) { $args += "--once" }
}

$EffectiveOnce = $args -contains "--once"
Write-WrapperLog "START run_id=$RunId apply=$Apply fetch=$Fetch once=$Once continuous=$Continuous effectiveOnce=$EffectiveOnce localCheck=$LocalCheck"
if (-not $runCloseout) { Invoke-DaytradeWebSocketCollectorSelfHeal }
if ($Apply -and (-not $runCloseout -or $ClosingWaterOnly)) {
  $fastSyncExit = -1
  $fastSyncScript = Join-Path $RepoRoot "scripts\sync-daytrade-websocket-supabase-fast.js"
  if (Test-Path -LiteralPath $fastSyncScript) {
    $fastSyncStartedAt = [DateTimeOffset]::UtcNow
    $fastSyncOutput = & node --use-system-ca $fastSyncScript --apply 2>&1
    $fastSyncExit = $LASTEXITCODE
    $fastSyncText = (($fastSyncOutput | Out-String) -replace "[\r\n]+", " ").Trim()
    if ($fastSyncText.Length -gt 700) { $fastSyncText = $fastSyncText.Substring(0, 700) }
    Write-WrapperLog "FAST_SUPABASE_SYNC exit=$fastSyncExit output=$fastSyncText"
    # A failed write may already have committed some batches. Do not start
    # rollover, lease acquisition or another writer after an uncertain result.
    if ($fastSyncExit -ne 0) {
      Update-WriterDatabaseBackoff 'failure' $fastSyncText
      Write-FailureArtifact 9010 "fast_supabase_sync_failed_stop_current_run"
      Write-WrapperLog "STOP fast_supabase_sync_failed downstream_started=false"
      exit 9010
    }
  } else {
    Write-WrapperLog "FAST_SUPABASE_SYNC skip=script_missing path=$fastSyncScript"
  }
  if ($ClosingWaterOnly) {
    if ($fastSyncExit -ne 0) { throw 'CLOSING_WATER_SYNC_NOT_EXECUTED' }
    $sync = Get-Content -LiteralPath (Join-Path $StateDir 'daytrade-fast-supabase-sync.json') -Raw | ConvertFrom-Json
    if (-not (Test-ClosingWaterSyncReceipt -Receipt $sync -Date $TradeDate -StartedAt $fastSyncStartedAt)) { throw 'CLOSING_WATER_RECEIPT_INVALID' }
    $closingReceipt = [ordered]@{contract='daytrade-closing-water-write-v1';trade_date=$TradeDate;status='written_pending_independent_readback';complete=$false;written=$true;source='existing_shared_websocket_cache';fast_sync=$sync;checked_at=[DateTimeOffset]::UtcNow.ToString('o');strategy_scan_started=$false;module_b18_started=$false;notifications_sent=0;orders_sent=0}
    $closingPath = Join-Path $StateDir ('daytrade-closing-water-' + $TradeDate + '.json')
    $temp = $closingPath + '.' + $PID + '.tmp'
    $closingReceipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temp -Encoding utf8
    [IO.File]::Move($temp, $closingPath, $true)
    Update-WriterDatabaseBackoff 'success'
    Write-WrapperLog 'CLOSING_WATER_WRITTEN strategies_started=false independent_readback_pending=true'
    exit 0
  }
}
try {
  if (Test-Path -LiteralPath $CrossSessionLockPath) {
    $staleLockProbe = $null
    try {
      $staleLockProbe = [System.IO.File]::Open($CrossSessionLockPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
      $staleLockAgeSeconds = [Math]::Max(0, ((Get-Date) - (Get-Item -LiteralPath $CrossSessionLockPath).LastWriteTime).TotalSeconds)
      $staleLockProbe.Dispose()
      $staleLockProbe = $null
      if ($staleLockAgeSeconds -ge $CrossSessionLockMaxAgeSeconds) {
        Remove-Item -LiteralPath $CrossSessionLockPath -Force -ErrorAction Stop
        Write-WrapperLog "RECOVER stale_unlocked_cross_session_lock age_seconds=$([Math]::Round($staleLockAgeSeconds)) path=$CrossSessionLockPath"
      }
    } catch [System.IO.IOException] {
      # An active writer still owns the file lock; CreateNew below will skip safely.
    } finally {
      if ($staleLockProbe) { try { $staleLockProbe.Dispose() } catch {} }
    }
  }
  try {
    $CrossSessionLockStream = [System.IO.File]::Open($CrossSessionLockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $lockBytes = [System.Text.Encoding]::UTF8.GetBytes("run_id=$RunId`nstarted_at=$([DateTimeOffset]::UtcNow.ToString("o"))`n")
    $CrossSessionLockStream.Write($lockBytes, 0, $lockBytes.Length)
    $CrossSessionLockStream.Flush()
  } catch [System.IO.IOException] {
    Write-WrapperLog "SKIP cross_session_writer_lock_exists path=$CrossSessionLockPath stdout=$StdoutLog stderr=$StderrLog"
    [ordered]@{ ok = $true; skipped = $true; reason = "writer_cross_session_lock_exists"; source_name = "fugle_daytrade_source"; checked_at = [DateTimeOffset]::UtcNow.ToString("o"); trade_date = $TradeDate; run_id = $RunId; preserve_previous_good = $true } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $StdoutLog -Encoding utf8
    exit 0
  }
  try {
    $MutexAcquired = $Mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    # The prior writer ended unexpectedly. Windows grants ownership here, so recover it.
    $MutexAcquired = $true
    Write-WrapperLog "RECOVER abandoned_mutex owner_acquired=true"
  }
  if (-not $MutexAcquired) {
    Write-WrapperLog "SKIP already_running stdout=$StdoutLog stderr=$StderrLog"
    [ordered]@{
      ok = $true
      skipped = $true
      reason = "writer_already_running"
      source_name = "fugle_daytrade_source"
      checked_at = [DateTimeOffset]::UtcNow.ToString("o")
      trade_date = $TradeDate
      run_id = $RunId
      preserve_previous_good = $true
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $StdoutLog -Encoding utf8
    exit 0
  }

  if ($runCloseout) {
    $env:FUMAN_RUNTIME = $RuntimeDir
    & node (Join-Path $RepoRoot "scripts/run-mother-pool-closeout.js") --apply
    $closeoutExit = $LASTEXITCODE
    Write-WrapperLog "MOTHER_CLOSEOUT exit=$closeoutExit"
    if ($closeoutExit -eq 3) { exit 0 }
    if ($closeoutExit -eq 0) {
      & node (Join-Path $RepoRoot "scripts/run-daytrade-module-verifiers.js")
      exit $LASTEXITCODE
    }
    exit $closeoutExit
  }

  if ($Apply -and -not (Invoke-FugleFutoptCollectorReleaseReconcile)) {
    Write-WrapperLog "WARN futopt collector reconcile blocked; canonical gate remains fail-closed"
  }

  $attempts = if ($env:FUMAN_DAYTRADE_WRAPPER_ATTEMPTS) { [int]$env:FUMAN_DAYTRADE_WRAPPER_ATTEMPTS } else { 1 }
  if ($attempts -lt 1) { $attempts = 1 }
  $retrySeconds = if ($env:FUMAN_DAYTRADE_WRAPPER_RETRY_SECONDS) { [int]$env:FUMAN_DAYTRADE_WRAPPER_RETRY_SECONDS } else { 8 }
  if ($retrySeconds -lt 0) { $retrySeconds = 0 }
  $exitCode = 1
  # Preopen A01-A19 is a dedicated bounded batch.  It runs outside the
  # minute Writer's status_scorecard tail; the script owns a daily lock and
  # completion marker, so repeated wrapper ticks cannot duplicate it.
  $preopenNow = (Get-Date).TimeOfDay.TotalMinutes
  if ($Apply -and $preopenNow -ge 360 -and $preopenNow -lt 540) {
    $preopenScript = "C:\fuman-release-owner\prod81\scripts\run-daytrade-preopen-a01-a19.js"
    if (Test-Path -LiteralPath $preopenScript) {
      try {
        Start-Process -FilePath $node -ArgumentList @("--use-system-ca", $preopenScript) -WorkingDirectory (Split-Path -Parent $preopenScript) -WindowStyle Hidden | Out-Null
        Write-WrapperLog "PREOPEN_A01_A19 start=detached script=$preopenScript"
      } catch {
        Write-WrapperLog "PREOPEN_A01_A19 start_failed message=$($_.Exception.Message)"
      }
    } else { Write-WrapperLog "PREOPEN_A01_A19 skip=script_missing path=$preopenScript" }
  }
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    Write-WrapperLog "NODE_ATTEMPT $attempt/$attempts stdout=$StdoutLog stderr=$StderrLog"
    # The task's five-minute ceiling includes calendar, fast sync and setup.
    # Keep cleanup time; never add a fresh per-child five-minute allowance.
    $requestedTimeout = if ($env:FUMAN_DAYTRADE_WRITER_NODE_TIMEOUT_SECONDS) { [int]$env:FUMAN_DAYTRADE_WRITER_NODE_TIMEOUT_SECONDS } else { 285 }
    $nodeTimeoutSeconds = Get-WriterProcessBudget -ElapsedSeconds $WrapperClock.Elapsed.TotalSeconds -MaximumSeconds $requestedTimeout
    Write-WrapperLog "NODE_BUDGET seconds=$nodeTimeoutSeconds elapsed_seconds=$([Math]::Round($WrapperClock.Elapsed.TotalSeconds)) task_limit_seconds=300"
    if ($nodeTimeoutSeconds -lt 1) { throw 'WRAPPER_TIME_BUDGET_EXHAUSTED:writer' }
    $nodeProcess = Start-Process -FilePath $node -ArgumentList $args -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru -WindowStyle Hidden
    if (-not $nodeProcess.WaitForExit($nodeTimeoutSeconds * 1000)) {
      try { Stop-Process -Id $nodeProcess.Id -Force -ErrorAction Stop } catch {}
      $exitCode = 124
      Add-Content -LiteralPath $StderrLog -Value "writer_node_timeout_seconds=$nodeTimeoutSeconds" -Encoding utf8
    } else {
      $exitCode = [int]$nodeProcess.ExitCode
    }
    if ($exitCode -eq 0) { break }
    $stderrText = if (Test-Path -LiteralPath $StderrLog) { Get-Content -LiteralPath $StderrLog -Raw -ErrorAction SilentlyContinue } else { "" }
    $stdoutText = if (Test-Path -LiteralPath $StdoutLog) { Get-Content -LiteralPath $StdoutLog -Raw -ErrorAction SilentlyContinue } else { "" }
    $transient = "$stderrText`n$stdoutText" -match "fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|timeout|aborted|HTTP 5\d\d|502|503|504|521|522|429"
    if (-not $transient -or $attempt -ge $attempts) { break }
    Write-WrapperLog "RETRY transient_exit_$exitCode attempt=$attempt/$attempts"
    if ($retrySeconds -gt 0) { Start-Sleep -Seconds $retrySeconds }
  }
  if ($exitCode -ne 0) {
    $diagnostic = (($stderrText + " " + $stdoutText) -replace "[\r\n]+", " ").Trim()
    if ($diagnostic.Length -gt 500) { $diagnostic = $diagnostic.Substring(0, 500) }
    Update-WriterDatabaseBackoff 'failure' ($stderrText + ' ' + $stdoutText)
    Write-FailureArtifact $exitCode "writer_exit_$exitCode detail=$diagnostic"
    Write-WrapperLog "FAIL writer_exit_$exitCode detail=$diagnostic stdout=$StdoutLog stderr=$StderrLog"
    exit $exitCode
  }
  Update-WriterDatabaseBackoff 'success'
  Invoke-MotherPoolReceiptRollover -FastSyncExitCode 0
  Invoke-DaytradeSideVolumeCanonicalVerifier
  Write-WrapperLog "DONE ok stdout=$StdoutLog stderr=$StderrLog"
  exit 0
} catch {
  $message = $_.Exception.Message
  Write-FailureArtifact 9003 "writer_wrapper_exception"
  Write-WrapperLog "FAIL writer_wrapper_exception message=$message stdout=$StdoutLog stderr=$StderrLog"
  exit 1
} finally {
  if ($MutexAcquired) {
    try { $Mutex.ReleaseMutex() | Out-Null } catch {}
  }
  try { $Mutex.Dispose() } catch {}
  if ($CrossSessionLockStream) {
    try { $CrossSessionLockStream.Dispose() } catch {}
    try { Remove-Item -LiteralPath $CrossSessionLockPath -Force -ErrorAction SilentlyContinue } catch {}
  }
}
