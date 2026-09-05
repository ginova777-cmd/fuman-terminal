param(
  [string]$TradeDate = "",
  [int]$Top = 30,
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$IncludeRejected,
  [switch]$Detail,
  [switch]$All
)

$ErrorActionPreference = "Stop"

# Ignore accidental trailing punctuation pasted after switches, e.g. -Detail.
if ($TradeDate -in @(".", "。")) { $TradeDate = "" }

function Convert-DateKey([string]$date) {
  if ($date -match '^\d{8}$') { return $date }
  if ($date -match '^\d{4}-\d{2}-\d{2}$') { return $date.Replace("-", "") }
  throw "TradeDate must be YYYY-MM-DD or YYYYMMDD"
}

function Get-TaipeiDate {
  return (Get-Date).ToUniversalTime().AddHours(8).ToString("yyyy-MM-dd")
}

function Find-LatestOpeningEvidenceDateKey {
  $base = Join-Path $RuntimeDir "data\opening-limit-order"
  if (-not (Test-Path -LiteralPath $base)) { return $null }
  $patterns = @(
    "opening-limit-order-0855-ranked-watchlist-*.json",
    "opening-limit-order-0850-static-prefilter-*.json",
    "opening-limit-order-0840-pre-candidates-*.json",
    "opening-limit-order-0855-watchlist-*.json"
  )
  $keys = New-Object System.Collections.Generic.List[string]
  foreach ($pattern in $patterns) {
    Get-ChildItem -LiteralPath $base -File -Filter $pattern -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.Name -match '(\d{8})\.json$') { [void]$keys.Add($Matches[1]) }
    }
  }
  $todayKey = (Get-Date).ToUniversalTime().AddHours(8).ToString("yyyyMMdd")
  $latest = @($keys | Where-Object { $_ -le $todayKey } | Sort-Object -Descending | Select-Object -First 1)
  if ($latest.Count -eq 0) { return $null }
  return [string]$latest[0]
}
function Get-Array($value) {
  if ($null -eq $value) { return @() }
  if ($value -is [System.Array]) { return @($value) }
  return @($value)
}

function Read-Json($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try { return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -Depth 100 } catch { return $null }
}

function Format-Num($value) {
  if ($null -eq $value) { return "-" }
  try { return ("{0:0.##}" -f [double]$value) } catch { return [string]$value }
}

function Short-Text($value, [int]$max = 22) {
  if ($null -eq $value) { return "-" }
  $text = [string]$value
  if ([string]::IsNullOrWhiteSpace($text)) { return "-" }
  if ($text.Length -le $max) { return $text }
  return $text.Substring(0, $max - 1) + "..."
}

function Pick-First($obj, [string[]]$keys) {
  if ($null -eq $obj) { return $null }
  foreach ($key in $keys) {
    if ($obj.PSObject.Properties.Name -contains $key -and $null -ne $obj.$key -and "$($obj.$key)" -ne "") { return $obj.$key }
  }
  return $null
}

function Pick-Name($row) {
  $name = Pick-First $row @("name", "stock_name", "stockName", "display_name", "displayName")
  if ($name) { return [string]$name }
  if ($row.evidence) {
    $name = Pick-First $row.evidence @("name", "stock_name", "stockName", "display_name", "displayName")
    if ($name) { return [string]$name }
  }
  return ""
}

function Convert-StrategyToken($item, [bool]$pending) {
  if ($null -eq $item) { return $null }
  $raw = $null
  if ($item -is [string] -or $item -is [int] -or $item -is [long] -or $item -is [double]) { $raw = [string]$item }
  elseif ($item.PSObject.Properties.Name -contains "strategy_number") { $raw = [string]$item.strategy_number }
  elseif ($item.PSObject.Properties.Name -contains "strategyNumber") { $raw = [string]$item.strategyNumber }
  elseif ($item.PSObject.Properties.Name -contains "rule_number") { $raw = [string]$item.rule_number }
  elseif ($item.PSObject.Properties.Name -contains "number") { $raw = [string]$item.number }
  elseif ($item.PSObject.Properties.Name -contains "strategy") { $raw = [string]$item.strategy }
  elseif ($item.PSObject.Properties.Name -contains "rule") { $raw = [string]$item.rule }
  elseif ($item.PSObject.Properties.Name -contains "id") { $raw = [string]$item.id }
  else { $raw = [string]$item }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  if ($raw -match 'strategy\s*([0-9]+)' -or $raw -match '^S?([0-9]+)$') { $token = "S$($Matches[1])" }
  elseif ($raw -match '^S[0-9]+\??$') { $token = $raw }
  else { return $null }
  if ($pending -and -not $token.EndsWith("?")) { $token = "$token?" }
  return $token
}

