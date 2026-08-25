param(
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"
$collector = Join-Path $FumanRoot "scripts\fugle-websocket-collector.js"
$node = "C:\Program Files\nodejs\node.exe"
$logDir = Join-Path $RuntimeDir "logs"
$stateDir = Join-Path $RuntimeDir "state"
$cacheDir = Join-Path $RuntimeDir "cache\intraday"
$statusFile = Join-Path $stateDir "fugle-daytrade-websocket-supervisor.json"
$mutexName = "Global\FumanFugleDaytradeWebSocketCollector"
$mutex = $null
$acquired = $false
$collectorProcess = $null

function Get-TaipeiNow {
  [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, "Taipei Standard Time")
}

function Write-State {
  param([string]$Status, [int]$ProcessId = 0, [string]$Reason = "", [int]$BackoffSeconds = 0)
  [ordered]@{
    ok = $Status -eq "running"
    status = $Status
    role = "daytrade"
    sourceHostId = $env:FUMAN_DAYTRADE_SOURCE_HOST_ID
    sourceHostRole = $env:FUMAN_DAYTRADE_SOURCE_ROLE
    authoritativeWriter = $true
    checkedAt = [DateTimeOffset]::UtcNow.ToString("o")
    pid = $ProcessId
    reason = $Reason
    backoffSeconds = $BackoffSeconds
    prioritySymbolsFile = (Join-Path $cacheDir "fugle-daytrade-ws-priority-symbols.json")
    websocketStatusFile = (Join-Path $stateDir "fugle-daytrade-websocket-status-v2.json")
    maxCollectors = 1
  } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $statusFile -Encoding utf8
}

function Get-WebSocketStatusAgeSeconds {
  $websocketStatusFile = Join-Path $stateDir "fugle-daytrade-websocket-status-v2.json"
  if (-not (Test-Path -LiteralPath $websocketStatusFile)) { return 999999 }
  try {
    $payload = Get-Content -LiteralPath $websocketStatusFile -Raw | ConvertFrom-Json
    $updatedAt = [DateTimeOffset]::Parse([string]$payload.updatedAt)
    return [Math]::Max(0, [int]([DateTimeOffset]::UtcNow - $updatedAt.ToUniversalTime()).TotalSeconds)
  } catch {
    return 999999
  }
}
function Stop-OrphanCollectorProcesses {
  # A forced Task Scheduler stop can orphan the Node child in Session 0.
  # Reap only this collector before a new supervisor starts; never touch other Node services.
  $matches = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -ieq 'node.exe' -and $_.CommandLine -match '(?i)fugle-websocket-collector\.js'
  })
  $reaped = @()
  foreach ($match in $matches) {
    try {
      Stop-Process -Id $match.ProcessId -Force -ErrorAction Stop
      $reaped += [int]$match.ProcessId
    } catch {
      Write-Warning "collector_orphan_reap_failed pid=$($match.ProcessId): $($_.Exception.Message)"
    }
  }
  return $reaped
}

