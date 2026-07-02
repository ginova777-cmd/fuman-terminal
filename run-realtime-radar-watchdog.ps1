param(
  [string]$TaskName = "Fuman 即時雷達",
  [string]$ProductionUrl = "https://fuman-terminal.vercel.app",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$ActiveStart = "09:00",
  [string]$CriticalStart = "09:05",
  [string]$ActiveEnd = "13:30",
  [int]$MaxAgeSeconds = 180,
  [int]$RestartCooldownSeconds = 180,
  [int]$MinRows = 1000
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-realtime-radar-watchdog.ps1"
. "${PSScriptRoot}\schedule-guard.ps1"

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = $RuntimeDir
$env:FUMAN_DATA_DIR = Join-Path $RuntimeDir "data"
$env:FUMAN_STATE_DIR = Join-Path $RuntimeDir "state"
$env:FUMAN_CACHE_DIR = Join-Path $RuntimeDir "cache"

$logDir = Join-Path $RuntimeDir "logs"
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir, $env:FUMAN_STATE_DIR | Out-Null

$log = Join-Path $logDir ("realtime-radar-watchdog-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$statusFile = Join-Path $env:FUMAN_STATE_DIR "realtime-radar-watchdog-status.json"
$restartStateFile = Join-Path $env:FUMAN_STATE_DIR "realtime-radar-watchdog-restart-state.json"
$receiptFile = Join-Path $receiptDir "realtime-radar-watchdog.json"
$alertReceiptFile = Join-Path $receiptDir "realtime-radar-watchdog-alert.json"

function Write-WatchdogLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Write-JsonFile {
  param([string]$Path, $Payload)
  $Payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Convert-HHmmToTimeSpan {
  param([string]$Value)
  $parts = $Value.Split(":")
  return New-TimeSpan -Hours ([int]$parts[0]) -Minutes ([int]$parts[1])
}

function Test-InTimeWindow {
  param([string]$Start, [string]$End)
  $now = (Get-FumanTaipeiNow).TimeOfDay
  return ($now -ge (Convert-HHmmToTimeSpan $Start) -and $now -le (Convert-HHmmToTimeSpan $End))
}

function Test-AfterHHmm {
  param([string]$Value)
  return ((Get-FumanTaipeiNow).TimeOfDay -ge (Convert-HHmmToTimeSpan $Value))
}

function Get-TaipeiTimeFromValue {
  param($Value)
  if (-not $Value) { return $null }
  try {
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    $dto = [DateTimeOffset]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture)
    return [TimeZoneInfo]::ConvertTime($dto, $tz).DateTime
  } catch {
    try { return [datetime]$Value } catch { return $null }
  }
}

function Get-DateKeyFromValue {
  param($Value)
  $text = [string]$Value
  if ($text -match '^(\d{4})(\d{2})(\d{2})$') {
    return "$($matches[1])-$($matches[2])-$($matches[3])"
  }
  if ($text -match '^(\d{4})[-/](\d{2})[-/](\d{2})') {
    return "$($matches[1])-$($matches[2])-$($matches[3])"
  }
  return $text
}

function Get-TaskSnapshot {
  $snapshot = [ordered]@{
    taskName = $TaskName
    found = $false
    state = "missing"
    lastResult = $null
    lastResultHex = ""
    decodedLastResult = ""
    lastRunTime = ""
    nextRunTime = ""
  }
  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
    $snapshot.found = $true
    $snapshot.state = [string]$task.State
    $snapshot.lastResult = [int]$info.LastTaskResult
    if ($snapshot.lastResult -eq -1073741510) {
      $snapshot.lastResultHex = "0xC000013A"
      $snapshot.decodedLastResult = "STATUS_CONTROL_C_EXIT; external control/termination event"
    } elseif ($null -ne $snapshot.lastResult -and $snapshot.lastResult -ge 0) {
      $snapshot.lastResultHex = "0x{0:X8}" -f ([uint32]$snapshot.lastResult)
    } elseif ($null -ne $snapshot.lastResult) {
      $snapshot.lastResultHex = "negative-result"
    }
    $snapshot.lastRunTime = [string]$info.LastRunTime
    $snapshot.nextRunTime = [string]$info.NextRunTime
  } catch {
    $snapshot.decodedLastResult = $_.Exception.Message
  }
  return $snapshot
}

function Test-RealtimeRadarRunning {
  param($TaskSnapshot)
  if ($TaskSnapshot.found -and $TaskSnapshot.state -eq "Running") {
    return [ordered]@{ running = $true; pids = @(); source = "scheduled-task" }
  }
  $processes = @()
  try {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.CommandLine -match "run-realtime-radar\.ps1|patrol-realtime-radar-cache\.js|scan-realtime-radar-cache\.js" -and
        $_.CommandLine -notmatch "run-realtime-radar-watchdog\.ps1"
      })
  } catch {}
  return [ordered]@{
    running = ($processes.Count -gt 0)
    pids = @($processes | Select-Object -ExpandProperty ProcessId)
    source = "process-scan"
  }
}

