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
    "Fuman Strategy3 Watchdog 1320" { return "策略3 watchdog，下午 13:20 檢查並補跑" }
    "Fuman Strategy4 Cache 1430" { return "策略4 波段，下午 14:30 全台股掃描" }
    "Fuman Strategy5 Cache 0600" { return "策略5 綜合策略與漲停十字星，早上 06:00 固定快取" }
    "Fuman Strategy5 Cache 2100" { return "策略5 綜合策略與漲停十字星，晚上 21:00 固定快取" }
    "Fuman Market Overview Patrol 0900" { return "市場總覽 / 熱力圖 / AI判讀，09:00 啟動巡邏到 13:30" }
    "Fuman Market Overview Patrol" { return "舊版市場總覽任務；目前停用，正式任務請看 Fuman Market Overview Patrol 0900" }
    "Fuman 即時雷達" { return "即時雷達，08:58 開盤前啟動" }
    "Fuman Trade Manager Patrol 0900" { return "管家巡邏，09:00 啟動" }
    "Fuman Trade Manager Settlement 1340" { return "管家結算，13:40 執行" }
    "Fuman Scorecard Initial 1410" { return "成績單含輔滿回測初版，14:10 產生" }
    "Fuman Scorecard Final 1530" { return "成績單含輔滿回測終版，15:30 產生" }
    "Fuman Daily Health Summary 1545" { return "綜合策略每日健康摘要，15:45 發送" }
    "Fuman Flow Cache 0600" { return "買賣超與權證走向，早上 06:00 合併掃描並發布終端" }
    "Fuman Flow Cache 2100" { return "買賣超與權證走向，晚上 21:00 合併掃描並發布終端" }
    "Fuman 買賣超 Cache 2100" { return "買賣超資料，晚上 21:00 快取並發布終端" }
    "Fuman 權證走向 Cache 0500" { return "權證資金走向，早上 05:00 快取並發布終端" }
    "Fuman 權證走向 Cache 2200" { return "權證資金走向，晚上 22:00 快取並發布終端" }
    "Fuman 買賣超 Cache 0600" { return "舊版買賣超單獨任務；預期停用，已由 Fuman Flow Cache 0600 接手" }
    "Fuman 買賣超 Cache 2102" { return "舊版買賣超單獨任務；預期停用，已由 Fuman Flow Cache 2100 接手" }
    "Fuman 權證走向 Cache 0600" { return "舊版權證走向單獨任務；預期停用，已由 Fuman Flow Cache 0600 接手" }
    "Fuman 權證走向 Cache 2100" { return "舊版權證走向單獨任務；預期停用，已由 Fuman Flow Cache 2100 接手" }
    default { return "" }
  }
}

