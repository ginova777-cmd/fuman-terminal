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

$serviceRoleKey = Read-SecretText (Join-Path $RuntimeDir "secrets\supabase-service-role-key.txt")
if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) {
  throw "Missing Supabase service_role key: $(Join-Path $RuntimeDir 'secrets\supabase-service-role-key.txt')"
}
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

$status = if ($RetainTradeDays -ge 60) { "complete" } else { "partial" }
$syncRow = @([ordered]@{
  trade_date = $today
  source = "fugle"
  started_at = $startedAt
  finished_at = ConvertTo-IsoUtc
  symbols_expected = $files.Count
  symbols_loaded = $symbolsLoaded
  missing_symbols_count = [math]::Max(0, $files.Count - $symbolsLoaded)
  status = $status
  error_message = if ($status -eq "complete") { $null } else { "Imported latest $RetainTradeDays trade days from local Fugle cache; deeper backfill pending" }
  updated_at = ConvertTo-IsoUtc
  payload = @{
    importer = "Import-Strategy4DailyCacheToSupabase.ps1"
    retain_trade_days = $RetainTradeDays
    rows = $rowsPrepared
    cache_dir = $HistoryCacheDir
    dry_run = [bool]$DryRun
  }
})
Invoke-PublicSlotUpsert -Table "fugle_daily_sync_status" -OnConflict "trade_date,source" -Rows $syncRow -ServiceRoleKey $serviceRoleKey

Write-Host ""
Write-Host "DONE" -ForegroundColor Green
Write-Host "status: $status"
Write-Host "symbols_loaded: $symbolsLoaded / $($files.Count)"
Write-Host "rows_prepared: $rowsPrepared"
