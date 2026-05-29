param(
  [switch]$IncludeMatchedSystemTasks,
  [switch]$OnlyErrors,
  [switch]$ExportCsv
)

$ErrorActionPreference = "Continue"

$keywords = "Fuman|雷達|策略|scan|radar|intraday|cache|flow|warrant|open|trade"
$exportPath = "C:\fuman-runtime\logs\fuman-schedule-status-latest.csv"

function Get-FumanTaskDescription($TaskName) {
  switch -Wildcard ($TaskName) {
    "Fuman GitHub 統一同步 0612" { return "早上 06:12 把 runtime 資料同步到 GitHub" }
    "Fuman GitHub 統一同步 0715" { return "早上 07:15 同步 GitHub" }
    "Fuman GitHub 統一同步 1445" { return "下午 14:45 同步 GitHub" }
    "Fuman GitHub 統一同步 2112" { return "晚上 21:12 同步 GitHub" }
    "Fuman PC Wake 0530" { return "Mini PC 早上 05:30 喚醒" }
    "Fuman PC Sleep 2200" { return "Mini PC 晚上 22:00 睡眠" }
    "Fuman Open Buy Cache 0700" { return "策略1「明日開盤入」早上 07:00 快取" }
    "Fuman Open Buy Cache 1600" { return "策略1「明日開盤入」下午 16:00 快取" }
    "Fuman Strategy2 Intraday Scan" { return "策略2 當沖雷達，08:58 啟動，09:00 後每 3 秒巡邏到 13:30" }
    "Fuman Strategy2 LINE Start 0900" { return "策略2 LINE 通知巡邏啟動" }
    "Fuman Strategy2 LINE Stop 1330" { return "策略2 LINE 通知停止" }
    "Fuman Strategy3 Cache 1300" { return "策略3 隔日沖，下午 13:00 快取" }
    "Fuman Strategy4 Cache 0700" { return "策略4 波段，早上 07:00 全台股掃描" }
    "Fuman Strategy4 Cache 1430" { return "策略4 波段，下午 14:30 全台股掃描" }
    "Fuman Strategy5 Cache 0600" { return "策略5 綜合策略，早上 06:00 快取" }
    "Fuman Strategy5 Cache 2100" { return "策略5 綜合策略，晚上 21:00 快取" }
    "Fuman Market Overview Patrol 0900" { return "市場總覽 / 熱力圖 / AI判讀，09:00 啟動巡邏到 13:30" }
    "Fuman Market Overview Patrol" { return "舊版市場總覽任務；目前停用，正式任務請看 Fuman Market Overview Patrol 0900" }
    "Fuman 即時雷達" { return "即時雷達，08:58 開盤前啟動" }
    "Fuman Trade Manager Patrol 0900" { return "管家巡邏，09:00 啟動" }
    "Fuman Trade Manager Settlement 1340" { return "管家結算，13:40 執行" }
    "Fuman Scorecard Initial 1410" { return "成績單含輔滿回測初版，14:10 產生" }
    "Fuman Scorecard Final 1530" { return "成績單含輔滿回測終版，15:30 產生" }
    "Fuman 買賣超 Cache 0600" { return "買賣超資料，早上 06:00 快取" }
    "Fuman 買賣超 Cache 2102" { return "買賣超資料，晚上 21:02 快取" }
    "Fuman 權證走向 Cache 0600" { return "權證資金走向，早上 06:00 快取" }
    "Fuman 權證走向 Cache 2100" { return "權證資金走向，晚上 21:00 快取" }
    default { return "" }
  }
}

function Get-TaskResultText($Code, $State) {
  if ($State -eq "Disabled") { return "$Code，已停用" }
  switch ($Code) {
    0 { return "成功 0" }
    267009 { return "$Code，執行中" }
    267011 { return "$Code，尚未正式跑過或等待中" }
    3221225786 { return "$Code，程式啟動失敗，常見為缺少 DLL 或執行環境錯誤" }
    default { return "錯誤 $Code" }
  }
}

function Format-DateTimeText($Value) {
  if (!$Value) { return "" }
  if ($Value.Year -le 2000) { return $Value.ToString("yyyy/MM/dd HH:mm:ss") }
  return $Value.ToString("yyyy/MM/dd HH:mm:ss")
}

