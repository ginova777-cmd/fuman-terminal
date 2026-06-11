param(
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$HistoryCacheDir = "C:\fuman-runtime\cache\fugle\historical",
  [int]$RetainTradeDays = 120,
  [int]$MaxSymbols = 20,
  [int]$DelaySeconds = 8,
  [int]$BatchSize = 300,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Read-SecretText {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return "" }
  return (Get-Content -LiteralPath $Path -Raw).Trim()
}

function ConvertTo-IsoUtc {
  return (Get-Date).ToUniversalTime().ToString("o")
}

function ConvertTo-Lots {
  param([object]$Value)
  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $number = 0.0
  if (-not [double]::TryParse(($text -replace ",", "").Trim(), [ref]$number)) { return $null }
  if ($number -gt 100000) { return [math]::Round($number / 1000.0, 3) }
  return [math]::Round($number, 3)
}

function Invoke-PublicSlotGetAll {
  param(
    [string]$PathAndQuery,
    [string]$ApiKey
  )
  $headers = @{
    apikey = $ApiKey
    Authorization = "Bearer $ApiKey"
  }
  $all = @()
  for ($offset = 0; $offset -lt 300000; $offset += 1000) {
    $separator = if ($PathAndQuery.Contains("?")) { "&" } else { "?" }
    $rows = @(Invoke-RestMethod `
      -Uri "$($ProjectUrl.TrimEnd('/'))/rest/v1/$PathAndQuery${separator}offset=$offset&limit=1000" `
      -Headers $headers `
      -Method Get `
      -TimeoutSec 60)
    if ($rows.Count -eq 1 -and $rows[0] -is [array]) { $rows = @($rows[0]) }
    if ($rows.Count -eq 0) { break }
    $all += $rows
    if ($rows.Count -lt 1000) { break }
  }
  return $all
}