function Get-RealtimeRadarPayload {
  $url = "$($ProductionUrl.TrimEnd('/'))/api/realtime-radar-latest?full=1&compact=1&shell=1&limit=1200&live=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45 -Headers @{ "Cache-Control" = "no-cache" }
    $payload = [string]$response.Content | ConvertFrom-Json -ErrorAction Stop
    $cacheControl = [string]$response.Headers["Cache-Control"]
    return [ordered]@{
      ok = $true
      url = $url
      cacheControl = $cacheControl
      payload = $payload
      error = ""
    }
  } catch {
    return [ordered]@{
      ok = $false
      url = $url
      cacheControl = ""
      payload = $null
      error = $_.Exception.Message
    }
  }
}

function Get-RowCount {
  param($Payload)
  foreach ($key in @("rows", "items", "matches", "signals", "data")) {
    if ($null -ne $Payload.$key) { return @($Payload.$key).Count }
  }
  if ($null -ne $Payload.totalCount) { return [int]$Payload.totalCount }
  if ($null -ne $Payload.count) { return [int]$Payload.count }
  return 0
}

function Test-RealtimeRadarHealthy {
  param($ApiResult, $TaskSnapshot, $Running)
  $now = Get-FumanTaipeiNow
  $today = $now.ToString("yyyy-MM-dd")
  $reasons = New-Object System.Collections.Generic.List[string]
  $summary = [ordered]@{
    apiOk = [bool]$ApiResult.ok
    taskRunning = [bool]$Running.running
    taskState = $TaskSnapshot.state
    taskLastResult = $TaskSnapshot.lastResult
    taskLastResultHex = $TaskSnapshot.lastResultHex
    decodedLastResult = $TaskSnapshot.decodedLastResult
    runId = ""
    date = ""
    tradeDate = ""
    updatedAt = ""
    updatedAtTaipei = ""
    ageSeconds = $null
    rows = 0
    totalCount = $null
    fallbackUsed = $null
    evidenceStatus = ""
    unattendedStatus = ""
    sourceSnapshotCapturedAt = ""
    staleQuoteCount = $null
    failedBatchCount = $null
  }

  if (-not $ApiResult.ok) {
    $reasons.Add("api_unreadable: $($ApiResult.error)") | Out-Null
  } else {
    $payload = $ApiResult.payload
    $summary.runId = [string]$payload.runId
    $summary.date = [string]$payload.date
    if ($payload.tradeDate) {
      $summary.tradeDate = Get-DateKeyFromValue $payload.tradeDate
    } elseif ($payload.date) {
      $summary.tradeDate = Get-DateKeyFromValue $payload.date
    }
    $summary.updatedAt = [string]$payload.updatedAt
    $summary.rows = Get-RowCount $payload
    if ($null -ne $payload.totalCount) { $summary.totalCount = [int]$payload.totalCount }
    if ($null -ne $payload.fallbackUsed) { $summary.fallbackUsed = [bool]$payload.fallbackUsed }
    $summary.evidenceStatus = [string]$payload.evidenceStatus
    $summary.unattendedStatus = [string]$payload.unattendedStatus
    $summary.sourceSnapshotCapturedAt = [string]$payload.source_snapshot_captured_at
    if ($null -ne $payload.staleQuoteCount) { $summary.staleQuoteCount = [int]$payload.staleQuoteCount }
    if ($null -ne $payload.failedBatchCount) { $summary.failedBatchCount = [int]$payload.failedBatchCount }
    $updatedAt = Get-TaipeiTimeFromValue $payload.updatedAt
    if ($updatedAt) {
      $summary.updatedAtTaipei = $updatedAt.ToString("yyyy-MM-dd HH:mm:ss")
      $summary.ageSeconds = [int]([math]::Max(0, ($now - $updatedAt).TotalSeconds))
    }
    $payloadDate = ""
    if ($payload.tradeDate) {
      $payloadDate = Get-DateKeyFromValue $payload.tradeDate
    } elseif ($payload.date) {
      $payloadDate = Get-DateKeyFromValue $payload.date
    }
    if (-not $summary.runId) { $reasons.Add("missing_runId") | Out-Null }
    if ($payloadDate -ne $today) { $reasons.Add("not_today: payloadDate=$payloadDate today=$today") | Out-Null }
    if (-not $updatedAt) { $reasons.Add("missing_or_invalid_updatedAt") | Out-Null }
    elseif ($summary.ageSeconds -gt $MaxAgeSeconds) { $reasons.Add("stale_api_age_seconds=$($summary.ageSeconds)") | Out-Null }
    if ($summary.rows -lt $MinRows) { $reasons.Add("rows_below_min: rows=$($summary.rows) min=$MinRows") | Out-Null }
    if ($payload.fallbackUsed -eq $true) { $reasons.Add("fallbackUsed=true") | Out-Null }
    if ($summary.evidenceStatus -and $summary.evidenceStatus -ne "complete") { $reasons.Add("evidenceStatus=$($summary.evidenceStatus)") | Out-Null }
    if ($summary.unattendedStatus -and $summary.unattendedStatus -ne "YES") { $reasons.Add("unattendedStatus=$($summary.unattendedStatus)") | Out-Null }
  }

  if (-not $Running.running) {
    $detail = "task_not_running_during_session state=$($TaskSnapshot.state)"
    if ($TaskSnapshot.lastResult -eq -1073741510) {
      $detail += " lastResult=-1073741510/0xC000013A external_control_exit"
    }
    $reasons.Add($detail) | Out-Null
  }

  return [ordered]@{
    healthy = ($reasons.Count -eq 0)
    reasons = @($reasons.ToArray())
    summary = $summary
  }
}

