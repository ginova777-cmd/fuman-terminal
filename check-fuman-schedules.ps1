param(
  [switch]$IncludeDisabled,
  [switch]$StrictLogs
)

$ErrorActionPreference = "Continue"

$logDir = if ($env:FUMAN_LOG_DIR) { $env:FUMAN_LOG_DIR } else { "C:\fuman-runtime\logs" }
$taskNameFilter = "Fuman*"

$rules = @{
  "run-cache-sync.ps1" = @{
    Log = "cache-sync-*.log"
    Done = @("Cache sync end", "No cache changes to sync")
    Detail = @("Commit cache files", "Push cache commit", "No cache changes to sync")
  }
  "run-open-buy.ps1" = @{
    Log = "open-buy-*.log"
    Done = @("Open buy full scan end")
    Detail = @("full market scan", "scanned \d+/\d+", "matches \d+", "Open buy cache sync completed")
  }
  "run-star-preopen-watch.ps1" = @{
    Log = "strategy1-preopen-watch-*.log"
    Done = @("strategy1 preopen runner complete", "outside STAR preopen watch window; skip")
    Detail = @("strategy1 preopen runner complete", "outside STAR preopen watch window; skip", "controlled preopen refresh failure")
  }
  "run-strategy2-intraday.ps1" = @{
    Log = "strategy2-intraday-*.log"
    Done = @("Strategy2 intraday patrol end", "skip intraday scan outside market time")
    Detail = @("Strategy2 intraday patrol end", "skip intraday scan outside market time")
  }
  "run-strategy2-line.ps1" = @{
    Log = "strategy2-line-*.log"
    Done = @("Strategy2 LINE", "live alert skipped", "patrol skipped")
    Detail = @("sent", "skip", "skipped", "Strategy2 LINE")
  }
  "stop-strategy2-line.ps1" = @{
    Log = ""
    Done = @()
    Detail = @()
  }
  "run-strategy3.ps1" = @{
    Log = "strategy3-*.log"
    Done = @("Strategy3 scan end")
    Detail = @("Strategy3 scan end")
  }
  "run-strategy4.ps1" = @{
    Log = "strategy4-*.log"
    Done = @("Strategy4 full scan end", "Strategy4 clean cache sync end", "strategy4 cache updated")
    Detail = @("Strategy4 full scan end", "Strategy4 clean cache sync end", "strategy4 cache updated")
  }
  "run-strategy5.ps1" = @{
    Log = "strategy5-*.log"
    Done = @("Strategy5 scan end")
    Detail = @("Strategy5 scan end")
  }
  "run-strategy5-watchdog.ps1" = @{
    Log = "strategy5-watchdog-*.log"
    Done = @("strategy5 healthy", "strategy5 recovered")
    Detail = @("strategy5 healthy.*", "strategy5 recovered.*")
  }
  "run-realtime-radar.ps1" = @{
    Log = "realtime-radar-*.log"
    Done = @("Realtime radar cache end", "realtime radar skipped outside")
    Detail = @("Realtime radar cache end", "realtime radar skipped outside.*", "rows \d+ status ok")
  }
  "run-market-overview.ps1" = @{
    Log = "market-overview-*.log"
    Done = @("Market overview patrol end", "market overview skipped outside")
    Detail = @("Market overview patrol end", "market overview skipped outside.*")
  }
  "run-flow.ps1" = @{
    Log = "flow-*.log"
    Done = @("FLOW_PUBLISH_SUCCESS", "Flow and warrant scan end")
    Detail = @("FLOW_PUBLISH_SUCCESS", "institutionRows=\d+", "warrantMatches=\d+")
  }
  "run-flow-watchdog.ps1" = @{
    Log = "flow-watchdog-*.log"
    Done = @("Watchdog OK", "Watchdog rerun completed")
    Detail = @("Watchdog OK.*", "Watchdog rerun completed")
  }
  "run-institution.ps1" = @{
    Log = "institution-*.log"
    Done = @("Institution scan end")
    Detail = @("Institution scan end")
  }
  "run-warrant-flow.ps1" = @{
    Log = "warrant-flow-*.log"
    Done = @("Warrant flow scan end")
    Detail = @("Warrant flow scan end")
  }
}

