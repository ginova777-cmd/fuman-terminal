$ErrorActionPreference = "Stop"

$script:SupabaseUrl = $env:SUPABASE_URL
$script:SupabaseAnonKey = $env:SUPABASE_ANON_KEY

function Initialize-SupabasePublicSlotReader {
  param(
    [string]$Url = "https://cpmpfhbzutkiecccekfr.supabase.co",
    [string]$AnonKey = $env:SUPABASE_ANON_KEY
  )

  if ([string]::IsNullOrWhiteSpace($Url)) { throw "Supabase URL is required." }
  if ([string]::IsNullOrWhiteSpace($AnonKey)) { throw "SUPABASE_ANON_KEY is required." }

  $script:SupabaseUrl = $Url.TrimEnd("/")
  $script:SupabaseAnonKey = $AnonKey
}

function Get-PublicSlotReadHeaders {
  if ([string]::IsNullOrWhiteSpace($script:SupabaseAnonKey)) {
    throw "Call Initialize-SupabasePublicSlotReader first."
  }

  @{
    "apikey" = $script:SupabaseAnonKey
    "Authorization" = "Bearer $script:SupabaseAnonKey"
  }
}

function Invoke-PublicSlotRead {
  param([Parameter(Mandatory = $true)][string]$PathAndQuery)

  if ([string]::IsNullOrWhiteSpace($script:SupabaseUrl)) {
    throw "Call Initialize-SupabasePublicSlotReader first."
  }

  $path = $PathAndQuery.TrimStart("/")
  Invoke-RestMethod -Uri "$script:SupabaseUrl/rest/v1/$path" -Method Get -Headers (Get-PublicSlotReadHeaders)
}

function Get-PublicSlotSourceStatus {
  param([string]$SourceName = $null)

  if ($SourceName) {
    return Invoke-PublicSlotRead -PathAndQuery "source_status?select=*&source_name=eq.$SourceName"
  }

  Invoke-PublicSlotRead -PathAndQuery "source_status?select=*&order=updated_at.desc"
}

function Test-PublicSlotSourceFresh {
  param(
    [string]$SourceName = "fugle_shared_source",
    [int]$MaxAgeSeconds = 45
  )

  $rows = @(Get-PublicSlotSourceStatus -SourceName $SourceName)
  if ($rows.Count -eq 0) {
    return @{ ok = $false; reason = "missing"; message = "來源異常：$SourceName 尚未寫入 source_status" }
  }

  $row = $rows[0]
  $updatedAt = [datetimeoffset]::Parse([string]$row.updated_at)
  $ageSeconds = [int](([datetimeoffset]::UtcNow - $updatedAt).TotalSeconds)

  if ($row.status -ne "ok") {
    return @{ ok = $false; reason = $row.status; age_seconds = $ageSeconds; message = "來源異常：$SourceName 狀態為 $($row.status)。$($row.message)" }
  }
  if ($ageSeconds -gt $MaxAgeSeconds) {
    return @{ ok = $false; reason = "stale"; age_seconds = $ageSeconds; message = "來源異常：$SourceName 已 $ageSeconds 秒未更新" }
  }

  @{ ok = $true; reason = "ok"; age_seconds = $ageSeconds; message = "來源正常：$SourceName 最後更新 $ageSeconds 秒前" }
}

function Get-PublicSlotFallbackDecision {
  param(
    [string]$SourceName = "fugle_shared_source",
    [int]$MaxAgeSeconds = 45,
    [switch]$AllowStrategyFallback
  )

  $fresh = Test-PublicSlotSourceFresh -SourceName $SourceName -MaxAgeSeconds $MaxAgeSeconds
  if ($fresh.ok) {
    return @{ should_fallback = $false; source_ok = $true; reason = "supabase_ok"; message = $fresh.message }
  }
  if (-not $AllowStrategyFallback) {
    return @{ should_fallback = $false; source_ok = $false; reason = $fresh.reason; message = "$($fresh.message)。策略端不可自行連續 fallback Fugle，請顯示來源異常。" }
  }

  @{ should_fallback = $true; source_ok = $false; reason = $fresh.reason; message = "$($fresh.message)。允許少量 fallback，請套用冷卻與限流。" }
}

