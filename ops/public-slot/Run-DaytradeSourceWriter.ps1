param(
  [string]$FumanRoot = "C:\fuman-release-owner\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$Apply,
  [switch]$Fetch,
  [switch]$Once,
  [switch]$Continuous,
  [switch]$LocalCheck
)

# Run-DaytradeSourceWriter.ps1 is a release-owner wrapper.
# Default mode is dry-run/no-fetch/once. Use -Apply only in an approved writer window.
$ErrorActionPreference = "Stop"

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
$FutoptCollectorRelease = "futopt-formal-live-mirror-v5"
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
  $receipt = [ordered]@{ contract="fugle_daytrade_futopt_collector_rotation_v1"; checked_at=[DateTimeOffset]::UtcNow.ToString("o"); trade_date=$TradeDate; desired_release=$FutoptCollectorRelease; current_release=$currentRelease; current_pid=$targetProcessId; status="pending"; reason="" }
  if ($alive -and $currentRelease -eq $FutoptCollectorRelease) {
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
      $receipt.reason = "collector_release_mismatch"
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
  $env:FUGLE_FUTOPT_STREAMING_MAX_TOTAL_SUBSCRIPTIONS = "1800"
  $env:FUGLE_FUTOPT_STREAMING_MAX_SYMBOLS = "500"
  $env:FUGLE_FUTOPT_COLLECTOR_RELEASE = $FutoptCollectorRelease
  try {
    $process = Start-Process -FilePath $nodeExe -ArgumentList @("--use-system-ca", $collector) -WorkingDirectory (Split-Path -Parent $collector) -WindowStyle Hidden -PassThru -ErrorAction Stop
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
} else {
  Invoke-FumanWeekdayGuard -Label "Daytrade source writer" -LogPath $WrapperLog
}

$node = "node"
$args = @("--use-system-ca", $WriterScript)

if ($LocalCheck) {
  $args += "--local-check"
} elseif ($Apply) {
  $args += "--apply"
  if ($Once) {
    $args += "--once"
  } else {
    $args += "--max-seconds=300"
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
Invoke-DaytradeWebSocketCollectorSelfHeal
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

  if ($Apply -and -not (Invoke-FugleFutoptCollectorReleaseReconcile)) {
    Write-WrapperLog "WARN futopt collector reconcile blocked; canonical gate remains fail-closed"
  }

  $attempts = if ($env:FUMAN_DAYTRADE_WRAPPER_ATTEMPTS) { [int]$env:FUMAN_DAYTRADE_WRAPPER_ATTEMPTS } else { 1 }
  if ($attempts -lt 1) { $attempts = 1 }
  $retrySeconds = if ($env:FUMAN_DAYTRADE_WRAPPER_RETRY_SECONDS) { [int]$env:FUMAN_DAYTRADE_WRAPPER_RETRY_SECONDS } else { 8 }
  if ($retrySeconds -lt 0) { $retrySeconds = 0 }
  $exitCode = 1
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    Write-WrapperLog "NODE_ATTEMPT $attempt/$attempts stdout=$StdoutLog stderr=$StderrLog"
    $nodeTimeoutSeconds = if ($env:FUMAN_DAYTRADE_WRITER_NODE_TIMEOUT_SECONDS) { [int]$env:FUMAN_DAYTRADE_WRITER_NODE_TIMEOUT_SECONDS } else { 270 }
    if ($nodeTimeoutSeconds -lt 30) { $nodeTimeoutSeconds = 30 }
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
    Write-FailureArtifact $exitCode "writer_exit_$exitCode detail=$diagnostic"
    Write-WrapperLog "FAIL writer_exit_$exitCode detail=$diagnostic stdout=$StdoutLog stderr=$StderrLog"
    exit $exitCode
  }
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