function Get-ScriptNameFromAction($task) {
  $text = (($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join " ")
  $match = [regex]::Match($text, "C:\\fuman-terminal\\([^""\s]+\.ps1)")
  if ($match.Success) { return $match.Groups[1].Value }
  return ""
}

function Read-LogText($path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return "" }
  try {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $zeroOdd = 0
    for ($i = 1; $i -lt [Math]::Min($bytes.Length, 4000); $i += 2) {
      if ($bytes[$i] -eq 0) { $zeroOdd++ }
    }
    if ($zeroOdd -gt 200) {
      return ([System.Text.Encoding]::Unicode.GetString($bytes) -replace "`0", "")
    }
    return ([System.Text.Encoding]::UTF8.GetString($bytes) -replace "`0", "")
  } catch {
    try { return ((Get-Content -LiteralPath $path -Raw -ErrorAction Stop) -replace "`0", "") } catch { return "" }
  }
}

function Test-AnyPattern($text, $patterns) {
  foreach ($pattern in @($patterns)) {
    if ($pattern -and $text -match $pattern) { return $true }
  }
  return $false
}

function Get-Detail($text, $patterns) {
  foreach ($pattern in @($patterns)) {
    if (-not $pattern) { continue }
    $match = [regex]::Match($text, $pattern)
    if ($match.Success) { return $match.Value }
  }
  return ""
}

function Test-FailureText($text) {
  if (-not $text) { return $false }
  $clean = $text -replace "(?im)^.*failure\s+0(/\d+|\b).*$", ""
  return $clean -match "(?i)(failed with exit code|Error:|exited: 1|UNABLE_TO_VERIFY|fetch failed|This operation was aborted|fatal:|HTTP\s+[45]\d\d)"
}

function Test-AllowedStoppedResult($taskName, $scriptName, $result) {
  if ($result -ne 267014) { return $false }
  if ($scriptName -eq "run-realtime-radar.ps1") { return $true }
  if ($scriptName -eq "run-market-overview.ps1") { return $true }
  if ($taskName -like "*Realtime*") { return $true }
  if ($taskName -like "*Radar*") { return $true }
  if ($taskName -like "*Market Overview Patrol*") { return $true }
  return $false
}

function Test-LatestFreshnessGatePassed($taskName, $result, $lastRunTime) {
  if ($result -ne 267014) { return $false }
  if ($taskName -notlike "*Freshness Gate Full*") { return $false }
  if (-not (Test-Path -LiteralPath $logDir)) { return $false }
  $latest = Get-ChildItem -LiteralPath $logDir -Filter "live-freshness-gate-*.log" -File -ErrorAction SilentlyContinue |
    Where-Object { $lastRunTime -eq [datetime]"1999-11-30" -or $_.LastWriteTime -ge $lastRunTime } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latest) { return $false }
  $text = Read-LogText $latest.FullName
  return $text -match "SUCCESS live freshness gate passed"
}

function Test-LatestStrategy1PreopenCovered($taskName, $result, $lastRunTime) {
  if ($result -eq 0) { return $false }
  if ($taskName -notlike "*STAR Preopen Watch*") { return $false }
  if (-not (Test-Path -LiteralPath $logDir)) { return $false }
  $latest = Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.Name -like "strategy1-preopen-prepare-*.log" -or $_.Name -like "strategy1-preopen-final-*.log") -and
      ($lastRunTime -eq [datetime]"1999-11-30" -or $_.LastWriteTime -ge $lastRunTime)
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 5
  foreach ($logFile in @($latest)) {
    $text = Read-LogText $logFile.FullName
    if ($text -match "strategy1 preopen runner complete" -and $text -notmatch "strategy1 preopen runner failed") {
      return $true
    }
  }
  return $false
}