function Get-PublicSlotQuotesLive {
  param([string[]]$Symbols = @(), [int]$Limit = 500)

  if ($Symbols.Count -gt 0) {
    $symbolList = ($Symbols | ForEach-Object { '"' + $_ + '"' }) -join ","
    return Invoke-PublicSlotRead -PathAndQuery "fugle_quotes_live?select=*&symbol=in.($symbolList)&order=updated_at.desc"
  }

  Invoke-PublicSlotRead -PathAndQuery "fugle_quotes_live?select=*&order=updated_at.desc&limit=$Limit"
}

function Get-PublicSlotIntraday1m {
  param(
    [string[]]$Symbols = @(),
    [string]$TradeDate = $null,
    [int]$Limit = 5000
  )

  $query = "fugle_intraday_1m?select=*&order=candle_time.desc&limit=$Limit"
  if ($Symbols.Count -gt 0) {
    $symbolList = ($Symbols | ForEach-Object { '"' + $_ + '"' }) -join ","
    $query = "fugle_intraday_1m?select=*&symbol=in.($symbolList)&order=candle_time.desc&limit=$Limit"
  }
  if ($TradeDate) {
    if ($Symbols.Count -gt 0) {
      $symbolList = ($Symbols | ForEach-Object { '"' + $_ + '"' }) -join ","
      $query = "fugle_intraday_1m?select=*&trade_date=eq.$TradeDate&symbol=in.($symbolList)&order=candle_time.desc&limit=$Limit"
    } else {
      $query = "fugle_intraday_1m?select=*&trade_date=eq.$TradeDate&order=candle_time.desc&limit=$Limit"
    }
  }

  Invoke-PublicSlotRead -PathAndQuery $query
}

function Get-PublicSlotIntraday1mStatus {
  param(
    [string[]]$Symbols = @(),
    [int]$Limit = 5000
  )

  if ($Symbols.Count -gt 0) {
    $symbolList = ($Symbols | ForEach-Object { '"' + $_ + '"' }) -join ","
    return Invoke-PublicSlotRead -PathAndQuery "v_fugle_intraday_1m_status?select=*&symbol=in.($symbolList)&order=symbol.asc&limit=$Limit"
  }

  Invoke-PublicSlotRead -PathAndQuery "v_fugle_intraday_1m_status?select=*&order=symbol.asc&limit=$Limit"
}

function Get-PublicSlotIntraday1mLatest200 {
  param(
    [string[]]$Symbols = @(),
    [int]$Limit = 200000
  )

  if ($Symbols.Count -gt 0) {
    $symbolList = ($Symbols | ForEach-Object { '"' + $_ + '"' }) -join ","
    return Invoke-PublicSlotRead -PathAndQuery "v_fugle_intraday_1m_latest_200?select=*&symbol=in.($symbolList)&order=symbol.asc,candle_time.desc&limit=$Limit"
  }

  Invoke-PublicSlotRead -PathAndQuery "v_fugle_intraday_1m_latest_200?select=*&order=symbol.asc,candle_time.desc&limit=$Limit"
}

function Get-PublicSlotDailyVolume {
  param([string[]]$Symbols = @(), [int]$Days = 5, [int]$Limit = 5000)

  $fromDate = (Get-Date).AddDays(-1 * [Math]::Max($Days + 5, 10)).ToString("yyyy-MM-dd")
  if ($Symbols.Count -gt 0) {
    $symbolList = ($Symbols | ForEach-Object { '"' + $_ + '"' }) -join ","
    return Invoke-PublicSlotRead -PathAndQuery "fugle_daily_volume?select=*&symbol=in.($symbolList)&trade_date=gte.$fromDate&order=trade_date.desc&limit=$Limit"
  }

  Invoke-PublicSlotRead -PathAndQuery "fugle_daily_volume?select=*&trade_date=gte.$fromDate&order=trade_date.desc&limit=$Limit"
}

