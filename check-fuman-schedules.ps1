param(
  [switch]$IncludeDisabled,
  [switch]$StrictLogs,
  [string]$RegistryPath = ""
)

$ErrorActionPreference = "Continue"

$root = $PSScriptRoot
$logDir = if ($env:FUMAN_LOG_DIR) { $env:FUMAN_LOG_DIR } else { "C:\fuman-runtime\logs" }
if (-not $RegistryPath) {
  $RegistryPath = Join-Path $root "scripts\fuman-schedule-registry.json"
}

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

function Normalize-TaskName($Name) {
  $text = ([string]$Name).Trim()
  while ($text.StartsWith("\")) { $text = $text.Substring(1) }
  return $text
}

function Read-Registry {
  if (-not (Test-Path -LiteralPath $RegistryPath)) {
    throw "schedule registry not found: $RegistryPath"
  }
  return Get-Content -LiteralPath $RegistryPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
}

function Add-PolicyTask($Map, $Name, $ExpectedState, $Entry = $null) {
  $key = Normalize-TaskName $Name
  if (-not $key) { return }
  if (-not $Map.ContainsKey($key)) {
    $Map[$key] = @{
      ExpectedState = $ExpectedState
      ExpectedTriggers = @()
      Description = ""
      Time = ""
    }
  }
  if ($ExpectedState) { $Map[$key].ExpectedState = $ExpectedState }
  if ($Entry) {
    if ($Entry.description) { $Map[$key].Description = [string]$Entry.description }
    if ($Entry.time) { $Map[$key].Time = [string]$Entry.time }
    if ($Entry.expectedTriggers) { $Map[$key].ExpectedTriggers = @($Entry.expectedTriggers | ForEach-Object { [string]$_ }) }
  }
}

function Build-Policy($Registry) {
  $map = @{}
  foreach ($entry in @($Registry.tasks)) {
    $state = if ($entry.expectedState) { [string]$entry.expectedState } else { "" }
    Add-PolicyTask $map $entry.taskName $state $entry
  }
  foreach ($name in @($Registry.policy.activeTasks)) { Add-PolicyTask $map $name "Ready" }
  foreach ($name in @($Registry.policy.expectedDisabledTasks)) { Add-PolicyTask $map $name "Disabled" }

  $retired = @{}
  foreach ($name in @($Registry.policy.retiredTasks)) {
    $key = Normalize-TaskName $name
    if ($key) { $retired[$key] = $true }
  }

  $allowedResults = @{}
  if ($Registry.policy.allowedResults) {
    foreach ($prop in $Registry.policy.allowedResults.PSObject.Properties) {
      $allowedResults[(Normalize-TaskName $prop.Name)] = @($prop.Value | ForEach-Object { [int64]$_ })
    }
  }

  $coveredBy = @{}
  if ($Registry.policy.coveredBy) {
    foreach ($prop in $Registry.policy.coveredBy.PSObject.Properties) {
      $coveredBy[(Normalize-TaskName $prop.Name)] = $prop.Value
    }
  }

  $forbiddenTriggers = @{}
  if ($Registry.policy.forbiddenTriggers) {
    foreach ($prop in $Registry.policy.forbiddenTriggers.PSObject.Properties) {
      $forbiddenTriggers[(Normalize-TaskName $prop.Name)] = @($prop.Value | ForEach-Object { [string]$_ })
    }
  }

  $retiredPatterns = @($Registry.policy.retiredTaskNamePatterns | ForEach-Object { [string]$_ } | Where-Object { $_ })
  $severity = @{}
  if ($Registry.policy.alertSeverity) {
    foreach ($prop in $Registry.policy.alertSeverity.PSObject.Properties) {
      $severity[$prop.Name] = [string]$prop.Value
    }
  }

  return @{
    Tasks = $map
    Retired = $retired
    RetiredPatterns = $retiredPatterns
    AllowedResults = $allowedResults
    CoveredBy = $coveredBy
    ForbiddenTriggers = $forbiddenTriggers
    Severity = $severity
  }
}

function Get-ScriptNameFromAction($task) {
  $text = (($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join " ")
  $match = [regex]::Match($text, "(?i)(?:C:\\fuman-terminal\\)?([^""'\s\\]+\.ps1)")
  if ($match.Success) { return $match.Groups[1].Value }
  return ""
}

function Get-ActionText($task) {
  return (($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)".Trim() }) -join " | ")
}

function Get-TriggerTimes($task) {
  return @($task.Triggers | ForEach-Object {
    try { ([datetime]$_.StartBoundary).ToString("HH:mm") } catch { "" }
  } | Where-Object { $_ } | Sort-Object -Unique)
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

function Convert-ResultText($result) {
  switch ($result) {
    0 { return "0 success" }
    267009 { return "267009 running" }
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

function Test-CoveredByRule($rule, $lastRunTime) {
  if (-not $rule -or -not (Test-Path -LiteralPath $logDir)) { return $false }
  $patterns = @($rule.logPatterns | ForEach-Object { [string]$_ } | Where-Object { $_ })
  if ($patterns.Count -eq 0) { return $false }
  $logs = @(Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue |
    Where-Object {
      $name = $_.Name
      $matchesPattern = @($patterns | Where-Object { $name -like $_ }).Count -gt 0
      $afterRun = $lastRunTime -eq [datetime]"1999-11-30" -or $_.LastWriteTime -ge $lastRunTime.AddMinutes(-5)
      $matchesPattern -and $afterRun
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 5)
  foreach ($logFile in $logs) {
    $text = Read-LogText $logFile.FullName
    $success = $rule.successPattern -and $text -match [string]$rule.successPattern
    $failure = $rule.failurePattern -and $text -match [string]$rule.failurePattern
    if ($success -and -not $failure) { return $true }
  }
  return $false
}

function Get-Severity($Policy, $Status) {
  if ($Policy.Severity.ContainsKey($Status)) { return $Policy.Severity[$Status] }
  if ($Status -like "OK*") { return "none" }
  return "critical"
}

function Test-RetiredPattern($Policy, $TaskName) {
  foreach ($pattern in @($Policy.RetiredPatterns)) {
    if ($TaskName -match $pattern) { return $true }
  }
  return $false
}

function Test-ExpectedTriggers($Expected, $Actual) {
  $expectedSet = @($Expected | Sort-Object -Unique)
  if ($expectedSet.Count -eq 0) { return $true }
  $actualSet = @($Actual | Sort-Object -Unique)
  if ($expectedSet.Count -ne $actualSet.Count) { return $false }
  for ($i = 0; $i -lt $expectedSet.Count; $i++) {
    if ($expectedSet[$i] -ne $actualSet[$i]) { return $false }
  }
  return $true
}

try {
  $registry = Read-Registry
  $policy = Build-Policy $registry
} catch {
  Write-Host "Fuman schedule check failed to load registry: $($_.Exception.Message)"
  exit 1
}

if (-not (Test-Path -LiteralPath $logDir)) {
  Write-Host "Missing log directory: $logDir"
  exit 1
}

$scheduledTasks = @(Get-ScheduledTask | Where-Object { $_.TaskName -like "Fuman*" })
$present = @{}
foreach ($task in $scheduledTasks) {
  $present[(Normalize-TaskName $task.TaskName)] = $task
}

$rows = @()

foreach ($task in ($scheduledTasks | Sort-Object TaskName)) {
  $name = Normalize-TaskName $task.TaskName
  $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath
  $script = Get-ScriptNameFromAction $task
  $actionText = Get-ActionText $task
  $triggers = Get-TriggerTimes $task
  $rule = if ($script -and $rules.ContainsKey($script)) { $rules[$script] } else { $null }
  $latestLog = Get-LatestLog $rule $info.LastRunTime
  $logText = if ($latestLog) { Read-LogText $latestLog.FullName } else { "" }
  $logOk = if ($rule) { Test-AnyPattern $logText $rule.Done } else { $false }
  $logFailed = Test-FailureText $logText
  $detail = if ($rule) { Get-Detail $logText $rule.Detail } else { "" }
  $result = [int64]$info.LastTaskResult
  $state = [string]$task.State
  $entry = if ($policy.Tasks.ContainsKey($name)) { $policy.Tasks[$name] } else { $null }
  $expectedState = if ($entry) { [string]$entry.ExpectedState } else { "" }
  $allowed = if ($policy.AllowedResults.ContainsKey($name)) { @($policy.AllowedResults[$name]) } else { @(0) }
  $coveredRule = if ($policy.CoveredBy.ContainsKey($name)) { $policy.CoveredBy[$name] } else { $null }
  $covered = Test-CoveredByRule $coveredRule $info.LastRunTime
  $forbidden = if ($policy.ForbiddenTriggers.ContainsKey($name)) { @($policy.ForbiddenTriggers[$name]) } else { @() }
  $forbiddenHit = @($triggers | Where-Object { $forbidden -contains $_ })

  if ($covered -and -not $detail -and $coveredRule.detail) { $detail = [string]$coveredRule.detail }
  if (-not $detail -and $entry -and $entry.Description) { $detail = [string]$entry.Description }

  $status = "OK"
  if ($policy.Retired.ContainsKey($name) -or (Test-RetiredPattern $policy $name)) {
    $status = "RETIRED_PRESENT"
  } elseif (-not $entry) {
    $status = "UNKNOWN_REGISTRY"
  } elseif ($state -eq "Disabled" -and $expectedState -eq "Disabled") {
    $status = "DISABLED_EXPECTED"
  } elseif ($expectedState -eq "Disabled" -and $state -ne "Disabled") {
    $status = "STATE_MISMATCH"
  } elseif ($expectedState -ne "Disabled" -and $state -eq "Disabled") {
    $status = "STATE_MISMATCH"
  } elseif ($forbiddenHit.Count -gt 0) {
    $status = "FORBIDDEN_TRIGGER"
    $detail = "forbidden trigger present: $($forbiddenHit -join ', ')"
  } elseif (-not (Test-ExpectedTriggers $entry.ExpectedTriggers $triggers)) {
    $status = "TRIGGER_MISMATCH"
    $detail = "expected triggers $($entry.ExpectedTriggers -join ', '); actual $($triggers -join ', ')"
  } elseif ($result -eq 267009 -and ($allowed -contains 267009)) {
    $status = "OK_RUNNING"
  } elseif ($result -eq 267011 -and ($allowed -contains 267011)) {
    $status = "OK_WAITING"
  } elseif ($result -eq 267014 -and ($allowed -contains 267014) -and -not $logFailed) {
    $status = "OK_STOPPED"
  } elseif ($allowed -notcontains $result) {
    if ($covered) {
      $status = "OK_COVERED"
    } else {
      $status = "FAIL"
    }
  } elseif ($logFailed) {
    $status = "LOG_ERROR"
  } elseif ($StrictLogs -and $rule -and $rule.Log -and -not $logOk) {
    $status = "LOG_CHECK"
  }

  $severity = Get-Severity $policy $status
  $rows += [pscustomobject]@{
    Status = $status
    Severity = $severity
    TaskName = $task.TaskName
    Script = $script
    State = $state
    LastRun = $info.LastRunTime
    NextRun = $info.NextRunTime
    Result = Convert-ResultText $result
    Triggers = ($triggers -join ",")
    LatestLog = if ($latestLog) { $latestLog.Name } else { "" }
    Detail = $detail
    Action = $actionText
  }
}

foreach ($name in ($policy.Tasks.Keys | Sort-Object)) {
  $entry = $policy.Tasks[$name]
  if ($entry.ExpectedState -eq "Disabled") { continue }
  if (-not $present.ContainsKey($name)) {
    $rows += [pscustomobject]@{
      Status = "MISSING"
      Severity = Get-Severity $policy "MISSING"
      TaskName = $name
      Script = ""
      State = "Missing"
      LastRun = ""
      NextRun = ""
      Result = ""
      Triggers = ""
      LatestLog = ""
      Detail = "expected active task is missing"
      Action = ""
    }
  }
}

$displayRows = @($rows)
if (-not $IncludeDisabled) {
  $displayRows = @($displayRows | Where-Object { $_.State -ne "Disabled" -or $_.Severity -eq "critical" })
}

Write-Host ""
Write-Host "Fuman schedule check"
Write-Host "Registry: $RegistryPath"
Write-Host "Policy version: $($registry.policyVersion)"
Write-Host "Mode: canonical registry. Use -IncludeDisabled for expected disabled inventory; use -StrictLogs to require completion markers."
Write-Host ""
$displayRows | Sort-Object Severity, TaskName | Format-Table -AutoSize Status, Severity, TaskName, State, Result, Triggers, LatestLog, Detail

$critical = @($rows | Where-Object { $_.Severity -eq "critical" })
$warnings = @($rows | Where-Object { $_.Severity -eq "warning" })

if ($critical.Count) {
  Write-Host ""
  Write-Host "Action required"
  $critical | Sort-Object TaskName | Format-Table -AutoSize Status, Severity, TaskName, State, Result, Triggers, Detail
  exit 1
}

Write-Host ""
if ($warnings.Count) {
  Write-Host "Schedule check passed with warnings: $($warnings.Count)"
  $warnings | Sort-Object TaskName | Format-Table -AutoSize Status, Severity, TaskName, Result, Detail
} else {
  Write-Host "Schedule check passed: no canonical Fuman task blockers."
}
exit 0