function Read-RestartState {
  try {
    if (Test-Path -LiteralPath $restartStateFile) {
      return Get-Content -LiteralPath $restartStateFile -Raw | ConvertFrom-Json
    }
  } catch {}
  return $null
}

function Test-RestartCooldown {
  $state = Read-RestartState
  if (-not $state -or -not $state.lastRestartAt) { return [ordered]@{ active = $false; remainingSeconds = 0 } }
  $last = Get-TaipeiTimeFromValue $state.lastRestartAt
  if (-not $last) { return [ordered]@{ active = $false; remainingSeconds = 0 } }
  $elapsed = [int]([math]::Max(0, ((Get-Date) - $last).TotalSeconds))
  $remaining = [int]([math]::Max(0, $RestartCooldownSeconds - $elapsed))
  return [ordered]@{ active = ($remaining -gt 0); remainingSeconds = $remaining; lastRestartAt = [string]$state.lastRestartAt }
}

function Invoke-RealtimeRadarAlert {
  param([string]$Reason, [string]$Action)
  $node = "C:\Program Files\nodejs\node.exe"
  if (-not (Test-Path -LiteralPath $node)) { $node = "node" }
  $tail = ""
  try { $tail = (Get-Content -LiteralPath $log -Tail 80 -ErrorAction SilentlyContinue) -join "`n" } catch {}
  $env:FUMAN_ALERT_KIND = "realtime-radar-watchdog"
  $env:FUMAN_ALERT_SOURCE = "Fuman Realtime Radar Watchdog"
  $env:FUMAN_ALERT_SUBJECT = "Fuman 即時雷達 watchdog 觸發"
  $env:FUMAN_ALERT_RECEIPT_FILE = $alertReceiptFile
  $env:FUMAN_ALERT_TEXT = @"
Fuman 即時雷達 watchdog 觸發

task: $TaskName
action: $Action
reason: $Reason
log: $log
receipt: $alertReceiptFile
checkedAt: $((Get-Date).ToUniversalTime().ToString("o"))

exit-code-note:
-1073741510 = 0xC000013A = STATUS_CONTROL_C_EXIT, means an external control/termination event rather than a scanner self-error.

tail:
$tail
"@
  try {
    & $node "--use-system-ca" "scripts\send-workflow-alert.js" "--kind=realtime-radar-watchdog" "--receipt=$alertReceiptFile" *>&1 |
      ForEach-Object { Write-WatchdogLog "[alert] $([string]$_)" }
  } catch {
    Write-WatchdogLog "[alert] EXCEPTION $($_.Exception.Message)"
  }
}

