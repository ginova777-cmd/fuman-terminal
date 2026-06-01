param(
  [int]$FreshSeconds = 15
)

$ErrorActionPreference = "Continue"

$terminalRoot = "C:\fuman-terminal"
$syncRoot = "C:\fuman-terminal-sync"
$runtimeRoot = "C:\fuman-runtime"
$terminalJs = Join-Path $terminalRoot "terminal.js"
$syncTerminalJs = Join-Path $syncRoot "terminal.js"
$dataDirs = @(
  (Join-Path $runtimeRoot "data"),
  (Join-Path $terminalRoot "data"),
  (Join-Path $syncRoot "data")
)
$logDir = Join-Path $runtimeRoot "logs"

function Write-Section($Title) {
  Write-Host ""
  Write-Host "==== $Title ====" -ForegroundColor Cyan
}

function Convert-JsIntervalMs($Expression) {
  $text = [string]$Expression
  $compact = ($text -replace "\s", "")
  if ($compact -match "^(\d+)\*(\d+)$") {
    return ([int64]$Matches[1] * [int64]$Matches[2])
  }
  if ($compact -match "^(\d+)$") {
    return [int64]$Matches[1]
  }
  return $null
}

function Get-JsConstant($Content, $Name) {
  $pattern = "const\s+$([regex]::Escape($Name))\s*=\s*([^;]+);"
  $match = [regex]::Match($Content, $pattern)
  if (!$match.Success) { return $null }
  $expr = $match.Groups[1].Value.Trim()
  $ms = Convert-JsIntervalMs $expr
  [pscustomobject]@{
    Name = $Name
    Expression = $expr
    Milliseconds = $ms
    Seconds = if ($ms) { [math]::Round($ms / 1000, 2) } else { $null }
  }
}

function Test-Pattern($Content, $Pattern) {
  return [regex]::IsMatch($Content, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
}

function Show-FrontendPatrol($Path, $Label) {
  Write-Section "前端巡邏：$Label"
  if (!(Test-Path -LiteralPath $Path)) {
    Write-Host "找不到檔案：$Path" -ForegroundColor Red
    return
  }

  $content = Get-Content -LiteralPath $Path -Raw
  $constants = @(
    "MARKET_POLL_TICK_MS",
    "INTRADAY_FAST_SCAN_MS",
    "INTRADAY_BACKGROUND_SCAN_MS",
    "REALTIME_RADAR_REFRESH_MS",
    "MOBILE_INTRADAY_BACKGROUND_SCAN_MS"
  ) | ForEach-Object { Get-JsConstant $content $_ } | Where-Object { $_ }

  $constants | Format-Table `
    @{Label = "名稱"; Expression = { $_.Name } },
    @{Label = "設定值"; Expression = { $_.Expression } },
    @{Label = "秒數"; Expression = { $_.Seconds } } -AutoSize

  $checks = @(
    [pscustomobject]@{
      Check = "市場總覽使用 MARKET_POLL_TICK_MS"
      Passed = Test-Pattern $content "setInterval\(\(\)\s*=>\s*\{[^}]*loadMarketData\(\)[^}]*\},\s*MARKET_POLL_TICK_MS\)"
    }
    [pscustomobject]@{
      Check = "熱力圖使用 MARKET_POLL_TICK_MS"
      Passed = Test-Pattern $content "setInterval\(\(\)\s*=>\s*\{[^}]*loadHeatmap\(\)[^}]*\},\s*MARKET_POLL_TICK_MS\)"
    }
    [pscustomobject]@{
      Check = "AI 模式會觸發即時熱門巡邏"
      Passed = Test-Pattern $content "isViewActive\(`"market`"\).*marketMode\s*===\s*`"ai`".*refreshStrategyRealtimeScan\(`"hot`"\)"
    }
    [pscustomobject]@{
      Check = "AI 排名有套用即時報價 applyStrategyQuote"
      Passed = Test-Pattern $content "function\s+buildMarketAiData\(\)[\s\S]*?applyStrategyQuote\(stock\)"
    }
    [pscustomobject]@{
      Check = "AI 需要新鮮即時報價"
      Passed = Test-Pattern $content "function\s+isMarketAiFreshRealtimeStock\("
    }
    [pscustomobject]@{
      Check = "即時報價有帶更新時間"
      Passed = Test-Pattern $content "quoteUpdatedAt:\s*quote\.updatedAt"
    }
    [pscustomobject]@{
      Check = "盤中多方候選會阻擋舊資料或非即時資料"
      Passed = Test-Pattern $content "function\s+isMarketAiLongCandidate\([^)]*\)\s*\{[^}]*isMarketAiStaleStock\(stock\)[^}]*isMarketAiFreshRealtimeStock\(stock\)"
    }
  )

  $checks | Format-Table `
    @{Label = "檢查項目"; Expression = { $_.Check } },
    @{Label = "通過"; Expression = { $_.Passed } } -AutoSize

  $fast = $constants | Where-Object { $_.Name -eq "INTRADAY_FAST_SCAN_MS" } | Select-Object -First 1
  if ($fast -and $fast.Seconds -ne 5) {
    Write-Host "提醒：AI/策略即時快速巡邏目前是 $($fast.Seconds) 秒，不是 5 秒。" -ForegroundColor Yellow
  }
}