function Convert-ResultText($result) {
  switch ($result) {
    0 { return "0 success" }
    267011 { return "267011 waiting/not-run" }
    267014 { return "267014 stopped/window-ended" }
    3221225786 { return "3221225786 process-start-failed" }
    default { return "$result failure" }
  }
}

function Get-LatestLog($rule, $lastRunTime) {
  if (-not $rule -or -not $rule.Log) { return $null }
  if (-not (Test-Path -LiteralPath $logDir)) { return $null }
  return Get-ChildItem -LiteralPath $logDir -Filter $rule.Log -File -ErrorAction SilentlyContinue |
    Where-Object { $lastRunTime -eq [datetime]"1999-11-30" -or $_.LastWriteTime -ge $lastRunTime.AddMinutes(-5) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

if (-not (Test-Path -LiteralPath $logDir)) {
  Write-Host "Missing log directory: $logDir"
  exit 1
}

$taskQuery = Get-ScheduledTask | Where-Object { $_.TaskName -like $taskNameFilter }
if (-not $IncludeDisabled) {
  $taskQuery = $taskQuery | Where-Object { $_.State -ne "Disabled" }
}

$rows = foreach ($task in ($taskQuery | Sort-Object TaskName)) {
  $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath
  $script = Get-ScriptNameFromAction $task
  $rule = if ($script -and $rules.ContainsKey($script)) { $rules[$script] } else { $null }
  $latestLog = Get-LatestLog $rule $info.LastRunTime
  $logText = if ($latestLog) { Read-LogText $latestLog.FullName } else { "" }
  $logOk = if ($rule) { Test-AnyPattern $logText $rule.Done } else { $false }
  $logFailed = Test-FailureText $logText
  $detail = if ($rule) { Get-Detail $logText $rule.Detail } else { "" }
  $result = [int]$info.LastTaskResult
  $taskOk = $result -eq 0
  $taskWaiting = $result -eq 267011
  $taskStoppedOk = (Test-AllowedStoppedResult $task.TaskName $script $result) -and (-not $logFailed)
  $freshnessGateCovered = Test-LatestFreshnessGatePassed $task.TaskName $result $info.LastRunTime
  $preopenCovered = Test-LatestStrategy1PreopenCovered $task.TaskName $result $info.LastRunTime
  if ($preopenCovered -and -not $detail) {
    $detail = "covered by later strategy1 preopen prepare/final success"
  }

  $status = if ($task.State -eq "Disabled") {
    "DISABLED"
  } elseif ($taskWaiting) {
    "OK_WAITING"
  } elseif ($taskStoppedOk) {
    "OK_STOPPED"
  } elseif ($freshnessGateCovered) {
    "OK_COVERED"
  } elseif ($preopenCovered) {
    "OK_COVERED"
  } elseif (-not $taskOk) {
    "FAIL"
  } elseif ($logFailed) {
    "LOG_ERROR"
  } elseif ($StrictLogs -and $rule -and $rule.Log -and -not $logOk) {
    "LOG_CHECK"
  } else {
    "OK"
  }

  [pscustomobject]@{
    Status = $status
    TaskName = $task.TaskName
    Script = $script
    State = [string]$task.State
    LastRun = $info.LastRunTime
    NextRun = $info.NextRunTime
    Result = Convert-ResultText $result
    LatestLog = if ($latestLog) { $latestLog.Name } else { "" }
    Detail = $detail
  }
}

Write-Host ""
Write-Host "Fuman schedule check"
Write-Host "Mode: active tasks only. Use -IncludeDisabled for retired/disabled inventory; use -StrictLogs to require completion markers."
Write-Host ""
$rows | Format-Table -AutoSize

$bad = @($rows | Where-Object { $_.Status -in @("FAIL", "LOG_ERROR") })
if ($bad.Count) {
  Write-Host ""
  Write-Host "Action required"
  $bad | Format-Table -AutoSize
  exit 1
}

Write-Host ""
Write-Host "Schedule check passed: no active Fuman task blockers."
exit 0