function Write-WatchdogResult {
  param([string]$Status, [string]$Action, [string[]]$Reasons, $Detail)
  $payload = [ordered]@{
    strategy = "realtime-radar"
    status = $Status
    action = $Action
    reasons = @($Reasons)
    checkedAt = (Get-Date).ToString("o")
    checkedAtTaipei = (Get-FumanTaipeiNow).ToString("yyyy-MM-dd HH:mm:ss")
    activeWindow = "$ActiveStart-$ActiveEnd"
    criticalStart = $CriticalStart
    maxAgeSeconds = $MaxAgeSeconds
    restartCooldownSeconds = $RestartCooldownSeconds
    log = $log
    alertReceiptFile = $alertReceiptFile
    detail = $Detail
  }
  Write-JsonFile $statusFile $payload
  Write-JsonFile $receiptFile $payload
}

Write-WatchdogLog "=== realtime radar watchdog start $(Get-Date) ==="
Invoke-FumanWeekdayGuard -Label "Realtime radar watchdog" -LogPath $log

$inActiveWindow = Test-InTimeWindow -Start $ActiveStart -End $ActiveEnd
if (-not $inActiveWindow) {
  $detail = [ordered]@{ nowTaipei = (Get-FumanTaipeiNow).ToString("yyyy-MM-dd HH:mm:ss") }
  Write-WatchdogLog "off-session; no restart. activeWindow=$ActiveStart-$ActiveEnd"
  Write-WatchdogResult -Status "off_session" -Action "none" -Reasons @("not_in_active_window") -Detail $detail
  exit 0
}

$taskSnapshot = Get-TaskSnapshot
$running = Test-RealtimeRadarRunning -TaskSnapshot $taskSnapshot
$apiResult = Get-RealtimeRadarPayload
$health = Test-RealtimeRadarHealthy -ApiResult $apiResult -TaskSnapshot $taskSnapshot -Running $running
$reasonText = ($health.reasons -join "; ")

if ($health.healthy) {
  Write-WatchdogLog "healthy; no action. runId=$($health.summary.runId) ageSeconds=$($health.summary.ageSeconds) rows=$($health.summary.rows)"
  Write-WatchdogResult -Status "ok" -Action "none" -Reasons @("healthy") -Detail ([ordered]@{ task = $taskSnapshot; running = $running; api = $health.summary })
  exit 0
}

Write-WatchdogLog "unhealthy: $reasonText"
$cooldown = Test-RestartCooldown
if ($running.running) {
  $action = "alert_only_already_running"
  Write-WatchdogLog "runner already running; no duplicate start. pid=$($running.pids -join ',')"
  if (Test-AfterHHmm $CriticalStart) {
    Invoke-RealtimeRadarAlert -Reason $reasonText -Action $action
  }
  Write-WatchdogResult -Status "degraded" -Action $action -Reasons $health.reasons -Detail ([ordered]@{ task = $taskSnapshot; running = $running; api = $health.summary; cooldown = $cooldown })
  exit 1
}

if ($cooldown.active) {
  $action = "cooldown_no_restart"
  Write-WatchdogLog "restart cooldown active remainingSeconds=$($cooldown.remainingSeconds)"
  if (Test-AfterHHmm $CriticalStart) {
    Invoke-RealtimeRadarAlert -Reason "$reasonText; restart cooldown remainingSeconds=$($cooldown.remainingSeconds)" -Action $action
  }
  Write-WatchdogResult -Status "degraded" -Action $action -Reasons $health.reasons -Detail ([ordered]@{ task = $taskSnapshot; running = $running; api = $health.summary; cooldown = $cooldown })
  exit 1
}

$restartExit = 1
try {
  Write-WatchdogLog "starting scheduled task: $TaskName"
  schtasks /Run /TN $TaskName *>&1 | ForEach-Object { Write-WatchdogLog "[schtasks] $([string]$_)" }
  $restartExit = $LASTEXITCODE
} catch {
  $restartExit = 1
  Write-WatchdogLog "start task exception: $($_.Exception.Message)"
}

$restartPayload = [ordered]@{
  lastRestartAt = (Get-Date).ToString("o")
  reason = $reasonText
  exitCode = $restartExit
  taskName = $TaskName
  source = "realtime-radar-watchdog"
}
Write-JsonFile $restartStateFile $restartPayload

$action = if ($restartExit -eq 0) { "restart_started" } else { "restart_failed" }
if (Test-AfterHHmm $CriticalStart) {
  Invoke-RealtimeRadarAlert -Reason "$reasonText; $action exitCode=$restartExit" -Action $action
}
Write-WatchdogResult -Status $(if ($restartExit -eq 0) { "self_healing" } else { "failed" }) -Action $action -Reasons $health.reasons -Detail ([ordered]@{ task = $taskSnapshot; running = $running; api = $health.summary; cooldown = $cooldown; restart = $restartPayload })
exit $restartExit
