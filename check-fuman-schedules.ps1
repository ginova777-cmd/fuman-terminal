$ErrorActionPreference = "Continue"

$logDir = "C:\fuman-runtime\logs"
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
  "run-scorecard.ps1" = @{
    Log = "scorecard-*.log"
    Done = @("Scorecard end")
    Detail = @("Google Sheet upload end", "Scorecard end")
  }
  "run-scorecard-final.ps1" = @{
    Log = "scorecard-*.log"
    Done = @("Scorecard end")
    Detail = @("REPORT_SLOT=final", "Google Sheet upload end", "Scorecard end")
  }
  "run-scorecard-initial.ps1" = @{
    Log = "scorecard-*.log"
    Done = @("Scorecard end")
    Detail = @("REPORT_SLOT=initial", "Google Sheet upload end", "Scorecard end")
  }
  "run-strategy2-intraday.ps1" = @{
    Log = "strategy2-intraday-*.log"
    Done = @("Strategy2 intraday patrol end")
    Detail = @("Strategy2 intraday patrol end")
  }
  "run-strategy2-line.ps1" = @{
    Log = "strategy2-line-*.log"
    Done = @("Strategy2 LINE")
    Detail = @("sent", "skip", "Strategy2 LINE")
  }
  "run-strategy3.ps1" = @{
    Log = "strategy3-*.log"
    Done = @("Strategy3 scan end")
    Detail = @("Strategy3 scan end")
  }
  "run-strategy4.ps1" = @{
    Log = "strategy4-*.log"
    Done = @("Strategy4 full scan end", "Strategy4 clean cache sync end")
    Detail = @("Strategy4 full scan end", "Strategy4 clean cache sync end")
  }
  "run-strategy5.ps1" = @{
    Log = "strategy5-*.log"
    Done = @("Strategy5 scan end")
    Detail = @("Strategy5 scan end")
  }
  "run-trade-manager-patrol.ps1" = @{
    Log = "trade-manager-patrol-*.log"
    Done = @("Trade manager patrol end", "trading window closed")
    Detail = @("sent \d+ message", "no new action", "trading window closed")
  }
  "run-trade-manager-report.ps1" = @{
    Log = "trade-manager-report-*.log"
    Done = @("Trade manager settlement report end", "Trade manager Google Sheet upload end")
    Detail = @("email report sent", "Google Sheet upload end", "Uploaded trade manager scorecard only")
  }
  "run-realtime-radar.ps1" = @{
    Log = "realtime-radar-*.log"
    Done = @("Realtime radar cache end")
    Detail = @("Realtime radar cache end")
  }
  "run-market-overview.ps1" = @{
    Log = "market-overview-*.log"
    Done = @("Market overview patrol end")
    Detail = @("Market overview patrol end")
  }
  "stop-strategy2-line.ps1" = @{
    Log = "strategy2-line-*.log"
    Done = @("Strategy2 LINE", "stop", "stopped")
    Detail = @("stop", "stopped", "Strategy2 LINE")
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

function Convert-StatusText($status) {
  switch ($status) {
    "OK" { "正常" }
    "LOG-CHECK" { "需看紀錄" }
    "LOG-ERROR" { "紀錄有錯" }
    "TASK-FAIL" { "排程失敗" }
    "OK-NO-PS1" { "非PS任務" }
    "OK-NO-RULE" { "未定規則" }
    default { $status }
  }
}

function Convert-TaskText($taskName) {
  $text = $taskName
  $text = $text -replace "Fuman GitHub 統一同步", "GitHub同步"
  $text = $text -replace "Fuman Open Buy Cache", "策略1掃描"
  $text = $text -replace "Fuman Scorecard Final", "盤後成績單"
  $text = $text -replace "Fuman Scorecard Initial", "初版成績單"
  $text = $text -replace "Fuman Strategy2 Intraday Scan", "策略2盤中掃描"
  $text = $text -replace "Fuman Strategy2 LINE Start", "策略2 LINE啟動"
  $text = $text -replace "Fuman Strategy2 LINE Stop", "策略2 LINE停止"
  $text = $text -replace "Fuman Strategy3 Cache", "策略3掃描"
  $text = $text -replace "Fuman Strategy4 Cache", "策略4掃描"
  $text = $text -replace "Fuman Strategy5 Cache", "策略5掃描"
  $text = $text -replace "Fuman Trade Manager Patrol", "交易管家巡邏"
  $text = $text -replace "Fuman Trade Manager Settlement", "交易管家結算"
  $text = $text -replace "Fuman Market Overview Patrol", "市場總覽巡邏"
  $text = $text -replace "Fuman PC Sleep", "電腦睡眠"
  $text = $text -replace "Fuman PC Wake", "電腦喚醒"
  $text = $text -replace "Fuman 即時雷達", "即時雷達"
  $text = $text -replace "Fuman 買賣超 Cache", "買賣超掃描"
  $text = $text -replace "Fuman 權證走向 Cache", "權證走向掃描"
  return $text
}

function Convert-ResultText($result) {
  if ($result -eq 0) { return "成功" }
  if ($result -eq 267011) { return "尚未跑/停用" }
  return "錯誤碼 $result"
}

function Get-ScriptNameFromAction($task) {
  $text = (($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join " ")
  $match = [regex]::Match($text, "C:\\fuman-terminal\\([^""\s]+\.ps1)")
  if ($match.Success) { return $match.Groups[1].Value }
  return ""
}

function Read-LogText($path) {
  if (-not $path -or -not (Test-Path $path)) { return "" }
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
  foreach ($pattern in $patterns) {
    if ($text -match $pattern) { return $true }
  }
  return $false
}

function Get-Detail($text, $patterns) {
  foreach ($pattern in $patterns) {
    $match = [regex]::Match($text, $pattern)
    if ($match.Success) { return $match.Value }
  }
  return ""
}

function Test-FailureText($text) {
  if (-not $text) { return $false }
  return $text -match "(?i)(failed with exit code|Error:|exited: 1|UNABLE_TO_VERIFY|fetch failed|This operation was aborted)"
}

if (-not (Test-Path $logDir)) {
  Write-Host "Missing log directory: $logDir"
  exit 1
}

$rows = foreach ($task in (Get-ScheduledTask | Where-Object { $_.TaskName -like $taskNameFilter } | Sort-Object TaskName)) {
  $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath
  $script = Get-ScriptNameFromAction $task
  $rule = if ($script -and $rules.ContainsKey($script)) { $rules[$script] } else { $null }
  $latestLog = $null
  $logOk = $null
  $detail = ""

  if ($rule) {
    $latestLog = Get-ChildItem -LiteralPath $logDir -Filter $rule.Log -File -ErrorAction SilentlyContinue |
      Where-Object { $info.LastRunTime -eq [datetime]"1999-11-30" -or $_.LastWriteTime -ge $info.LastRunTime.AddMinutes(-5) } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    $text = Read-LogText $latestLog.FullName
    $logOk = [bool]($latestLog -and (Test-AnyPattern $text $rule.Done))
    $logFailed = Test-FailureText $text
    $detail = Get-Detail $text $rule.Detail
  } else {
    $logFailed = $false
  }

  $taskOk = ($info.LastTaskResult -eq 0)
  $status = if (-not $script) {
    if ($taskOk) { "OK-NO-PS1" } else { "TASK-FAIL" }
  } elseif (-not $rule) {
    if ($taskOk) { "OK-NO-RULE" } else { "TASK-FAIL" }
  } elseif ($taskOk -and $logOk -and -not $logFailed) {
    "OK"
  } elseif ($logFailed) {
    "LOG-ERROR"
  } elseif (-not $taskOk) {
    "TASK-FAIL"
  } else {
    "LOG-CHECK"
  }

  [pscustomobject]@{
    Status = $status
    StatusText = Convert-StatusText $status
    TaskName = $task.TaskName
    TaskText = Convert-TaskText $task.TaskName
    Script = $script
    LastRun = $info.LastRunTime
    NextRun = $info.NextRunTime
    Result = $info.LastTaskResult
    ResultText = Convert-ResultText $info.LastTaskResult
    State = $task.State
    LatestLog = if ($latestLog) { $latestLog.Name } else { "" }
    LogTime = if ($latestLog) { $latestLog.LastWriteTime } else { $null }
    Detail = $detail
  }
}

$displayRows = $rows | Select-Object `
  @{Name="狀態"; Expression={$_.StatusText}},
  @{Name="排程"; Expression={$_.TaskText}},
  @{Name="腳本"; Expression={$_.Script}},
  @{Name="上次執行"; Expression={$_.LastRun}},
  @{Name="下次執行"; Expression={$_.NextRun}},
  @{Name="結果"; Expression={$_.ResultText}},
  @{Name="最新紀錄"; Expression={$_.LatestLog}},
  @{Name="重點"; Expression={$_.Detail}}

Write-Host ""
Write-Host "Fuman 排程檢查"
Write-Host "狀態說明：正常=成功跑完；需看紀錄=排程成功但完成字樣不明；紀錄有錯=log 內有錯誤；排程失敗=Windows 排程回報失敗。"
Write-Host ""
$displayRows | Format-Table -AutoSize

$bad = @($rows | Where-Object { $_.Status -notlike "OK*" })
if ($bad.Count) {
  Write-Host ""
  Write-Host "需要注意"
  $bad | Select-Object `
    @{Name="狀態"; Expression={$_.StatusText}},
    @{Name="排程"; Expression={$_.TaskText}},
    @{Name="腳本"; Expression={$_.Script}},
    @{Name="結果"; Expression={$_.ResultText}},
    @{Name="最新紀錄"; Expression={$_.LatestLog}},
    @{Name="重點"; Expression={$_.Detail}} |
    Format-Table -AutoSize
  exit 1
}

Write-Host ""
Write-Host "所有可檢查的 Fuman 排程看起來正常。"
