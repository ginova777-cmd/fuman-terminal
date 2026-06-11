param(
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$HistoryCacheDir = "C:\fuman-runtime\cache\fugle\historical",
  [int]$RetainTradeDays = 120,
  [int]$BatchSize = 500,
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

function Get-Strategy4UniverseCoverage {
  param([string]$ReadKey)

  $universeRows = Invoke-PublicSlotGetAll `
    -PathAndQuery "stock_universe?select=symbol,industry,is_active,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable" `
    -ApiKey $ReadKey

  $universeSet = @{}
  foreach ($row in @($universeRows)) {
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
    $universeSet[$symbol] = $true
  }

  $ohlcvRows = Invoke-PublicSlotGetAll -PathAndQuery "fugle_daily_ohlcv?select=symbol,trade_date" -ApiKey $ReadKey
  $ohlcvBySymbol = @{}
  foreach ($row in @($ohlcvRows)) {
    $symbol = [string]$row.symbol
    if (-not $universeSet.ContainsKey($symbol)) { continue }
    if (-not $ohlcvBySymbol.ContainsKey($symbol)) { $ohlcvBySymbol[$symbol] = 0 }
    $ohlcvBySymbol[$symbol] += 1
  }
  $ohlcvReady = @($ohlcvBySymbol.Keys | Where-Object { $ohlcvBySymbol[$_] -ge 60 })

  $volumeRows = Invoke-PublicSlotGetAll -PathAndQuery "fugle_daily_volume?select=symbol,trade_date" -ApiKey $ReadKey
  $volumeBySymbol = @{}
  foreach ($row in @($volumeRows)) {
    $symbol = [string]$row.symbol
    if (-not $universeSet.ContainsKey($symbol)) { continue }
    if (-not $volumeBySymbol.ContainsKey($symbol)) { $volumeBySymbol[$symbol] = @{} }
    $volumeBySymbol[$symbol][[string]$row.trade_date] = $true
  }
  $volumeReady = @($volumeBySymbol.Keys | Where-Object { $volumeBySymbol[$_].Count -ge 5 })

  $loadedSet = @{}
  foreach ($symbol in $ohlcvReady) {
    if ($volumeBySymbol.ContainsKey($symbol) -and $volumeBySymbol[$symbol].Count -ge 5) {
      $loadedSet[$symbol] = $true
    }
  }

  $missingSample = @($universeSet.Keys | Where-Object { -not $loadedSet.ContainsKey($_) } | Sort-Object | Select-Object -First 100)
  return [ordered]@{
    expected = $universeSet.Count
    loaded = $loadedSet.Count
    missing = [math]::Max(0, $universeSet.Count - $loadedSet.Count)
    ohlcv_ready_ge_60 = $ohlcvReady.Count
    daily_volume_ready_5rows = $volumeReady.Count
    missing_sample = $missingSample
  }
}

$serviceRoleKey = Read-SecretText (Join-Path $RuntimeDir "secrets\supabase-service-role-key.txt")
if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) {
  throw "Missing Supabase service_role key: $(Join-Path $RuntimeDir 'secrets\supabase-service-role-key.txt')"
}
$anonKey = Read-SecretText (Join-Path $RuntimeDir "secrets\supabase-anon-key.txt")
if ([string]::IsNullOrWhiteSpace($anonKey)) { $anonKey = $serviceRoleKey }
if (-not (Test-Path -LiteralPath $HistoryCacheDir)) {
  throw "History cache dir not found: $HistoryCacheDir"
}

$files = @(Get-ChildItem -LiteralPath $HistoryCacheDir -Filter "*.json" -File | Sort-Object Name)
$startedAt = ConvertTo-IsoUtc
$today = (Get-Date).ToString("yyyy-MM-dd")
$ohlcvBatch = @()
$volumeBatch = @()
$symbolsLoaded = 0
$rowsPrepared = 0
$now = ConvertTo-IsoUtc

Write-Host "Strategy4 Fugle daily cache -> Supabase"
Write-Host "Project: $ProjectUrl"
Write-Host "Cache files: $($files.Count)"
Write-Host "Retain trade days per symbol: $RetainTradeDays"
if ($DryRun) { Write-Host "DRY RUN: no Supabase writes" -ForegroundColor Yellow }