function Get-TriggerText($Triggers) {
  if (!$Triggers) { return "" }
  $items = @()
  foreach ($trigger in $Triggers) {
    $text = $trigger.StartBoundary
    if ($trigger.Enabled -eq $false) { $text = "$text（停用）" }
    if ($trigger.Repetition -and $trigger.Repetition.Interval) {
      $text = "$text；重複 $($trigger.Repetition.Interval)"
    }
    $items += $text
  }
  return ($items -join " | ")
}

function Get-ActionText($Actions) {
  if (!$Actions) { return "" }
  $items = @()
  foreach ($action in $Actions) {
    $items += (($action.Execute + " " + $action.Arguments).Trim())
  }
  return ($items -join " | ")
}

function Get-ScheduleRows {
  $tasks = Get-ScheduledTask | Where-Object {
    if ($IncludeMatchedSystemTasks) {
      $_.TaskName -match $keywords
    } else {
      $_.TaskName -like "Fuman*"
    }
  }

  foreach ($task in $tasks) {
    $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath
    $resultText = Get-TaskResultText $info.LastTaskResult $task.State
    $isError = ($task.State -ne "Disabled" -and $info.LastTaskResult -notin @(0, 267009, 267011))
    if ($OnlyErrors -and !$isError) { continue }

    [pscustomobject]@{
      排程 = $task.TaskName
      中文說明 = Get-FumanTaskDescription $task.TaskName
      狀態 = [string]$task.State
      上次執行 = Format-DateTimeText $info.LastRunTime
      下次執行 = Format-DateTimeText $info.NextRunTime
      上次結果 = $resultText
      原始結果碼 = $info.LastTaskResult
      錯過次數 = $info.NumberOfMissedRuns
      工作路徑 = $task.TaskPath
      觸發器 = Get-TriggerText $task.Triggers
      執行指令 = Get-ActionText $task.Actions
    }
  }
}

Write-Host ""
Write-Host "富滿終端完整排程檢查" -ForegroundColor Green
Write-Host "查詢時間：$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')" -ForegroundColor DarkGray
if ($IncludeMatchedSystemTasks) {
  Write-Host "範圍：Fuman + 關鍵字命中的系統任務" -ForegroundColor Yellow
} else {
  Write-Host "範圍：只顯示 Fuman 開頭任務" -ForegroundColor Yellow
}

$rows = @(Get-ScheduleRows | Sort-Object 排程)

Write-Host ""
Write-Host "==== 摘要表 ====" -ForegroundColor Cyan
$rows |
  Select-Object 排程, 中文說明, 狀態, 上次執行, 下次執行, 上次結果, 錯過次數 |
  Format-Table -AutoSize -Wrap

Write-Host ""
Write-Host "==== 詳細表：觸發器與執行指令 ====" -ForegroundColor Cyan
$rows |
  Select-Object 排程, 觸發器, 執行指令 |
  Format-List

Write-Host ""
Write-Host "==== 異常提醒 ====" -ForegroundColor Cyan
$errors = @($rows | Where-Object { $_.狀態 -ne "Disabled" -and $_.原始結果碼 -notin @(0, 267009, 267011) })
$disabled = @($rows | Where-Object { $_.狀態 -eq "Disabled" })
$missed = @($rows | Where-Object { $_.錯過次數 -gt 0 })

if ($errors.Count -eq 0 -and $disabled.Count -eq 0 -and $missed.Count -eq 0) {
  Write-Host "目前沒有錯誤、停用或錯過次數。" -ForegroundColor Green
} else {
  if ($errors.Count -gt 0) {
    Write-Host "錯誤任務：" -ForegroundColor Red
    $errors | Select-Object 排程, 上次結果, 上次執行, 下次執行 | Format-Table -AutoSize -Wrap
  }
  if ($disabled.Count -gt 0) {
    Write-Host "停用任務：" -ForegroundColor Yellow
    $disabled | Select-Object 排程, 中文說明, 上次結果 | Format-Table -AutoSize -Wrap
  }
  if ($missed.Count -gt 0) {
    Write-Host "有錯過次數的任務：" -ForegroundColor Yellow
    $missed | Select-Object 排程, 錯過次數, 上次執行, 下次執行 | Format-Table -AutoSize -Wrap
  }
}

if ($ExportCsv) {
  $dir = Split-Path -Parent $exportPath
  if (!(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $rows | Export-Csv -LiteralPath $exportPath -NoTypeInformation -Encoding UTF8
  Write-Host ""
  Write-Host "已匯出 CSV：$exportPath" -ForegroundColor Green
}