function Get-ExpectedDisabledReason($TaskName) {
  switch -Wildcard ($TaskName) {
    "Fuman 買賣超 Cache 2100" { return "買賣超資料，晚上 21:00 快取並發布終端" }
    "Fuman 權證走向 Cache 0500" { return "權證資金走向，早上 05:00 快取並發布終端" }
    "Fuman 權證走向 Cache 2200" { return "權證資金走向，晚上 22:00 快取並發布終端" }
    "Fuman 買賣超 Cache 0600" { return "預期停用：已由 Fuman Flow Cache 0600 合併掃描取代" }
    "Fuman 買賣超 Cache 2102" { return "預期停用：已由 Fuman Flow Cache 2100 合併掃描取代" }
    "Fuman 權證走向 Cache 0600" { return "預期停用：已由 Fuman Flow Cache 0600 合併掃描取代" }
    "Fuman 權證走向 Cache 2100" { return "預期停用：已由 Fuman Flow Cache 2100 合併掃描取代" }
    "Fuman Market Overview Patrol" { return "預期停用：舊版任務，已由 Fuman Market Overview Patrol 0900 取代" }
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

function Get-LatestFumanLogIssue {
  param(
    [Parameter(Mandatory = $true)][string]$TaskName
  )

  $logDir = "C:\fuman-runtime\logs"
  if (-not (Test-Path -LiteralPath $logDir)) { return $null }

  $patterns = switch -Wildcard ($TaskName) {
    "*Strategy3*" { @("strategy3-*.log", "cache-sync-*.log") }
    "*Strategy4*" { @("strategy4-*.log", "cache-sync-*.log") }
    "*Scorecard*" { @("scorecard-*.log") }
    "*Daily Health Summary*" { @("daily-health-summary-*.log") }
    "*Trade Manager*" { @("trade-manager-*.log") }
    "*即時雷達*" { @("realtime-radar-*.log") }
    "*Strategy2 Intraday*" { @("strategy2-intraday-*.log") }
    default { @() }
  }
  if (-not $patterns.Count) { return $null }

  $latest = Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue |
    Where-Object {
      $name = $_.Name
      @($patterns | Where-Object { $name -like $_ }).Count -gt 0
    } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latest) { return $null }

  $tail = Get-Content -LiteralPath $latest.FullName -Tail 160 -ErrorAction SilentlyContinue
  $hasCleanFinish = @($tail | Where-Object {
    $_ -match '(?i)(patrol finished|finished): success \d+, failure 0'
  }).Count -gt 0
  $bad = @($tail | Where-Object {
    if ($_ -match '(?i)VERCEL_VISIBLE_WAIT') { return $false }
    if ($_ -match '(?i)(failed|failure)\s+0(/|\b)') { return $false }
    if ($hasCleanFinish -and $_ -match '(?i)(sma35 1m failed|realtime batch failed)') { return $false }
    $_ -match '(?i)(failed|threw|rejected|HTTP\s+[45]\d\d|exit code\s+[1-9]|error:|fatal:)'
  } | Select-Object -Last 3)
  if (-not $bad.Count) { return $null }

  $summary = (($bad -join " | ") -replace "\s+", " ").Trim()
  if ($summary -match '(?i)(could not resolve host|getaddrinfo|timed out|timeout|failed to connect|connection was reset|network is unreachable|cannot lock ref|remote rejected|failed to push some refs)') {
    return "$($latest.Name): 暫時網路/GitHub同步異常: $summary"
  }
  return "$($latest.Name): $summary"
}

function Get-CacheSyncOutboxStatus {
  $runtime = $env:FUMAN_RUNTIME_DIR
  if (-not $runtime) { $runtime = "C:\fuman-runtime" }
  $outboxRoot = Join-Path $runtime "outbox\cache-sync"
  if (-not (Test-Path -LiteralPath $outboxRoot)) {
    return [pscustomobject]@{
      狀態 = "OK"
      PendingCount = 0
      ScopeSummary = ""
      Oldest = ""
      Newest = ""
      路徑 = $outboxRoot
    }
  }
  $snapshots = @(Get-ChildItem -LiteralPath $outboxRoot -Directory -Recurse -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "manifest.json") })
  $scopeGroups = $snapshots | Group-Object { Split-Path $_.Parent.FullName -Leaf }
  [pscustomobject]@{
    狀態 = if ($snapshots.Count) { "WARN" } else { "OK" }
    PendingCount = $snapshots.Count
    ScopeSummary = (($scopeGroups | ForEach-Object { "$($_.Name):$($_.Count)" }) -join "; ")
    Oldest = ($snapshots | Sort-Object LastWriteTime | Select-Object -First 1).FullName
    Newest = ($snapshots | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
    路徑 = $outboxRoot
  }
}

function Get-GoogleSheetsTokenStatus {
  $runtime = $env:FUMAN_RUNTIME_DIR
  if (-not $runtime) { $runtime = "C:\fuman-runtime" }
  $secretDir = $env:GOOGLE_OAUTH_DIR
  if (-not $secretDir) { $secretDir = Join-Path $runtime "secrets" }
  $tokenPath = Join-Path $secretDir "google-sheets-token.json"
  $clientPath = $env:GOOGLE_OAUTH_CLIENT
  if (-not $clientPath) { $clientPath = Join-Path $secretDir "google-oauth-client.json" }

  $tokenExists = Test-Path -LiteralPath $tokenPath
  $clientExists = Test-Path -LiteralPath $clientPath
  $backups = @(Get-ChildItem -LiteralPath $secretDir -Filter "google-sheets-token.backup*.json" -File -ErrorAction SilentlyContinue)
  $token = $null
  if ($tokenExists) {
    try { $token = Get-Content -LiteralPath $tokenPath -Raw | ConvertFrom-Json -ErrorAction Stop } catch {}
  }

  $hasRefreshToken = [bool]($token -and $token.refresh_token)
  $hasAccessToken = [bool]($token -and $token.access_token)
  $ok = $tokenExists -and $clientExists -and $hasRefreshToken -and $backups.Count -gt 0
  $issues = @()
  if (-not $clientExists) { $issues += "missing oauth client" }
  if (-not $tokenExists) { $issues += "missing token" }
  if ($tokenExists -and -not $hasRefreshToken) { $issues += "token has no refresh_token" }
  if ($backups.Count -eq 0) { $issues += "no token backup" }

  [pscustomobject]@{
    狀態 = if ($ok) { "OK" } else { "WARN" }
    Token = $tokenPath
    OAuthClient = $clientPath
    HasAccessToken = $hasAccessToken
    HasRefreshToken = $hasRefreshToken
    BackupCount = $backups.Count
    最新備份 = ($backups | Sort-Object LastWriteTime -Descending | Select-Object -First 1).Name
    問題 = ($issues -join "; ")
  }
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
    $logIssue = Get-LatestFumanLogIssue -TaskName $task.TaskName
    if ($OnlyErrors -and !$isError) { continue }

    [pscustomobject]@{
      排程 = $task.TaskName
      中文說明 = Get-FumanTaskDescription $task.TaskName
      停用說明 = Get-ExpectedDisabledReason $task.TaskName
      狀態 = [string]$task.State
      上次執行 = Format-DateTimeText $info.LastRunTime
      下次執行 = Format-DateTimeText $info.NextRunTime
      上次結果 = $resultText
      原始結果碼 = $info.LastTaskResult
      錯過次數 = $info.NumberOfMissedRuns
      最新Log異常 = $logIssue
      工作路徑 = $task.TaskPath
      觸發器 = Get-TriggerText $task.Triggers
      執行指令 = Get-ActionText $task.Actions
    }
  }
}