function Join-Strategies($row) {
  $nums = New-Object System.Collections.Generic.List[string]
  foreach ($key in @("matched_strategy_numbers", "static_matched_strategy_numbers", "strategy_numbers", "strategies")) {
    foreach ($item in (Get-Array (Pick-First $row @($key)))) {
      $token = Convert-StrategyToken $item $false
      if ($token) { [void]$nums.Add($token) }
    }
  }
  foreach ($item in (Get-Array (Pick-First $row @("pending_strategy_numbers")))) {
    $token = Convert-StrategyToken $item $true
    if ($token) { [void]$nums.Add($token) }
  }
  $unique = @($nums | Select-Object -Unique)
  if ($unique.Count -eq 0) { return "-" }
  return $unique -join ","
}

function Get-Score($row) {
  return Pick-First $row @("opening_entry_weighted_score", "final_score", "score", "entry_score", "total_score")
}

function Get-IndustryText($row) {
  $values = @()
  foreach ($key in @("opening_report_display_names", "opening_report_industries", "industries")) { $values += @(Get-Array (Pick-First $row @($key))) }
  if ($row.evidence) {
    foreach ($key in @("opening_report_display_names", "opening_report_industries", "industries")) { $values += @(Get-Array (Pick-First $row.evidence @($key))) }
  }
  $texts = @($values | ForEach-Object {
    if ($null -eq $_) { return }
    if ($_.PSObject.Properties.Name -contains "name") { [string]$_.name }
    elseif ($_.PSObject.Properties.Name -contains "industry") { [string]$_.industry }
    else { [string]$_ }
  } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
  if ($texts.Count -eq 0) { return "-" }
  return ($texts -join ",")
}

function Get-PreferredBrokerDetail($row) {
  $detail = Pick-First $row @("preferred_broker_top_net_buy_detail", "overnight_detail")
  if ($detail) { return $detail }
  if ($row.evidence) {
    $detail = Pick-First $row.evidence @("preferred_broker_top_net_buy_detail", "overnight_detail")
    if ($detail) { return $detail }
  }
  $flatName = Pick-First $row @("preferred_broker_top_net_buy_name")
  if ($flatName) {
    return [pscustomobject]@{
      matched = (Pick-First $row @("preferred_broker_top_net_buy")) -eq $true
      broker_name = $flatName
      trader_id = Pick-First $row @("preferred_broker_top_net_buy_trader_id")
      rank = Pick-First $row @("preferred_broker_top_net_buy_rank")
      net_buy = Pick-First $row @("preferred_broker_top_net_buy_net_buy")
      cost_price = Pick-First $row @("preferred_broker_top_net_buy_cost_price")
    }
  }
  return $null
}

function Get-BrokerAlias($detail) {
  if ($null -eq $detail) { return "-" }
  $key = [string](Pick-First $detail @("broker_key"))
  $name = [string](Pick-First $detail @("broker_name", "trader", "branch_name"))
  $compact = $name -replace '[\s\-_.()（）]', ''
  if ($key -eq "morgan_stanley" -or $compact -match "摩根士丹利|morganstanley") { return "大摩" }
  if ($key -eq "jpmorgan" -or $compact -match "摩根大通|jpmorgan|台灣摩根") { return "小摩" }
  return "-"
}

function Get-OvernightMainForceText($row) {
  $detail = Get-PreferredBrokerDetail $row
  if ($null -eq $detail) { return "-" }
  $alias = Get-BrokerAlias $detail
  $rank = Pick-First $detail @("matched_rank", "rank")
  $matched = Pick-First $detail @("matched")
  if ($matched -eq $true -and $alias -ne "-") {
    if ($rank) { return "$alias#$rank" }
    return $alias
  }
  return "-"
}

function Get-MainForceCostText($row) {
  $cost = Pick-First $row @("main_force_cost_top10", "main_force_cost", "cost_price")
  if ($row.evidence) { $cost = Pick-First $row.evidence @("main_force_cost_top10", "main_force_cost", "cost_price") }
  if ($null -eq $cost) {
    $detail = Get-PreferredBrokerDetail $row
    $cost = Pick-First $detail @("cost_price", "net_buy_cost")
  }
  return Format-Num $cost
}
function Get-StageStatus($label, $path, $json, $count, $okValue) {
  $exists = Test-Path -LiteralPath $path
  $status = "MISSING"
  if ($exists -and $json) {
    if ($null -ne $okValue) { if ($okValue -eq $true) { $status = "OK" } else { $status = "DEGRADED" } }
    else { $status = "READABLE" }
  } elseif ($exists) { $status = "BROKEN_JSON" }
  [pscustomobject]@{ label = $label; status = $status; count = $count; path = $path }
}

$DateSource = "explicit"
if ([string]::IsNullOrWhiteSpace($TradeDate)) {
  $latestKey = Find-LatestOpeningEvidenceDateKey
  if ($latestKey) {
    $DateKey = $latestKey
    $DateSource = "latest_available_trading_evidence"
  } else {
    $TradeDate = Get-TaipeiDate
    $DateKey = Convert-DateKey $TradeDate
    $DateSource = "today_no_evidence_found"
  }
} else {
  $DateKey = Convert-DateKey $TradeDate
}
$TradeDate = "{0}-{1}-{2}" -f $DateKey.Substring(0,4), $DateKey.Substring(4,2), $DateKey.Substring(6,2)

$baseDir = Join-Path $RuntimeDir "data\opening-limit-order"
$stateDir = Join-Path $RuntimeDir "state"
$paths = [ordered]@{
  staticPrefilter = Join-Path $baseDir "opening-limit-order-0850-static-prefilter-$DateKey.json"
  preCandidates = Join-Path $baseDir "opening-limit-order-0840-pre-candidates-$DateKey.json"
  futoptReadback = Join-Path $baseDir "opening-limit-order-0845-futopt-readback-$DateKey.json"
  watchlist = Join-Path $baseDir "opening-limit-order-0855-watchlist-$DateKey.json"
  rankedWatchlist = Join-Path $baseDir "opening-limit-order-0855-ranked-watchlist-$DateKey.json"
  summary = Join-Path $baseDir "opening-limit-order-0855-summary-$DateKey.json"
  morningVerifier = Join-Path $baseDir "opening-limit-order-morning-readonly-$DateKey.json"
  closedLoop = Join-Path $baseDir "opening-limit-order-closed-loop-readiness-$DateKey.json"
}

$staticPrefilter = Read-Json $paths.staticPrefilter
$preCandidates = Read-Json $paths.preCandidates
$futoptReadback = Read-Json $paths.futoptReadback
$watchlist = Read-Json $paths.watchlist
$rankedWatchlist = Read-Json $paths.rankedWatchlist
$summary = Read-Json $paths.summary
$morningVerifier = Read-Json $paths.morningVerifier
$closedLoop = Read-Json $paths.closedLoop
$stockSlim = Read-Json (Join-Path $RuntimeDir "data\stocks-slim.json")
$stockNameBySymbol = @{}
foreach ($stock in (Get-Array $stockSlim.stocks)) {
  $code = [string](Pick-First $stock @("code", "symbol", "stock_id"))
  $stockName = [string](Pick-First $stock @("name", "stock_name"))
  if ($code -and $stockName) { $stockNameBySymbol[$code] = $stockName }
}

$industryEntries = @()
if (Test-Path -LiteralPath $stateDir) {
  $industryEntries = @(Get-ChildItem -LiteralPath $stateDir -File -Filter "opening_report_0830.industry_bias.*.json" | ForEach-Object {
    $json = Read-Json $_.FullName
    if ($json -and (($json.date -eq $TradeDate) -or ($json.trade_date -eq $TradeDate))) {
      $pct = Pick-First $json @("overseas_return_1d_pct", "overseas_return_pct", "average_return_pct", "avg_return_pct", "bias_score_pct")
      [pscustomobject]@{ industry = Pick-First $json @("industry", "industry_name", "name"); bias = Pick-First $json @("bias", "direction"); pct = try { [double]$pct } catch { $null } }
    }
  })
}
$positiveIndustries = @($industryEntries | Where-Object { $null -ne $_.pct -and $_.pct -gt 0 } | Sort-Object pct -Descending)

$rankedRows = @(Get-Array (Pick-First $summary @("candidates", "rows", "watchlist")))
if ($rankedRows.Count -eq 0) { $rankedRows = @(Get-Array (Pick-First $rankedWatchlist @("candidates", "rows", "watchlist"))) }
$watchlistRows = @(Get-Array (Pick-First $watchlist @("candidates", "rows", "watchlist")))
if ($watchlistRows.Count -eq 0) { $watchlistRows = @(Get-Array (Pick-First $watchlist @("symbols")) | ForEach-Object { [pscustomobject]@{ symbol = $_ } }) }
$prefilterRows = @(Get-Array (Pick-First $staticPrefilter @("rows", "candidates")))
$staticMatchRows = @($prefilterRows | Where-Object {
  [string](Pick-First $_ @("eligibility")) -eq "eligible" -and [string](Pick-First $_ @("status")) -eq "STATIC_MATCH"
})
$conditionalReadyRows = @($prefilterRows | Where-Object {
  [string](Pick-First $_ @("eligibility")) -eq "eligible" -and [string](Pick-First $_ @("status")) -eq "CONDITIONALLY_READY"
})
$baseRows = @($prefilterRows | Where-Object {
  $strategies = Join-Strategies $_
  $eligible = [string](Pick-First $_ @("eligibility"))
  $status = [string](Pick-First $_ @("status"))
  if ($IncludeRejected) {
    return $strategies -ne "-"
  }
  return $eligible -eq "eligible" -and ($status -eq "STATIC_MATCH" -or $status -eq "CONDITIONALLY_READY")
})
$baseRowsReadback = "static=$($staticMatchRows.Count), conditional=$($conditionalReadyRows.Count), total=$($baseRows.Count)"

$displayRows = @()
if ($rankedRows.Count -gt 0) { $displayRows = $rankedRows }
elseif ($baseRows.Count -gt 0) {
  $displayRows = @($baseRows | Sort-Object `
    @{ Expression = { (Get-Array (Pick-First $_ @("static_matched_strategy_numbers"))).Count }; Descending = $true },
    @{ Expression = { (Get-Array (Pick-First $_ @("pending_strategy_numbers"))).Count }; Descending = $true },
    @{ Expression = { try { [double](Pick-First $_ @("preopen_price_reference", "close", "price")) } catch { 0 } }; Descending = $true },
    @{ Expression = { [string](Pick-First $_ @("symbol", "stock_id")) }; Descending = $false })
} elseif ($watchlistRows.Count -gt 0) { $displayRows = $watchlistRows }
if (-not $All) { $displayRows = @($displayRows | Select-Object -First $Top) }

$stages = @(
  (Get-StageStatus "晚間/靜態型態底稿" $paths.staticPrefilter $staticPrefilter $baseRowsReadback (Pick-First $staticPrefilter @("ok"))),
  ([pscustomobject]@{ label = "08:20 晨報產業加權"; status = $(if ($industryEntries.Count -ge 19) { "OK" } elseif ($industryEntries.Count -gt 0) { "DEGRADED" } else { "MISSING" }); count = "$($industryEntries.Count)/19, positive=$($positiveIndustries.Count)"; path = $stateDir }),
  (Get-StageStatus "08:40 預觀察池" $paths.preCandidates $preCandidates (Pick-First $preCandidates @("symbol_count", "candidate_count", "row_count")) (Pick-First $preCandidates @("ok"))),
  (Get-StageStatus "08:45 股期/試撮證據" $paths.futoptReadback $futoptReadback (Pick-First $futoptReadback @("symbol_score_ready_count", "futures_score_positive_count", "candidate_count")) (Pick-First $futoptReadback @("evidence_ok", "ok"))),
  (Get-StageStatus "08:55 watchlist fallback" $paths.watchlist $watchlist (Pick-First $watchlist @("symbol_count", "candidate_count", "row_count")) (Pick-First $watchlist @("ok"))),
  (Get-StageStatus "08:55 正式觀察排名" $paths.rankedWatchlist $rankedWatchlist $rankedRows.Count (Pick-First $rankedWatchlist @("ok"))),
  (Get-StageStatus "morning verifier" $paths.morningVerifier $morningVerifier (Pick-First $morningVerifier @("ranked_candidate_count", "formal_candidate_count")) (Pick-First $morningVerifier @("ok"))),
  (Get-StageStatus "closed-loop readiness" $paths.closedLoop $closedLoop (Pick-First $closedLoop @("target_count", "task_count")) (Pick-First $closedLoop @("ok")))
)

Write-Host ""
Write-Host "開盤入目前偵測狀態 / Opening Limit Order Detection Status" -ForegroundColor Cyan
Write-Host "trade_date=$TradeDate  date_source=$DateSource  readonly=true  formal_candidate=false  publish=false" -ForegroundColor DarkCyan
Write-Host ""

$stageFmt = "{0,-26} {1,-10} {2,-36} {3}"
Write-Host ($stageFmt -f "Stage", "Status", "Count", "Source") -ForegroundColor Yellow
Write-Host ($stageFmt -f "-----", "------", "-----", "------") -ForegroundColor DarkYellow
foreach ($stage in $stages) {
  $color = "Gray"
  if ($stage.status -eq "OK" -or $stage.status -eq "READABLE") { $color = "Green" }
  elseif ($stage.status -eq "DEGRADED") { $color = "Yellow" }
  elseif ($stage.status -eq "MISSING" -or $stage.status -eq "BROKEN_JSON") { $color = "Red" }
  Write-Host ($stageFmt -f (Short-Text $stage.label 26), $stage.status, (Short-Text $stage.count 36), (Short-Text $stage.path 88)) -ForegroundColor $color
}

Write-Host ""
Write-Host "海外正向產業 Top" -ForegroundColor Yellow
if ($positiveIndustries.Count -eq 0) { Write-Host "目前沒有可讀的正向晨報產業；08:30 後仍沒有就是晨報鏈缺資料。" -ForegroundColor DarkYellow }
else {
  $idx = 0
  foreach ($industry in ($positiveIndustries | Select-Object -First 8)) {
    $idx++
    Write-Host ("{0,2}. {1,-24} {2,8}%  {3}" -f $idx, (Short-Text $industry.industry 24), (Format-Num $industry.pct), (Short-Text $industry.bias 18))
  }
}

Write-Host ""
$rowScope = $(if ($All) { "全部" } else { "Top $Top" })
if ($rankedRows.Count -gt 0) { Write-Host "08:55 正式觀察排名 $rowScope" -ForegroundColor Yellow }
elseif ($baseRows.Count -gt 0) { Write-Host "目前晚間底稿 $rowScope（STATIC_MATCH=$($staticMatchRows.Count)，CONDITIONALLY_READY=$($conditionalReadyRows.Count)，合計=$($baseRows.Count)；等待 08:45/08:55 排名閉環）" -ForegroundColor Yellow }
elseif ($watchlistRows.Count -gt 0) { Write-Host "08:55 watchlist fallback $rowScope（僅 symbol 清單，未完成 ranked closure）" -ForegroundColor Yellow }
else { Write-Host "目前尚無可讀名單 $rowScope" -ForegroundColor Yellow }

if ($Detail) {
  $fmt = "{0,4} {1,-6} {2,-10} {3,8} {4,-18} {5,-22} {6,-12} {7,10} {8,-16} {9,-20}"
  Write-Host ($fmt -f "Rank","Symbol","Name","Score","Strategy","Industry","隔日沖主力","主力成本","FutOpt","Reject") -ForegroundColor Yellow
  Write-Host ($fmt -f "----","------","----","-----","--------","--------","----------","--------","------","------") -ForegroundColor DarkYellow
} else {
  $fmt = "{0,4} {1,-6} {2,-10} {3,8} {4,-18} {5,-22} {6,-12} {7,10}"
  Write-Host ($fmt -f "Rank","Symbol","Name","Score","Strategy","Industry","隔日沖主力","主力成本") -ForegroundColor Yellow
  Write-Host ($fmt -f "----","------","----","-----","--------","--------","----------","--------") -ForegroundColor DarkYellow
}

$rank = 0
foreach ($row in $displayRows) {
  $rank++
  $symbol = Pick-First $row @("symbol", "stock_id", "ticker")
  $name = Pick-Name $row
  if ([string]::IsNullOrWhiteSpace($name) -and $stockNameBySymbol.ContainsKey([string]$symbol)) { $name = $stockNameBySymbol[[string]$symbol] }
  $score = Get-Score $row
  $strategies = Join-Strategies $row
  if ($strategies -eq "-") {
    $pendingTokens = @(Get-Array (Pick-First $row @("pending_strategy_numbers")) | ForEach-Object {
      $raw = [string]$_
      if ($raw -match '([0-9]+)') { "S$($Matches[1])?" }
    } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    if ($pendingTokens.Count -gt 0) { $strategies = $pendingTokens -join "," }
  }
  $industry = Get-IndustryText $row
  $mainForce = Get-OvernightMainForceText $row
  $mainCost = Get-MainForceCostText $row
  if ($Detail) {
    $futopt = Pick-First $row @("futopt_status", "futures_status", "futopt_reason")
    $reject = (Get-Array (Pick-First $row @("reject_reasons", "preopen_hard_reject_reasons", "rejected_reasons"))) -join ","
    $rowStatus = [string](Pick-First $row @("status"))
    if ([string]::IsNullOrWhiteSpace($reject) -and $rowStatus -eq "CONDITIONALLY_READY") {
      $reject = "pending_morning_futopt_trial"
    }
    Write-Host ($fmt -f $rank, (Short-Text $symbol 6), (Short-Text $name 10), (Format-Num $score), (Short-Text $strategies 18), (Short-Text $industry 22), (Short-Text $mainForce 12), (Short-Text $mainCost 10), (Short-Text $futopt 16), (Short-Text $reject 20))
  } else {
    Write-Host ($fmt -f $rank, (Short-Text $symbol 6), (Short-Text $name 10), (Format-Num $score), (Short-Text $strategies 18), (Short-Text $industry 22), (Short-Text $mainForce 12), (Short-Text $mainCost 10))
  }
}

Write-Host ""
$firstBlocker = Pick-First $morningVerifier @("first_blocker", "firstBlocker")
if (!$firstBlocker) { $firstBlocker = Pick-First $closedLoop @("first_blocker", "firstBlocker") }
if (!$firstBlocker -and $industryEntries.Count -lt 19) { $firstBlocker = "opening_report_industry_bias_not_complete" }
if (!$firstBlocker -and $rankedRows.Count -eq 0) { $firstBlocker = "ranked_watchlist_not_ready" }
if ($firstBlocker) { Write-Host "first_blocker=$firstBlocker" -ForegroundColor Yellow }
else { Write-Host "first_blocker=null" -ForegroundColor Green }
Write-Host "allowed_action=watch_status_only  forbidden_action=create_order|publish|formal_candidate" -ForegroundColor Yellow