function Show-ScheduledTasks {
  Write-Section "Windows 工作排程"
  function Get-FumanTaskDescription($TaskName) {
    switch -Wildcard ($TaskName) {
      "Fuman GitHub 統一同步 0612" { return "早上 06:12 把 runtime 資料同步到 GitHub" }
      "Fuman GitHub 統一同步 0715" { return "早上 07:15 同步 GitHub" }
      "Fuman GitHub 統一同步 1445" { return "下午 14:45 同步 GitHub" }
      "Fuman GitHub 統一同步 2112" { return "晚上 21:12 同步 GitHub" }
      "Fuman PC Wake 0530" { return "Mini PC 早上 05:30 喚醒" }
      "Fuman PC Sleep 2200" { return "Mini PC 晚上 22:00 睡眠" }
      "Fuman Open Buy Cache 0700" { return "策略1「明日開盤入」早上 07:00 快取" }
      "Fuman Open Buy Cache 1600" { return "策略1 下午 16:00 快取" }
      "Fuman Strategy2 Intraday Scan" { return "策略2 當沖雷達，08:58 啟動，09:00 後每 3 秒巡邏到 13:30" }
      "Fuman Strategy2 LINE Start 0900" { return "策略2 LINE 通知巡邏啟動" }
      "Fuman Strategy2 LINE Stop 1330" { return "策略2 LINE 通知停止" }
      "Fuman Strategy3 Cache 1230" { return "策略3 隔日沖，12:30 先跑主掃描" }
      "Fuman Strategy3 Cache 1300" { return "策略3 隔日沖，13:00 第二次保險快取" }
      "Fuman Strategy4 Cache 1430" { return "策略4 波段，下午 14:30 全台股掃描" }
      "Fuman Strategy5 Cache 0600" { return "策略5 綜合策略與漲停十字星，早上 06:00 固定快取" }
      "Fuman Strategy5 Cache 2100" { return "策略5 綜合策略與漲停十字星，晚上 21:00 固定快取" }
      "Fuman Market Overview Patrol 0900" { return "市場總覽 / 熱力圖 / AI判讀，09:00 啟動巡邏到 13:30" }
      "Fuman Market Overview Patrol" { return "舊版市場總覽任務，已停用，正式任務請看 0900" }
      "Fuman 即時雷達" { return "即時雷達，08:58 開盤前啟動" }
      "Fuman Trade Manager Patrol 0900" { return "管家巡邏，09:00 啟動" }
      "Fuman Trade Manager Settlement 1340" { return "管家結算，13:40 執行" }
      "Fuman Scorecard Initial 1410" { return "成績單含輔滿回測初版，14:10 產生" }
      "Fuman Scorecard Final 1530" { return "成績單含輔滿回測終版，15:30 產生" }
      "Fuman Flow Cache 0600" { return "買賣超與權證走向，早上 06:00 合併掃描並發布終端" }
      "Fuman Flow Cache 2100" { return "買賣超與權證走向，晚上 21:00 合併掃描並發布終端" }
      "Fuman 買賣超 Cache 2100" { return "買賣超資料，晚上 21:00 快取並發布終端" }
    "Fuman 權證走向 Cache 0500" { return "權證資金走向，早上 05:00 快取並發布終端" }
    "Fuman 權證走向 Cache 2200" { return "權證資金走向，晚上 22:00 快取並發布終端" }
    "Fuman 買賣超 Cache 0600" { return "買賣超資料，早上 06:00 快取" }
      "Fuman 買賣超 Cache 2102" { return "買賣超資料，晚上 21:02 快取" }
      "Fuman 權證走向 Cache 0600" { return "權證資金走向，早上 06:00 快取" }
      "Fuman 權證走向 Cache 2100" { return "權證資金走向，晚上 21:00 快取" }
      default { return "" }
    }
  }

  function Get-TaskResultText($Code, $State) {
    if ($State -eq "Disabled") { return "$Code，已停用" }
    if ($Code -eq 0) { return "成功 0" }
    if ($Code -eq 267011) { return "$Code，尚未正式跑過或等待中" }
    return "錯誤 $Code"
  }

  try {
    Get-ScheduledTask |
      Where-Object { $_.TaskName -like "Fuman*" } |
      ForEach-Object {
        $info = Get-ScheduledTaskInfo $_
        [pscustomobject]@{
          TaskName = $_.TaskName
          Description = Get-FumanTaskDescription $_.TaskName
          State = $_.State
          LastRunTime = $info.LastRunTime
          NextRunTime = $info.NextRunTime
          LastTaskResult = Get-TaskResultText $info.LastTaskResult $_.State
          MissedRuns = $info.NumberOfMissedRuns
        }
      } |
      Sort-Object TaskName |
      Format-Table `
        @{Label = "工作名稱"; Expression = { $_.TaskName } },
        @{Label = "中文說明"; Expression = { $_.Description } },
        @{Label = "上次執行"; Expression = { $_.LastRunTime } },
        @{Label = "下次執行"; Expression = { $_.NextRunTime } },
        @{Label = "上次結果"; Expression = { $_.LastTaskResult } },
        @{Label = "錯過次數"; Expression = { $_.MissedRuns } } -AutoSize
  } catch {
    Write-Host "無法讀取工作排程：$($_.Exception.Message)" -ForegroundColor Red
  }
}

function Show-DataSourceNote {
  Write-Section "資料源判讀規則"
  Write-Host "盤中即時雷達/策略巡邏的準確來源：" -ForegroundColor Yellow
  Write-Host "  1. C:\fuman-runtime\data\realtime-radar-latest.json：Mini PC 巡邏寫入的本機即時快取"
  Write-Host "  2. Supabase fuman_realtime_radar_cache：前端線上即時雷達優先讀取的 live cache"
  Write-Host "  3. C:\fuman-terminal\data 與 C:\fuman-terminal-sync\data：Git/repo 同步備份，不是 3 秒巡邏來源"
  Write-Host "判讀原則：若 repo /data 較舊，但 runtime/Supabase 正常更新，不代表即時雷達停住。" -ForegroundColor Yellow
  Write-Host "除錯順序：先看 runtime data 與最新 realtime-radar log，再看 Supabase；repo /data 只用來確認同步備份。"
}
function Show-RealtimeRadarQuoteHealth {
  Write-Section "即時雷達報價健康"
  $path = Join-Path (Join-Path $runtimeRoot "data") "realtime-radar-latest.json"
  $supabaseStatusPath = Join-Path (Join-Path $runtimeRoot "state") "realtime-radar-supabase-status.json"
  if (!(Test-Path -LiteralPath $path)) {
    Write-Host "找不到即時雷達快取：$path" -ForegroundColor Yellow
    return
  }
  try {
    $payload = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  } catch {
    Write-Host "即時雷達 JSON 解析失敗：$($_.Exception.Message)" -ForegroundColor Red
    return
  }

  [pscustomobject]@{
    Status = $payload.status
    Timestamp = $payload.timestamp
    UpdatedAt = $payload.updatedAt
    Rows = @($payload.rows).Count
    StaleQuoteCount = [int]($payload.staleQuoteCount ?? 0)
    FailedBatchCount = [int]($payload.failedBatchCount ?? 0)
    TotalBatchCount = [int]($payload.totalBatchCount ?? 0)
    QuoteCount = [int]($payload.quoteCount ?? 0)
    MaxQuoteAgeSeconds = [int]($payload.maxQuoteAgeSeconds ?? 0)
    LastFailedScanAt = $payload.lastFailedScanAt
  } | Format-Table -AutoSize

  if (Test-Path -LiteralPath $supabaseStatusPath) {
    $supabase = Get-Content -LiteralPath $supabaseStatusPath -Raw | ConvertFrom-Json
    Write-Host "Supabase 上傳狀態：" -ForegroundColor Yellow
    $supabase | Select-Object ok,checkedAt,consecutiveFailures,lastSuccessAt,lastErrorAt,lastError | Format-List
  }

  $failed = @($payload.failedBatchDetails | Where-Object { $_ })
  if ($failed.Count) {
    Write-Host "失敗批次：" -ForegroundColor Yellow
    $failed | Select-Object -First 12 | Format-Table `
      @{Label = "批次"; Expression = { $_.batchIndex } },
      @{Label = "範圍"; Expression = { $_.range } },
      @{Label = "檔數"; Expression = { $_.count } },
      @{Label = "樣本"; Expression = { $_.sampleCodes } },
      @{Label = "錯誤"; Expression = { $_.error } } -AutoSize
  } else {
    Write-Host "失敗批次：0"
  }

  $stale = @($payload.staleQuoteDetails | Where-Object { $_ })
  if ($stale.Count) {
    Write-Host "Stale 報價明細（最多 20 檔，依延遲秒數排序）：" -ForegroundColor Yellow
    $stale | Select-Object -First 20 | Format-Table `
      @{Label = "代號"; Expression = { $_.code } },
      @{Label = "名稱"; Expression = { $_.name } },
      @{Label = "最後報價"; Expression = { $_.quoteTime } },
      @{Label = "延遲秒"; Expression = { $_.quoteAgeSeconds } },
      @{Label = "批次"; Expression = { $_.batchIndex } },
      @{Label = "批次範圍"; Expression = { $_.batchRange } },
      @{Label = "漲跌%"; Expression = { $_.percent } } -AutoSize
  } elseif (($payload.staleQuoteCount ?? 0) -gt 0) {
    Write-Host "staleQuoteCount > 0，但目前快取尚未含 staleQuoteDetails；等下一輪新版巡邏寫入後會出現明細。" -ForegroundColor Yellow
  } else {
    Write-Host "Stale 報價：0"
  }
}

function Show-DataFreshness {
  Write-Section "資料檔新鮮度"
  $important = @(
    "strategy2-intraday-latest.json",
    "realtime-radar-latest.json",
    "strategy3-latest.json",
    "strategy4-latest.json",
    "strategy5-latest.json",
    "strategy5-scorecard-latest.json",
    "institution-latest.json",
    "warrant-flow-latest.json",
    "open-buy-latest.json"
  )
  $now = Get-Date
  foreach ($dir in $dataDirs) {
    if (!(Test-Path -LiteralPath $dir)) { continue }
    Write-Host ""
    Write-Host $dir -ForegroundColor DarkCyan
    $rows = @()
    foreach ($name in $important) {
      $path = Join-Path $dir $name
      if (!(Test-Path -LiteralPath $path)) { continue }
      $item = Get-Item -LiteralPath $path
      $age = New-TimeSpan -Start $item.LastWriteTime -End $now
      $rows += [pscustomobject]@{
        File = $name
        LastWriteTime = $item.LastWriteTime
        AgeMinutes = [math]::Round($age.TotalMinutes, 1)
        Length = $item.Length
      }
    }
    $rows | Format-Table `
      @{Label = "檔案"; Expression = { $_.File } },
      @{Label = "最後更新"; Expression = { $_.LastWriteTime } },
      @{Label = "距今分鐘"; Expression = { $_.AgeMinutes } },
      @{Label = "大小"; Expression = { $_.Length } } -AutoSize
  }
}