function Write-RenderedObject {
  param(
    [Parameter(ValueFromPipeline = $true)]$InputObject,
    [scriptblock]$Renderer
  )
  begin { $items = @() }
  process { $items += $InputObject }
  end {
    if (-not $items.Count) { return }
    $text = (& $Renderer $items | Out-String -Width 240).TrimEnd()
    if ($text) { Write-Host $text }
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
  Write-RenderedObject -Renderer { param($items) $items | Select-Object 排程, 中文說明, 狀態, 上次執行, 下次執行, 上次結果, 錯過次數, 最新Log異常 | Format-Table -AutoSize -Wrap }

Write-Host ""
Write-Host "==== 詳細表：觸發器與執行指令 ====" -ForegroundColor Cyan
$rows |
  Write-RenderedObject -Renderer { param($items) $items | Select-Object 排程, 觸發器, 執行指令 | Format-List }

Write-Host ""
Write-Host "==== 異常提醒 ====" -ForegroundColor Cyan
$errors = @($rows | Where-Object { $_.狀態 -ne "Disabled" -and $_.原始結果碼 -notin @(0, 267009, 267011) })
$expectedDisabled = @($rows | Where-Object { $_.狀態 -eq "Disabled" -and $_.停用說明 })
$unexpectedDisabled = @($rows | Where-Object { $_.狀態 -eq "Disabled" -and -not $_.停用說明 })
$missed = @($rows | Where-Object { $_.錯過次數 -gt 0 })
$logIssues = @($rows | Where-Object { $_.最新Log異常 })

if ($errors.Count -eq 0 -and $unexpectedDisabled.Count -eq 0 -and $missed.Count -eq 0 -and $logIssues.Count -eq 0) {
  Write-Host "目前沒有錯誤、非預期停用或錯過次數。" -ForegroundColor Green
} else {
  if ($errors.Count -gt 0) {
    Write-Host "錯誤任務：" -ForegroundColor Red
    $errors | Write-RenderedObject -Renderer { param($items) $items | Select-Object 排程, 上次結果, 上次執行, 下次執行 | Format-Table -AutoSize -Wrap }
  }
  if ($unexpectedDisabled.Count -gt 0) {
    Write-Host "非預期停用任務：" -ForegroundColor Yellow
    $unexpectedDisabled | Write-RenderedObject -Renderer { param($items) $items | Select-Object 排程, 中文說明, 上次結果 | Format-Table -AutoSize -Wrap }
  }
  if ($missed.Count -gt 0) {
    Write-Host "有錯過次數的任務：" -ForegroundColor Yellow
    $missed | Write-RenderedObject -Renderer { param($items) $items | Select-Object 排程, 錯過次數, 上次執行, 下次執行 | Format-Table -AutoSize -Wrap }
  }
  if ($logIssues.Count -gt 0) {
    Write-Host "最新 log 疑似異常：" -ForegroundColor Red
    $logIssues | Write-RenderedObject -Renderer { param($items) $items | Select-Object 排程, 上次執行, 最新Log異常 | Format-Table -AutoSize -Wrap }
  }
}

if ($expectedDisabled.Count -gt 0) {
  Write-Host ""
  Write-Host "==== 預期停用任務 ====" -ForegroundColor Cyan
  $expectedDisabled | Write-RenderedObject -Renderer { param($items) $items | Select-Object 排程, 停用說明 | Format-Table -AutoSize -Wrap }
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

Write-Host ""
Write-Host "==== Google Sheet OAuth 檢查 ====" -ForegroundColor Cyan
$googleTokenStatus = Get-GoogleSheetsTokenStatus
$googleTokenStatus | Write-RenderedObject -Renderer { param($items) $items | Format-List }
if ($googleTokenStatus.狀態 -ne "OK") {
  Write-Host "Google Sheet OAuth 備援不完整：$($googleTokenStatus.問題)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==== Cache Sync Outbox 檢查 ====" -ForegroundColor Cyan
$outboxStatus = Get-CacheSyncOutboxStatus
$outboxStatus | Write-RenderedObject -Renderer { param($items) $items | Format-List }
if ($outboxStatus.狀態 -ne "OK") {
  Write-Host "仍有 cache sync outbox 待補送；下一次網路正常同步會優先補送。" -ForegroundColor Yellow
}
