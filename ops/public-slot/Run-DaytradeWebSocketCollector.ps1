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
    websocketStatusFile = (Join-Path $stateDir "fugle-daytrade-websocket-status.json")
    maxCollectors = 1
  } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $statusFile -Encoding utf8
}

try {
  New-Item -ItemType Directory -Force -Path $logDir, $stateDir, $cacheDir | Out-Null
  Write-State -Status "starting" -Reason "supervisor_start"
  $mutex = New-Object System.Threading.Mutex($false, $mutexName)
  $acquired = $mutex.WaitOne(0)
  if (-not $acquired) {
    Write-State -Status "duplicate_blocked" -Reason "supervisor_mutex_held"
    exit 0
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
  $env:FUGLE_WS_QUOTES_FILE = Join-Path $cacheDir "fugle-daytrade-ws-quotes.json"
  $env:FUGLE_WS_CANDLES_FILE = Join-Path $cacheDir "fugle-daytrade-ws-candles.json"
  $env:FUGLE_WS_STATUS_FILE = Join-Path $stateDir "fugle-daytrade-websocket-status.json"
  $env:FUGLE_STREAMING_CHANNELS = "trades,aggregates,candles"
  $env:FUGLE_STREAMING_MAX_TOTAL_SUBSCRIPTIONS = "1800"
  $env:FUGLE_STREAMING_MAX_SYMBOLS = "600"
  $env:FUGLE_STREAMING_RECONNECT_INITIAL_MS = "1000"
  $env:FUGLE_STREAMING_RECONNECT_MAX_MS = "30000"
  $env:FUGLE_STREAMING_STALE_RECONNECT_MS = "120000"
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
    Write-State -Status "running" -ProcessId $process.Id -Reason "collector_running" -BackoffSeconds $backoff
    while ($true) {
      $process.Refresh()
      if ($process.HasExited) { break }
      Start-Sleep -Seconds 5
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
  if ($acquired) { try { $mutex.ReleaseMutex() | Out-Null } catch {} }
  try { $mutex.Dispose() } catch {}
}
