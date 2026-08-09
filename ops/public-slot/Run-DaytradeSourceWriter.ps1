param(
  [string]$FumanRoot = "C:\fuman-terminal",
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
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
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
$MutexName = "Global\FumanFugleDaytradeSourceWriter"
$Mutex = New-Object System.Threading.Mutex($false, $MutexName)
$MutexAcquired = $false

function Write-WrapperLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $WrapperLog -Value $line -Encoding utf8
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
$DaytradePrioritySymbolsFile = Join-Path $RuntimeDir "cache\intraday\fugle-daytrade-ws-priority-symbols.json"
$env:FUGLE_COLLECTOR_ROLE = "daytrade"
$SourceHostId = if ($env:FUMAN_DAYTRADE_SOURCE_HOST_ID) { [string]$env:FUMAN_DAYTRADE_SOURCE_HOST_ID } else { [string]$env:COMPUTERNAME }
$env:FUMAN_DAYTRADE_SOURCE_ROLE = if ($Apply) { "writer" } else { "reader" }
$env:FUMAN_DAYTRADE_SOURCE_HOST_ID = $SourceHostId
$env:FUMAN_DAYTRADE_WRITER_INSTANCE_ID = if ($env:FUMAN_DAYTRADE_WRITER_INSTANCE_ID) { $env:FUMAN_DAYTRADE_WRITER_INSTANCE_ID } else { "$($SourceHostId):daytrade-writer" }
$env:FUMAN_DAYTRADE_WRITER_LEASE_REQUIRED = "1"
$env:FUGLE_DAYTRADE_PRIORITY_SYMBOLS_FILE = $DaytradePrioritySymbolsFile
$env:FUGLE_WS_PRIORITY_SYMBOLS_FILE = $DaytradePrioritySymbolsFile
$env:FUGLE_WS_SYMBOLS_FILE = Join-Path $RuntimeDir "cache\intraday\fugle-daytrade-ws-symbols.json"
$env:FUGLE_WS_QUOTES_FILE = Join-Path $RuntimeDir "cache\intraday\fugle-daytrade-ws-quotes.json"
$env:FUGLE_WS_CANDLES_FILE = Join-Path $RuntimeDir "cache\intraday\fugle-daytrade-ws-candles.json"
$env:FUGLE_WS_STATUS_FILE = Join-Path $RuntimeDir "state\fugle-daytrade-websocket-status.json"
$HostApprovalFile = Join-Path $RuntimeDir "config\daytrade-source-host-approval.json"

function Assert-DaytradeSourceHostApproval {
  if (-not $Apply) { return }
  if (-not (Test-Path -LiteralPath $HostApprovalFile)) {
    Write-FailureArtifact 9003 "daytrade_source_host_approval_missing"
    throw "Missing approved source host file: $HostApprovalFile"
  }
  try {
    $approval = Get-Content -LiteralPath $HostApprovalFile -Raw | ConvertFrom-Json
  } catch {
    Write-FailureArtifact 9003 "daytrade_source_host_approval_invalid"
    throw "Invalid source host approval file: $HostApprovalFile"
  }
  if ($approval.approved -ne $true -or [string]$approval.sourceRole -ne "writer" -or [string]$approval.hostId -ne $SourceHostId) {
    Write-FailureArtifact 9003 "daytrade_source_host_not_approved"
    throw "This computer is not the approved daytrade source writer host: $SourceHostId"
  }
}

# FUMAN_MARKET_CLOSED_RUNNER_GUARD_V1
. "$RepoRoot\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Daytrade source writer" -LogPath $WrapperLog

function Get-FugleWebSocketCollectorProcess {
  $collectorMarker = "fugle-websocket-collector.js"
  try {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
      $_.Name -match '^(node|nodejs)(\.exe)?$' -and
      [string]$_.CommandLine -match [regex]::Escape($collectorMarker) -and
      [string]$_.CommandLine -match "--daytrade-source"
    })
    if ($processes.Count -gt 0) { return $processes[0] }
  } catch {
    Write-WrapperLog "WARN unable to inspect websocket collector process: $($_.Exception.Message)"
  }
  return $null
}

function Ensure-FugleWebSocketCollector {
  $collector = Join-Path $RepoRoot "scripts\fugle-websocket-collector.js"
  $nodeExe = "C:\Program Files\nodejs\node.exe"
  if (-not (Test-Path -LiteralPath $collector)) {
    Write-WrapperLog "WARN websocket collector missing: $collector"
    return $false
  }
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    Write-WrapperLog "WARN node executable missing: $nodeExe"
    return $false
  }
  $existing = Get-FugleWebSocketCollectorProcess
  if ($null -ne $existing) {
    Write-WrapperLog "websocket collector already running pid=$($existing.ProcessId)"
    return $true
  }

  $env:FUGLE_STREAMING_CHANNELS = "trades,aggregates,candles"
  $env:FUGLE_STREAMING_MAX_TOTAL_SUBSCRIPTIONS = "1800"
  $process = Start-Process -FilePath $nodeExe `
    -ArgumentList @("--use-system-ca", $collector, "--daytrade-source") `
    -WorkingDirectory (Split-Path -Parent $collector) `
    -WindowStyle Hidden `
    -PassThru
  Start-Sleep -Milliseconds 500
  Write-WrapperLog "websocket collector started pid=$($process.Id) channels=$($env:FUGLE_STREAMING_CHANNELS) subscriptions=$($env:FUGLE_STREAMING_MAX_TOTAL_SUBSCRIPTIONS)"
  return $true
}