function Get-PublicSlotFutoptTickers {
  param([string]$UnderlyingSymbol = $null, [string]$Product = $null, [int]$Limit = 1000)

  if ($UnderlyingSymbol) { return Invoke-PublicSlotRead -PathAndQuery "futopt_tickers?select=*&underlying_symbol=eq.$UnderlyingSymbol&order=end_date.asc&limit=$Limit" }
  if ($Product) { return Invoke-PublicSlotRead -PathAndQuery "futopt_tickers?select=*&product=eq.$Product&order=end_date.asc&limit=$Limit" }
  Invoke-PublicSlotRead -PathAndQuery "futopt_tickers?select=*&order=end_date.asc&limit=$Limit"
}

function Get-PublicSlotFutoptQuotesLive {
  param([string[]]$FutureSymbols = @(), [string]$Product = $null, [int]$Limit = 1000)

  if ($FutureSymbols.Count -gt 0) {
    $symbolList = ($FutureSymbols | ForEach-Object { '"' + $_ + '"' }) -join ","
    return Invoke-PublicSlotRead -PathAndQuery "futopt_quotes_live?select=*&future_symbol=in.($symbolList)&order=updated_at.desc"
  }
  if ($Product) { return Invoke-PublicSlotRead -PathAndQuery "futopt_quotes_live?select=*&product=eq.$Product&order=change_percent.desc&limit=$Limit" }
  Invoke-PublicSlotRead -PathAndQuery "futopt_quotes_live?select=*&order=updated_at.desc&limit=$Limit"
}

function Get-PublicSlotPreopenSnapshot {
  param([string[]]$Symbols = @(), [int]$Limit = 1000)

  if ($Symbols.Count -gt 0) {
    $symbolList = ($Symbols | ForEach-Object { '"' + $_ + '"' }) -join ","
    return Invoke-PublicSlotRead -PathAndQuery "fugle_preopen_snapshot?select=*&symbol=in.($symbolList)&order=updated_at.desc"
  }
  Invoke-PublicSlotRead -PathAndQuery "fugle_preopen_snapshot?select=*&order=updated_at.desc&limit=$Limit"
}

function Get-PublicSlotStockTickers {
  param([string[]]$Symbols = @(), [string]$Market = $null, [string]$StockType = $null, [int]$Limit = 5000)

  if ($Symbols.Count -gt 0) {
    $symbolList = ($Symbols | ForEach-Object { '"' + $_ + '"' }) -join ","
    return Invoke-PublicSlotRead -PathAndQuery "stock_tickers?select=*&symbol=in.($symbolList)&order=symbol.asc"
  }
  if ($StockType) { return Invoke-PublicSlotRead -PathAndQuery "stock_tickers?select=*&stock_type=eq.$StockType&order=symbol.asc&limit=$Limit" }
  if ($Market) { return Invoke-PublicSlotRead -PathAndQuery "stock_tickers?select=*&market=eq.$Market&order=symbol.asc&limit=$Limit" }
  Invoke-PublicSlotRead -PathAndQuery "stock_tickers?select=*&order=symbol.asc&limit=$Limit"
}

function Get-PublicSlotMarketCalendar {
  param([string]$TradeDate = (Get-Date).ToString("yyyy-MM-dd"), [string]$Market = $null)

  if ($Market) { return Invoke-PublicSlotRead -PathAndQuery "market_calendar?select=*&trade_date=eq.$TradeDate&market=eq.$Market" }
  Invoke-PublicSlotRead -PathAndQuery "market_calendar?select=*&trade_date=eq.$TradeDate&order=market.asc"
}