foreach ($file in $files) {
  $symbol = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
  if ($symbol -notmatch '^\d{4}$' -or $symbol.StartsWith("00")) { continue }

  try {
    $payload = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json -Depth 80
    $rows = @($payload.rows | Sort-Object date -Descending | Select-Object -First $RetainTradeDays)
    $symbolRows = 0

    foreach ($row in $rows) {
      $tradeDate = [string]$row.date
      if ($tradeDate -notmatch '^\d{4}-\d{2}-\d{2}$') { continue }
      if ($null -eq $row.close -or [double]$row.close -le 0) { continue }
      $volumeLots = ConvertTo-Lots $row.volume
      if ($null -eq $volumeLots) { continue }

      $ohlcvBatch += [ordered]@{
        symbol = $symbol
        market = $null
        trade_date = $tradeDate
        open = $row.open
        high = $row.high
        low = $row.low
        close = $row.close
        volume = $volumeLots
        source = "fugle-cache"
        updated_at = $now
        payload = @{
          raw_volume = $row.volume
          volume_unit = "lots"
          cache_file = $file.Name
          cache_updated_at = $payload.updatedAt
        }
      }

      $volumeBatch += [ordered]@{
        symbol = $symbol
        market = $null
        trade_date = $tradeDate
        volume = $volumeLots
        updated_at = $now
        payload = @{
          source = "fugle-cache"
          raw_volume = $row.volume
          volume_unit = "lots"
        }
      }

      $rowsPrepared += 1
      $symbolRows += 1
    }

    if ($symbolRows -gt 0) { $symbolsLoaded += 1 }

    if ($ohlcvBatch.Count -ge $BatchSize) {
      Invoke-PublicSlotUpsert -Table "fugle_daily_ohlcv" -OnConflict "symbol,trade_date" -Rows $ohlcvBatch -ServiceRoleKey $serviceRoleKey
      $ohlcvBatch = @()
    }
    if ($volumeBatch.Count -ge $BatchSize) {
      Invoke-PublicSlotUpsert -Table "fugle_daily_volume" -OnConflict "symbol,trade_date" -Rows $volumeBatch -ServiceRoleKey $serviceRoleKey
      $volumeBatch = @()
    }

    if ($symbolsLoaded -gt 0 -and $symbolsLoaded % 100 -eq 0) {
      Write-Host ("Progress: symbols={0}, rows={1}" -f $symbolsLoaded, $rowsPrepared)
    }
  } catch {
    Write-Host ("WARN {0}: {1}" -f $symbol, $_.Exception.Message) -ForegroundColor Yellow
  }
}

Invoke-PublicSlotUpsert -Table "fugle_daily_ohlcv" -OnConflict "symbol,trade_date" -Rows $ohlcvBatch -ServiceRoleKey $serviceRoleKey
Invoke-PublicSlotUpsert -Table "fugle_daily_volume" -OnConflict "symbol,trade_date" -Rows $volumeBatch -ServiceRoleKey $serviceRoleKey

$coverage = Get-Strategy4UniverseCoverage -ReadKey $anonKey
$status = if ($coverage.missing -eq 0) { "complete" } elseif ($coverage.loaded -gt 0) { "partial" } else { "failed" }
$syncRow = @([ordered]@{
  trade_date = $today
  source = "fugle"
  started_at = $startedAt
  finished_at = ConvertTo-IsoUtc
  symbols_expected = $coverage.expected
  symbols_loaded = $coverage.loaded
  missing_symbols_count = $coverage.missing
  status = $status
  error_message = if ($status -eq "complete") { $null } else { "strategy4 universe coverage incomplete: missing $($coverage.missing) symbols" }
  updated_at = ConvertTo-IsoUtc
  payload = @{
    importer = "Import-Strategy4DailyCacheToSupabase.ps1"
    basis = "strategy4_stock_universe"
    retain_trade_days = $RetainTradeDays
    rows = $rowsPrepared
    cache_dir = $HistoryCacheDir
    dry_run = [bool]$DryRun
    cache_symbols_loaded = $symbolsLoaded
    stock_universe_symbols = $coverage.expected
    ohlcv_ready_ge_60_symbols = $coverage.ohlcv_ready_ge_60
    daily_volume_ready_5rows_symbols = $coverage.daily_volume_ready_5rows
    loaded_symbols = $coverage.loaded
    missing_symbols = $coverage.missing
    missing_sample = $coverage.missing_sample
    note = "symbols_expected/loaded/missing are based on Strategy4 filtered stock_universe; loaded requires OHLCV >= 60 rows and daily_volume >= 5 rows per symbol"
  }
})
Invoke-PublicSlotUpsert -Table "fugle_daily_sync_status" -OnConflict "trade_date,source" -Rows $syncRow -ServiceRoleKey $serviceRoleKey

Write-Host ""
Write-Host "DONE" -ForegroundColor Green
Write-Host "status: $status"
Write-Host "cache_symbols_loaded: $symbolsLoaded / $($files.Count)"
Write-Host "strategy4_coverage: $($coverage.loaded) / $($coverage.expected), missing=$($coverage.missing)"
Write-Host "rows_prepared: $rowsPrepared"