try {
  New-Item -ItemType Directory -Force -Path $logDir, $stateDir, $cacheDir | Out-Null
  Write-State -Status "starting" -Reason "supervisor_start"
  $mutex = New-Object System.Threading.Mutex($false, $mutexName)
  try {
    $acquired = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    # Windows grants ownership of an abandoned mutex to this process.
    $acquired = $true
    Write-State -Status "starting" -Reason "supervisor_abandoned_mutex_recovered"
  }
  if (-not $acquired) {
    Write-State -Status "duplicate_blocked" -Reason "supervisor_mutex_held"
    exit 0
  }
  $reapedOrphans = @(Stop-OrphanCollectorProcesses)
  if ($reapedOrphans.Count -gt 0) {
    Write-State -Status "starting" -Reason ("orphan_collector_reaped:" + ($reapedOrphans -join ','))
  }
  if (-not (Test-Path -LiteralPath $collector)) { Write-State -Status "blocked" -Reason "collector_script_missing"; exit 1 }
  if (-not (Test-Path -LiteralPath $node)) { Write-State -Status "blocked" -Reason "node_missing"; exit 1 }

  $env:FUMAN_RUNTIME_DIR = $RuntimeDir
  $env:FUGLE_COLLECTOR_ROLE = "daytrade"
  $env:FUMAN_DAYTRADE_SOURCE_ROLE = "writer"
  $env:FUMAN_DAYTRADE_SOURCE_HOST_ID = if ($env:FUMAN_DAYTRADE_SOURCE_HOST_ID) { $env:FUMAN_DAYTRADE_SOURCE_HOST_ID } else { $env:COMPUTERNAME }
  $env:FUMAN_DAYTRADE_WRITER_INSTANCE_ID = if ($env:FUMAN_DAYTRADE_WRITER_INSTANCE_ID) { $env:FUMAN_DAYTRADE_WRITER_INSTANCE_ID } else { "$($env:FUMAN_DAYTRADE_SOURCE_HOST_ID):daytrade-writer" }
  $env:FUGLE_DAYTRADE_PRIORITY_SYMBOLS_FILE = Join-Path $cacheDir "fugle-daytrade-ws-priority-symbols.json"
  $env:FUGLE_WS_PRIORITY_SYMBOLS_FILE = $env:FUGLE_DAYTRADE_PRIORITY_SYMBOLS_FILE
  $env:FUGLE_WS_SYMBOLS_FILE = Join-Path $cacheDir "fugle-daytrade-ws-symbols.json"
  $env:FUGLE_WS_QUOTES_FILE = Join-Path $cacheDir "fugle-daytrade-ws-quotes-v2.json"
  $env:FUGLE_WS_CANDLES_FILE = Join-Path $cacheDir "fugle-daytrade-ws-candles-v2.json"
  $env:FUGLE_WS_STATUS_FILE = Join-Path $stateDir "fugle-daytrade-websocket-status-v2.json"
  $env:FUGLE_STREAMING_CHANNELS = "trades,aggregates,candles"
  $env:FUGLE_STREAMING_MAX_TOTAL_SUBSCRIPTIONS = "1800"
  $env:FUGLE_STREAMING_MAX_SYMBOLS = "2000"
  # Dynamic Mother Pool: do not keep a legacy fixed TOP40 pin.
  # The total subscription cap remains the only capacity bound.
  # Reserve the 1,800-channel budget for the Strategy3 formal candle minimum: 400 priority symbols on all channels plus 600 additional candle symbols = 1,000 candles.
  $env:FUGLE_STREAMING_PINNED_PRIORITY_SYMBOLS = "400"
  $env:FUGLE_STREAMING_CANDLE_SYMBOLS = "1000"
  $env:FUGLE_STREAMING_RESUBSCRIBE_MS = "0"
  $env:FUGLE_STREAMING_RECONNECT_INITIAL_MS = "1000"
  $env:FUGLE_STREAMING_RECONNECT_MAX_MS = "30000"
  $env:FUGLE_STREAMING_STALE_RECONNECT_MS = "120000"
  $env:FUGLE_STREAMING_SUBSCRIBE_PACE_MS = "50"
  $env:FUGLE_STREAMING_PRIORITY_TRADE_BOOTSTRAP_SYMBOLS = "160"
  $env:FUGLE_COLLECTOR_MODE = "streaming"
  $env:FUGLE_COLLECTOR_FINMIND_RECOVERY_ENABLED = "0"
  $SourceHostId = if ($env:FUMAN_DAYTRADE_SOURCE_HOST_ID) { [string]$env:FUMAN_DAYTRADE_SOURCE_HOST_ID } else { [string]$env:COMPUTERNAME }
  $HostApprovalFile = Join-Path $RuntimeDir "config\daytrade-source-host-approval.json"
  if (-not (Test-Path -LiteralPath $HostApprovalFile)) {
    Write-State -Status "blocked" -Reason "daytrade_source_host_approval_missing"
    exit 1
  }
  try {
    $approval = Get-Content -LiteralPath $HostApprovalFile -Raw | ConvertFrom-Json
  } catch {
    Write-State -Status "blocked" -Reason "daytrade_source_host_approval_invalid"
    exit 1
  }
  if ($approval.approved -ne $true -or [string]$approval.sourceRole -ne "writer" -or [string]$approval.hostId -ne $SourceHostId) {
    Write-State -Status "blocked" -Reason "daytrade_source_host_not_approved"
    exit 1
  }

  $backoff = 1
  while ($true) {
    $now = Get-TaipeiNow
    if ($now.DayOfWeek -in @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday) -or $now.TimeOfDay -ge [TimeSpan]::Parse("14:05")) {
      Write-State -Status "stopped_off_session" -Reason "collector_window_closed"
      exit 0
    }

    $stamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMddHHmmss")
    $stdout = Join-Path $logDir "fugle-daytrade-websocket-$stamp.stdout.log"
    $stderr = Join-Path $logDir "fugle-daytrade-websocket-$stamp.stderr.log"
    Write-State -Status "starting" -Reason "collector_start" -BackoffSeconds $backoff
    $process = Start-Process -FilePath $node -ArgumentList @("--use-system-ca", $collector, "--daytrade-source") -WorkingDirectory (Split-Path -Parent $collector) -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

    $collectorProcess = $process
    Write-State -Status "running" -ProcessId $process.Id -Reason "collector_running" -BackoffSeconds $backoff
    $stopForWindow = $false
    while ($true) {
      $now = Get-TaipeiNow
      if ($now.DayOfWeek -in @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday) -or $now.TimeOfDay -ge [TimeSpan]::Parse("14:05")) {
        $stopForWindow = $true
        try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {}
        break
      }
      $process.Refresh()
      if ($process.HasExited) { break }
      # Restart a wedged child when the WebSocket stops refreshing its status.
      $processAgeSeconds = [Math]::Max(0, [int](([DateTimeOffset]::Now - $process.StartTime).TotalSeconds))
      $statusAgeSeconds = Get-WebSocketStatusAgeSeconds
      if ($processAgeSeconds -ge 120 -and $statusAgeSeconds -ge 90) {
        Write-State -Status "restarting" -ProcessId $process.Id -Reason "websocket_status_stale_${statusAgeSeconds}s" -BackoffSeconds $backoff
        try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {}
        break
      }
      Start-Sleep -Seconds 5
    }
    if ($stopForWindow) {
      Write-State -Status "stopped_off_session" -ProcessId 0 -Reason "collector_window_closed" -BackoffSeconds 0
      exit 0
    }
    if ($process.ExitCode -eq 0) { $reason = "collector_exit_0" } else { $reason = "collector_exit_$($process.ExitCode)" }
    Write-State -Status "restarting" -ProcessId $process.Id -Reason $reason -BackoffSeconds $backoff
    Start-Sleep -Seconds $backoff
    $backoff = [Math]::Min(30, $backoff * 2)
  }
} catch {
  Write-State -Status "failed" -Reason ($_.Exception.Message)
  exit 1
} finally {
  if ($collectorProcess) {
    try { $collectorProcess.Refresh(); if (-not $collectorProcess.HasExited) { Stop-Process -Id $collectorProcess.Id -Force -ErrorAction SilentlyContinue } } catch {}
  }
  if ($acquired) { try { $mutex.ReleaseMutex() | Out-Null } catch {} }
  try { $mutex.Dispose() } catch {}
}