function Invoke-PublicSlotUpsert {
  param(
    [string]$Table,
    [string]$OnConflict,
    [object[]]$Rows,
    [string]$ServiceRoleKey
  )
  if ($Rows.Count -eq 0 -or $DryRun) { return }
  $headers = @{
    apikey = $ServiceRoleKey
    Authorization = "Bearer $ServiceRoleKey"
    "Content-Type" = "application/json"
    Prefer = "resolution=merge-duplicates,return=minimal"
  }
  $body = @($Rows) | ConvertTo-Json -Depth 40 -Compress
  Invoke-WebRequest `
    -Uri "$($ProjectUrl.TrimEnd('/'))/rest/v1/${Table}?on_conflict=$OnConflict" `
    -Method Post `
    -Headers $headers `
    -Body $body `
    -TimeoutSec 120 | Out-Null
}

function Get-Strategy4UniverseSet {
  param([string]$ReadKey)
  $rows = Invoke-PublicSlotGetAll `
    -PathAndQuery "stock_universe?select=symbol,name,market,industry,is_active,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable" `
    -ApiKey $ReadKey
  $set = @{}
  foreach ($row in @($rows)) {
    $symbol = [string]$row.symbol
    $industry = [string]$row.industry
    if ($symbol -notmatch '^\d{4}$') { continue }
    if ($symbol.StartsWith("00")) { continue }
    if ($row.is_active -eq $false) { continue }
    if ($row.is_etf -eq $true) { continue }
    if ($row.is_warrant -eq $true) { continue }
    if ($row.is_cb -eq $true) { continue }
    if ($row.is_blacklisted -eq $true) { continue }
    if ($row.is_daytrade_unsuitable -eq $true) { continue }
    if ($industry -match "水泥|軍工|國防|航太") { continue }
    $set[$symbol] = @{
      symbol = $symbol
      name = $row.name
      market = $row.market
      industry = $industry
    }
  }
  return $set
}

function Get-Strategy4Coverage {
  param(
    [hashtable]$UniverseSet,
    [string]$ReadKey
  )
  $ohlcvRows = Invoke-PublicSlotGetAll -PathAndQuery "fugle_daily_ohlcv?select=symbol,trade_date" -ApiKey $ReadKey
  $ohlcvBySymbol = @{}
  foreach ($row in @($ohlcvRows)) {
    $symbol = [string]$row.symbol
    if (-not $UniverseSet.ContainsKey($symbol)) { continue }
    if (-not $ohlcvBySymbol.ContainsKey($symbol)) { $ohlcvBySymbol[$symbol] = 0 }
    $ohlcvBySymbol[$symbol] += 1
  }

  $volumeRows = Invoke-PublicSlotGetAll -PathAndQuery "fugle_daily_volume?select=symbol,trade_date" -ApiKey $ReadKey
  $volumeBySymbol = @{}
  foreach ($row in @($volumeRows)) {
    $symbol = [string]$row.symbol
    if (-not $UniverseSet.ContainsKey($symbol)) { continue }
    if (-not $volumeBySymbol.ContainsKey($symbol)) { $volumeBySymbol[$symbol] = @{} }
    $volumeBySymbol[$symbol][[string]$row.trade_date] = $true
  }

  $loadedSet = @{}
  foreach ($symbol in $UniverseSet.Keys) {
    $ohlcvCount = if ($ohlcvBySymbol.ContainsKey($symbol)) { $ohlcvBySymbol[$symbol] } else { 0 }
    $volumeCount = if ($volumeBySymbol.ContainsKey($symbol)) { $volumeBySymbol[$symbol].Count } else { 0 }
    if ($ohlcvCount -ge 60 -and $volumeCount -ge 5) { $loadedSet[$symbol] = $true }
  }
  $missing = @($UniverseSet.Keys | Where-Object { -not $loadedSet.ContainsKey($_) } | Sort-Object)
  return [ordered]@{
    expected = $UniverseSet.Count
    loaded = $loadedSet.Count
    missing = $missing.Count
    missing_symbols = $missing
  }
}

function Fetch-FugleDailyCandles {
  param(
    [string]$Symbol,
    [string]$FromDate,
    [string]$ToDate,
    [string]$FugleApiKey
  )
  $headers = @{
    "X-API-KEY" = $FugleApiKey
    Referer = "https://developer.fugle.tw/"
    Accept = "application/json"
  }
  $uri = "https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/$Symbol?symbol=$Symbol&from=$FromDate&to=$ToDate"
  Invoke-RestMethod -Uri $uri -Headers $headers -Method Get -TimeoutSec 45
}

function Fetch-YahooDailyCandles {
  param(
    [string]$Symbol,
    [string]$Market
  )
  $suffixes = @()
  if ($Market -match "TPEX|OTC|TWO") { $suffixes += "TWO" }
  if ($Market -match "TWSE|TSE|TW") { $suffixes += "TW" }
  $suffixes += @("TW", "TWO")
  $suffixes = @($suffixes | Select-Object -Unique)

  foreach ($suffix in $suffixes) {
    $uri = "https://query1.finance.yahoo.com/v8/finance/chart/$Symbol.$suffix?range=9mo&interval=1d&events=history&includeAdjustedClose=true"
    try {
      $payload = Invoke-RestMethod -Uri $uri -Headers @{ "User-Agent" = "Mozilla/5.0"; Accept = "application/json" } -Method Get -TimeoutSec 45
      $result = $payload.chart.result[0]
      if ($null -eq $result) { continue }
      $timestamps = @($result.timestamp)
      $quote = $result.indicators.quote[0]
      $rows = @()
      for ($i = 0; $i -lt $timestamps.Count; $i++) {
        $close = $quote.close[$i]
        if ($null -eq $close -or [double]$close -le 0) { continue }
        $date = ([DateTimeOffset]::FromUnixTimeSeconds([int64]$timestamps[$i])).ToOffset([TimeSpan]::FromHours(8)).ToString("yyyy-MM-dd")
        $rows += [pscustomobject]@{
          date = $date
          open = $quote.open[$i]
          high = $quote.high[$i]
          low = $quote.low[$i]
          close = $close
          volume = $quote.volume[$i]
          value = 0
          change = 0
          source = "yahoo-$suffix"
        }
      }
      if ($rows.Count -gt 0) { return [pscustomobject]@{ data = $rows; source = "yahoo-$suffix" } }
    } catch {
      continue
    }
  }
  throw "Yahoo daily candles not found for $Symbol"
}

function ConvertFrom-RocDate {
  param([string]$Text)
  if ($Text -notmatch '^(\d{2,3})/(\d{2})/(\d{2})$') { return $null }
  $year = [int]$Matches[1] + 1911
  return "{0:0000}-{1}-{2}" -f $year, $Matches[2], $Matches[3]
}

function Convert-MarketNumber {
  param([object]$Value)
  $text = ([string]$Value).Trim()
  if ([string]::IsNullOrWhiteSpace($text) -or $text -eq "--") { return $null }
  $number = 0.0
  if (-not [double]::TryParse(($text -replace ",", ""), [ref]$number)) { return $null }
  return $number
}

function Get-MonthStarts {
  param([int]$Months = 10)
  $out = @()
  $date = Get-Date
  $date = Get-Date -Year $date.Year -Month $date.Month -Day 1
  for ($i = 0; $i -lt $Months; $i++) {
    $out += $date
    $date = $date.AddMonths(-1)
  }
  return $out
}

function Fetch-OfficialDailyCandles {
  param(
    [string]$Symbol,
    [string]$Market
  )
  $sources = @()
  if ($Market -match "TPEX|OTC|TWO") { $sources += "tpex" }
  if ($Market -match "TWSE|TSE|TW") { $sources += "twse" }
  $sources += @("twse", "tpex")
  $sources = @($sources | Select-Object -Unique)

  foreach ($source in $sources) {
    $rows = @()
    foreach ($month in (Get-MonthStarts -Months 10)) {
      try {
        if ($source -eq "twse") {
          $dateText = $month.ToString("yyyyMM01")
          $uri = "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=$dateText&stockNo=$Symbol&response=json"
          $payload = Invoke-RestMethod -Uri $uri -Headers @{ Referer = "https://www.twse.com.tw/"; "User-Agent" = "Mozilla/5.0"; Accept = "application/json" } -Method Get -TimeoutSec 45
          if ($payload.stat -notmatch "OK") { continue }
          foreach ($item in @($payload.data)) {
            $date = ConvertFrom-RocDate ([string]$item[0])
            if (-not $date) { continue }
            $rows += [pscustomobject]@{
              date = $date
              volume = Convert-MarketNumber $item[1]
              value = Convert-MarketNumber $item[2]
              open = Convert-MarketNumber $item[3]
              high = Convert-MarketNumber $item[4]
              low = Convert-MarketNumber $item[5]
              close = Convert-MarketNumber $item[6]
              change = Convert-MarketNumber $item[7]
              source = "official-twse"
            }
          }
        } else {
          $dateText = $month.ToString("yyyy/MM/01")
          $uri = "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=$Symbol&date=$dateText&id=&response=json"
          $payload = Invoke-RestMethod -Uri $uri -Headers @{ Referer = "https://www.tpex.org.tw/"; "User-Agent" = "Mozilla/5.0"; Accept = "application/json" } -Method Get -TimeoutSec 45
          $dataRows = @($payload.data)
          foreach ($item in $dataRows) {
            $date = ConvertFrom-RocDate ([string]$item[0])
            if (-not $date) { continue }
            $rows += [pscustomobject]@{
              date = $date
              volume = Convert-MarketNumber $item[1]
              value = Convert-MarketNumber $item[2]
              open = Convert-MarketNumber $item[3]
              high = Convert-MarketNumber $item[4]
              low = Convert-MarketNumber $item[5]
              close = Convert-MarketNumber $item[6]
              change = Convert-MarketNumber $item[7]
              source = "official-tpex"
            }
          }
        }
      } catch {
        continue
      }
      Start-Sleep -Milliseconds 200
    }
    $validRows = @($rows | Where-Object { $_.date -and $null -ne $_.close -and [double]$_.close -gt 0 } | Sort-Object date -Descending | Select-Object -First $RetainTradeDays)
    if ($validRows.Count -gt 0) { return [pscustomobject]@{ data = $validRows; source = "official-$source" } }
  }
  throw "Official daily candles not found for $Symbol"
}

function Normalize-FugleRows {
  param([object]$Payload)
  $rows = @()
  if ($Payload.data) { $rows = @($Payload.data) }
  elseif ($Payload.candles) { $rows = @($Payload.candles) }
  elseif ($Payload.items) { $rows = @($Payload.items) }
  elseif ($Payload -is [array]) { $rows = @($Payload) }
  return @($rows | Where-Object {
    $date = [string]($_.date ?? $_.trade_date)
    $date -match '^\d{4}-\d{2}-\d{2}$' -and $null -ne $_.close -and [double]$_.close -gt 0
  } | Sort-Object { [string]($_.date ?? $_.trade_date) } -Descending | Select-Object -First $RetainTradeDays)
}

function Write-Strategy4SyncStatus {
  param(
    [hashtable]$UniverseSet,
    [string]$ReadKey,
    [string]$ServiceRoleKey,
    [string]$StartedAt,
    [string]$StatusNote
  )
  $coverage = Get-Strategy4Coverage -UniverseSet $UniverseSet -ReadKey $ReadKey
  $status = if ($coverage.missing -eq 0) { "complete" } elseif ($coverage.loaded -gt 0) { "partial" } else { "failed" }
  $now = ConvertTo-IsoUtc
  $row = @([ordered]@{
    trade_date = (Get-Date).ToString("yyyy-MM-dd")
    source = "fugle"
    started_at = $StartedAt
    finished_at = $now
    symbols_expected = $coverage.expected
    symbols_loaded = $coverage.loaded
    missing_symbols_count = $coverage.missing
    status = $status
    error_message = if ($status -eq "complete") { $null } else { "strategy4 universe coverage incomplete: missing $($coverage.missing) symbols" }
    updated_at = $now
    payload = @{
      importer = "Backfill-Strategy4MissingDailyOhlcv.ps1"
      basis = "strategy4_stock_universe"
      note = $StatusNote
      loaded_symbols = $coverage.loaded
      missing_symbols = $coverage.missing
      missing_sample = @($coverage.missing_symbols | Select-Object -First 100)
    }
  })
  Invoke-PublicSlotUpsert -Table "fugle_daily_sync_status" -OnConflict "trade_date,source" -Rows $row -ServiceRoleKey $ServiceRoleKey
  return $coverage
}

New-Item -ItemType Directory -Path $HistoryCacheDir -Force | Out-Null

$serviceRoleKey = Read-SecretText (Join-Path $RuntimeDir "secrets\supabase-service-role-key.txt")
$anonKey = Read-SecretText (Join-Path $RuntimeDir "secrets\supabase-anon-key.txt")
$fugleApiKey = Read-SecretText (Join-Path $RuntimeDir "secrets\fugle-api-key.txt")
if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) { throw "Missing Supabase service_role key" }
if ([string]::IsNullOrWhiteSpace($anonKey)) { $anonKey = $serviceRoleKey }
if ([string]::IsNullOrWhiteSpace($fugleApiKey)) { throw "Missing Fugle API key" }
if ($serviceRoleKey -notmatch '^eyJ') {
  throw "Supabase service_role key must be the legacy JWT key that starts with eyJ. The current key looks like a new sb_secret key, and Supabase REST rejects it for upsert writes."
}

$startedAt = ConvertTo-IsoUtc
$toDate = (Get-Date).ToString("yyyy-MM-dd")
$fromDate = (Get-Date).AddDays(-280).ToString("yyyy-MM-dd")

Write-Host "Strategy4 missing daily OHLCV backfill"
Write-Host "Project: $ProjectUrl"
Write-Host "Range: $fromDate -> $toDate"
Write-Host "MaxSymbols: $MaxSymbols"
Write-Host "DelaySeconds: $DelaySeconds"
if ($DryRun) { Write-Host "DRY RUN: no Supabase writes and no cache updates" -ForegroundColor Yellow }

$universeSet = Get-Strategy4UniverseSet -ReadKey $anonKey
$coverage = Get-Strategy4Coverage -UniverseSet $universeSet -ReadKey $anonKey
Write-Host ("Before: loaded={0} / expected={1}, missing={2}" -f $coverage.loaded, $coverage.expected, $coverage.missing)

$targets = @($coverage.missing_symbols | Select-Object -First $MaxSymbols)
$done = 0
$rowsWritten = 0
$rateLimited = $false

foreach ($symbol in $targets) {
  $meta = $universeSet[$symbol]
  Write-Host ("[{0}/{1}] {2} {3}" -f ($done + 1), $targets.Count, $symbol, $meta.name)
  try {
    $source = "fugle"
    try {
      $payload = Fetch-FugleDailyCandles -Symbol $symbol -FromDate $fromDate -ToDate $toDate -FugleApiKey $fugleApiKey
    } catch {
      $fugleMessage = $_.Exception.Message
      if ($fugleMessage -match "429|Too Many Requests") { throw }
      Write-Host ("  Fugle unavailable, fallback Yahoo: {0}" -f $fugleMessage) -ForegroundColor Yellow
      try {
        $payload = Fetch-YahooDailyCandles -Symbol $symbol -Market ([string]$meta.market)
        $source = [string]$payload.source
      } catch {
        Write-Host ("  Yahoo unavailable, fallback official: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
        $payload = Fetch-OfficialDailyCandles -Symbol $symbol -Market ([string]$meta.market)
        $source = [string]$payload.source
      }
    }
    $rows = @(Normalize-FugleRows -Payload $payload)
    if ($rows.Count -lt 5) {
      Write-Host ("  WARN rows too few: {0}" -f $rows.Count) -ForegroundColor Yellow
      Start-Sleep -Seconds $DelaySeconds
      continue
    }

    $now = ConvertTo-IsoUtc
    $cachePayload = [ordered]@{
      code = $symbol
      from = $fromDate
      to = $toDate
      source = $source
      updatedAt = $now
      rows = @($rows | ForEach-Object {
        [ordered]@{
          date = [string]($_.date ?? $_.trade_date)
          volume = $_.volume
          value = if ($null -ne $_.value) { $_.value } else { 0 }
          open = $_.open
          high = $_.high
          low = $_.low
          close = $_.close
          change = if ($null -ne $_.change) { $_.change } else { 0 }
        }
      })
    }
    if (-not $DryRun) {
      $cachePath = Join-Path $HistoryCacheDir "$symbol.json"
      $cachePayload | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $cachePath -Encoding UTF8
    }

    $ohlcvBatch = @()
    $volumeBatch = @()
    foreach ($row in $cachePayload.rows) {
      $volumeLots = ConvertTo-Lots $row.volume
      if ($null -eq $volumeLots) { continue }
      $ohlcvBatch += [ordered]@{
        symbol = $symbol
        market = $meta.market
        trade_date = $row.date
        open = $row.open
        high = $row.high
        low = $row.low
        close = $row.close
        volume = $volumeLots
        source = "$source-backfill"
        name = $meta.name
        industry = $meta.industry
        updated_at = $now
        payload = @{
          raw_volume = $row.volume
          volume_unit = "lots"
          backfill_script = "Backfill-Strategy4MissingDailyOhlcv.ps1"
          source = $source
        }
      }
      $volumeBatch += [ordered]@{
        symbol = $symbol
        market = $meta.market
        trade_date = $row.date
        volume = $volumeLots
        updated_at = $now
        payload = @{
          source = "$source-backfill"
          raw_volume = $row.volume
          volume_unit = "lots"
        }
      }
    }

    foreach ($chunkStart in 0..([math]::Floor(($ohlcvBatch.Count - 1) / $BatchSize))) {
      $start = $chunkStart * $BatchSize
      $count = [math]::Min($BatchSize, $ohlcvBatch.Count - $start)
      Invoke-PublicSlotUpsert -Table "fugle_daily_ohlcv" -OnConflict "symbol,trade_date" -Rows @($ohlcvBatch[$start..($start + $count - 1)]) -ServiceRoleKey $serviceRoleKey
      Invoke-PublicSlotUpsert -Table "fugle_daily_volume" -OnConflict "symbol,trade_date" -Rows @($volumeBatch[$start..($start + $count - 1)]) -ServiceRoleKey $serviceRoleKey
    }

    $rowsWritten += $ohlcvBatch.Count
    $done += 1
    Write-Host ("  OK rows={0}" -f $ohlcvBatch.Count) -ForegroundColor Green
  } catch {
    $message = $_.Exception.Message
    Write-Host ("  ERROR {0}" -f $message) -ForegroundColor Red
    if ($message -match "429|Too Many Requests") {
      $rateLimited = $true
      break
    }
  }
  Start-Sleep -Seconds $DelaySeconds
}

$note = if ($rateLimited) {
  "Stopped early because Fugle returned 429; continue later with smaller MaxSymbols or larger DelaySeconds"
} else {
  "Backfilled $done symbols, rows=$rowsWritten, max_symbols=$MaxSymbols, delay_seconds=$DelaySeconds"
}
$after = Write-Strategy4SyncStatus -UniverseSet $universeSet -ReadKey $anonKey -ServiceRoleKey $serviceRoleKey -StartedAt $startedAt -StatusNote $note

Write-Host ""
Write-Host "DONE" -ForegroundColor Green
Write-Host ("Backfilled symbols: {0}" -f $done)
Write-Host ("Rows written: {0}" -f $rowsWritten)
Write-Host ("After: loaded={0} / expected={1}, missing={2}" -f $after.loaded, $after.expected, $after.missing)
if ($rateLimited) { Write-Host "Stopped by Fugle 429. Wait and resume later." -ForegroundColor Yellow }