function Show-LatestLogs {
  Write-Section "最新巡邏紀錄"
  if (!(Test-Path -LiteralPath $logDir)) {
    Write-Host "找不到 log 資料夾：$logDir" -ForegroundColor Yellow
    return
  }
  $patterns = @(
    "market-overview-*.log",
    "strategy2-intraday-*.log",
    "strategy2-line-*.log",
    "realtime-radar-*.log",
    "scorecard-*.log",
    "trade-manager-patrol-*.log"
  )
  foreach ($pattern in $patterns) {
    $latest = Get-ChildItem -LiteralPath $logDir -Filter $pattern -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if (!$latest) { continue }
    [pscustomobject]@{
      Pattern = $pattern
      LatestLog = $latest.Name
      LastWriteTime = $latest.LastWriteTime
      Length = $latest.Length
    } | Format-Table `
      @{Label = "類型"; Expression = { $_.Pattern } },
      @{Label = "最新紀錄"; Expression = { $_.LatestLog } },
      @{Label = "最後更新"; Expression = { $_.LastWriteTime } },
      @{Label = "大小"; Expression = { $_.Length } } -AutoSize
    Write-Host "最後幾行：" -ForegroundColor DarkGray
    Get-Content -LiteralPath $latest.FullName -Tail 8 -Encoding utf8
    Write-Host ""
  }
}

Write-Host "富滿終端巡邏狀態檢查" -ForegroundColor Green
Write-Host "新鮮即時報價門檻：$FreshSeconds 秒"
Write-Host "檢查時間：$(Get-Date)"

Show-FrontendPatrol $terminalJs "C:\fuman-terminal"
Show-FrontendPatrol $syncTerminalJs "C:\fuman-terminal-sync"
Show-ScheduledTasks
Show-DataSourceNote
Show-DataFreshness
Show-RealtimeRadarQuoteHealth
Show-LatestLogs