function Get-FugleFutoptWebSocketCollectorProcess {
  $collectorMarker = "fugle-futopt-websocket-collector.js"
  try {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
      $_.Name -match '^(node|nodejs)(\.exe)?$' -and
      [string]$_.CommandLine -match [regex]::Escape($collectorMarker)
    })
    if ($processes.Count -gt 0) { return $processes[0] }
  } catch {
    Write-WrapperLog "WARN unable to inspect futopt websocket collector process: $($_.Exception.Message)"
  }
  return $null
}
function Ensure-FugleFutoptWebSocketCollector {
  $collectorMutex = New-Object System.Threading.Mutex($false, "Global\FumanFugleDaytradeFutoptCollector")
  $collectorMutexAcquired = $false
  try {
    $collectorMutexAcquired = $collectorMutex.WaitOne(0)
    if (-not $collectorMutexAcquired) {
      Write-WrapperLog "futopt websocket collector start lock busy; defer to next writer tick"
      return $false
    }
  $collector = Join-Path $RepoRoot "scripts\fugle-futopt-websocket-collector.js"
  $nodeExe = "C:\Program Files\nodejs\node.exe"
  if (-not (Test-Path -LiteralPath $collector)) {
    Write-WrapperLog "WARN futopt websocket collector missing: $collector"
    return $false
  }
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    Write-WrapperLog "WARN node executable missing for futopt collector: $nodeExe"
    return $false
  }
  $existing = Get-FugleFutoptWebSocketCollectorProcess
  if ($null -ne $existing) {
    Write-WrapperLog "futopt websocket collector already running pid=$($existing.ProcessId)"
    return $true
  }

  $env:FUGLE_FUTOPT_STREAMING_CHANNELS = "trades,aggregates,candles"
  $env:FUGLE_FUTOPT_STREAMING_MAX_TOTAL_SUBSCRIPTIONS = "1800"
  $env:FUGLE_FUTOPT_STREAMING_MAX_SYMBOLS = "500"
  $process = Start-Process -FilePath $nodeExe `
    -ArgumentList @("--use-system-ca", $collector) `
    -WorkingDirectory (Split-Path -Parent $collector) `
    -WindowStyle Hidden `
    -PassThru
  Start-Sleep -Milliseconds 500
  Write-WrapperLog "futopt websocket collector started pid=$($process.Id) channels=$($env:FUGLE_FUTOPT_STREAMING_CHANNELS) subscriptions=$($env:FUGLE_FUTOPT_STREAMING_MAX_TOTAL_SUBSCRIPTIONS)"
  return $true
  } finally {
    if ($collectorMutexAcquired) {
      try { $collectorMutex.ReleaseMutex() | Out-Null } catch {}
    }
    try { $collectorMutex.Dispose() } catch {}
  }
}
if ($Apply) {
  Assert-DaytradeSourceHostApproval
  if (-not (Ensure-FugleWebSocketCollector)) {
    Write-WrapperLog "WARN websocket collector was not confirmed; writer remains fail-closed until formal WS status is ready"
  }
  if (-not (Ensure-FugleFutoptWebSocketCollector)) {
    Write-WrapperLog "WARN futopt websocket collector was not confirmed; writer remains fail-closed until formal futopt status is ready"
  }
} else {
  Write-WrapperLog "READ_ONLY mode: collector start skipped; no source writes allowed"
}

$node = "node"
$args = @("--use-system-ca", $WriterScript)

if ($LocalCheck) {
  $args += "--local-check"
} elseif ($Apply) {
  $args += "--apply"
  # The Windows task runs every minute. One bounded tick per task keeps the
  # mutex, wrapper timeout, and natural evidence cadence aligned. Explicit
  # -Continuous remains available for an approved long-running writer window.
  if ($Once -or -not $Continuous) {
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
try {
  $MutexAcquired = $Mutex.WaitOne(0)
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

  $timeoutSeconds = if ($Apply) { 330 } elseif ($Fetch) { 120 } else { 120 }
  $process = Start-Process -FilePath $node -ArgumentList $args -WindowStyle Hidden -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru
  if (-not $process.WaitForExit($timeoutSeconds * 1000)) {
    try { $process.Kill() } catch {}
    try { $process.WaitForExit(5000) } catch {}
    Write-FailureArtifact 9004 "writer_timeout_${timeoutSeconds}s"
    Write-WrapperLog "FAIL writer_timeout_${timeoutSeconds}s stdout=$StdoutLog stderr=$StderrLog"
    exit 1
  }
  $exitCode = [int]$process.ExitCode
  if ($exitCode -ne 0) {
    Write-FailureArtifact $exitCode "writer_exit_$exitCode"
    Write-WrapperLog "FAIL writer_exit_$exitCode stdout=$StdoutLog stderr=$StderrLog"
    exit $exitCode
  }
  # Keep historical logs, but remove the current failure pointer after a
  # successful tick so watchdogs do not read an obsolete timeout as live state.
  $failureArtifact = Join-Path $StateDir "daytrade-source-writer.failure.json"
  Remove-Item -LiteralPath $failureArtifact -Force -ErrorAction SilentlyContinue
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
}