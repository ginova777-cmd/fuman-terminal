$ErrorActionPreference = "Stop"

$script:SupabaseUrl = $env:SUPABASE_URL
$script:SupabaseServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY

function Initialize-SupabasePublicSlotSource {
  param(
    [string]$Url = "https://cpmpfhbzutkiecccekfr.supabase.co",
    [string]$ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
  )

  if ([string]::IsNullOrWhiteSpace($Url)) { throw "Supabase URL is required." }
  if ([string]::IsNullOrWhiteSpace($ServiceRoleKey)) { throw "SUPABASE_SERVICE_ROLE_KEY is required." }

  $script:SupabaseUrl = $Url.TrimEnd("/")
  $script:SupabaseServiceRoleKey = $ServiceRoleKey
}

function ConvertTo-IsoUtc {
  param([object]$Value = $null)

  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
    return (Get-Date).ToUniversalTime().ToString("o")
  }

  return ([datetimeoffset]::Parse([string]$Value)).ToUniversalTime().ToString("o")
}

function ConvertTo-PublicSlotLots {
  param([object]$Value)
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return 0 }
  $number = 0.0
  if (-not [double]::TryParse((([string]$Value) -replace ",", "" -replace "%", "").Trim(), [ref]$number)) { return 0 }
  if ($number -gt 100000) { return [math]::Round($number / 1000, 3) }
  return $number
}

function Get-PublicSlotWriteHeaders {
  if ([string]::IsNullOrWhiteSpace($script:SupabaseServiceRoleKey)) {
    throw "Call Initialize-SupabasePublicSlotSource first."
  }

  @{
    "apikey" = $script:SupabaseServiceRoleKey
    "Authorization" = "Bearer $script:SupabaseServiceRoleKey"
    "Content-Type" = "application/json"
    "Prefer" = "resolution=merge-duplicates"
  }
}

function Invoke-PublicSlotUpsert {
  param(
    [Parameter(Mandatory = $true)][string]$Table,
    [Parameter(Mandatory = $true)][string]$OnConflict,
    [Parameter(Mandatory = $true)][object[]]$Rows,
    [int]$RetryCount = 2,
    [int]$TimeoutSec = 20
  )

  if (-not $Rows -or $Rows.Count -eq 0) { return }
  if ([string]::IsNullOrWhiteSpace($script:SupabaseUrl)) {
    throw "Call Initialize-SupabasePublicSlotSource first."
  }

  $body = $Rows | ConvertTo-Json -Depth 40 -Compress
  $uri = "$script:SupabaseUrl/rest/v1/$Table`?on_conflict=$OnConflict"
  $headers = Get-PublicSlotWriteHeaders

  for ($attempt = 0; $attempt -le $RetryCount; $attempt++) {
    try {
      Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -TimeoutSec $TimeoutSec -ErrorAction Stop | Out-Null
      return
    } catch {
      if ($attempt -ge $RetryCount) { throw }
      Start-Sleep -Milliseconds (350 * ($attempt + 1))
    }
  }
}

function Test-PublicSlotColumnAvailable {
  param(
    [Parameter(Mandatory = $true)][string]$Table,
    [Parameter(Mandatory = $true)][string]$Column
  )

  $cacheKey = "$Table.$Column"
  if ($null -eq $script:PublicSlotColumnCache) { $script:PublicSlotColumnCache = @{} }
  if ($script:PublicSlotColumnCache.ContainsKey($cacheKey)) {
    return [bool]$script:PublicSlotColumnCache[$cacheKey]
  }

  try {
    $headers = Get-PublicSlotWriteHeaders
    $uri = "$script:SupabaseUrl/rest/v1/$Table`?select=$Column&limit=0"
    Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 10 -ErrorAction Stop | Out-Null
    $script:PublicSlotColumnCache[$cacheKey] = $true
    return $true
  } catch {
    $script:PublicSlotColumnCache[$cacheKey] = $false
    return $false
  }
}

function Get-PublicSlotNullableLots {
  param([object]$Value)
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
  return ConvertTo-PublicSlotLots $Value
}

function Write-PublicSlotSourceStatus {
  param(
    [Parameter(Mandatory = $true)][string]$SourceName,
    [ValidateSet("ok", "stale", "degraded", "error", "starting", "stopped")]
    [string]$Status = "ok",
    [string]$Message = $null,
    [string]$TradeDate = (Get-Date).ToString("yyyy-MM-dd"),
    [int]$StaleSeconds = 0,
    [hashtable]$Payload = @{}
  )

  $now = ConvertTo-IsoUtc
  $row = @{
    source_name = $SourceName
    trade_date = $TradeDate
    updated_at = $now
    status = $Status
    message = $Message
    stale_seconds = $StaleSeconds
    payload = $Payload
  }
  if ($Status -eq "ok") { $row.last_success_at = $now }
  if ($Status -eq "error") { $row.last_error_at = $now }

  Invoke-PublicSlotUpsert -Table "source_status" -OnConflict "source_name" -Rows @($row)
}

function Write-PublicSlotMarketCalendar {
  param([Parameter(Mandatory = $true)][object[]]$Rows)

  $now = ConvertTo-IsoUtc
  $normalized = foreach ($row in $Rows) {
    @{
      trade_date = $row.trade_date
      market = $row.market
      is_open = if ($null -ne $row.is_open) { $row.is_open } else { $true }
      session = $row.session
      note = $row.note
      updated_at = if ($row.updated_at) { ConvertTo-IsoUtc $row.updated_at } else { $now }
      payload = if ($row.payload) { $row.payload } else { @{} }
    }
  }

  Invoke-PublicSlotUpsert -Table "market_calendar" -OnConflict "trade_date,market" -Rows @($normalized)
}

function Write-PublicSlotQuotesLive {
  param([Parameter(Mandatory = $true)][object[]]$Rows)

  $now = ConvertTo-IsoUtc
  $hasCumulativeBidAskColumns = (Test-PublicSlotColumnAvailable -Table "fugle_quotes_live" -Column "cumulative_bid_volume") -and
    (Test-PublicSlotColumnAvailable -Table "fugle_quotes_live" -Column "cumulative_ask_volume") -and
    (Test-PublicSlotColumnAvailable -Table "fugle_quotes_live" -Column "cumulative_bid_ask_volume")
  $normalized = foreach ($row in $Rows) {
    $ask = if ($null -ne $row.ask_volume) { ConvertTo-PublicSlotLots $row.ask_volume } elseif ($null -ne $row.askVolume) { ConvertTo-PublicSlotLots $row.askVolume } else { 0 }
    $bid = if ($null -ne $row.bid_volume) { ConvertTo-PublicSlotLots $row.bid_volume } elseif ($null -ne $row.bidVolume) { ConvertTo-PublicSlotLots $row.bidVolume } else { 0 }
    $cumBid = if ($null -ne $row.cumulative_bid_volume) { Get-PublicSlotNullableLots $row.cumulative_bid_volume } elseif ($null -ne $row.cumulativeBidVolume) { Get-PublicSlotNullableLots $row.cumulativeBidVolume } else { $null }
    $cumAsk = if ($null -ne $row.cumulative_ask_volume) { Get-PublicSlotNullableLots $row.cumulative_ask_volume } elseif ($null -ne $row.cumulativeAskVolume) { Get-PublicSlotNullableLots $row.cumulativeAskVolume } else { $null }
    $cumTotal = if ($null -ne $row.cumulative_bid_ask_volume) { Get-PublicSlotNullableLots $row.cumulative_bid_ask_volume } elseif ($null -ne $row.cumulativeBidAskVolume) { Get-PublicSlotNullableLots $row.cumulativeBidAskVolume } elseif ($null -ne $cumBid -and $null -ne $cumAsk) { $cumBid + $cumAsk } else { $null }
    $out = @{
      symbol = [string]$row.symbol
      name = $row.name
      market = $row.market
      updated_at = if ($row.updated_at) { ConvertTo-IsoUtc $row.updated_at } elseif ($row.timestamp) { ConvertTo-IsoUtc $row.timestamp } else { $now }
      price = $row.price
      open_price = if ($null -ne $row.open_price) { $row.open_price } else { $row.openPrice }
      high_price = if ($null -ne $row.high_price) { $row.high_price } else { $row.highPrice }
      low_price = if ($null -ne $row.low_price) { $row.low_price } else { $row.lowPrice }
      previous_close = if ($null -ne $row.previous_close) { $row.previous_close } else { $row.previousClose }
      change_percent = if ($null -ne $row.change_percent) { $row.change_percent } else { $row.changePercent }
      total_volume = if ($null -ne $row.total_volume) { ConvertTo-PublicSlotLots $row.total_volume } else { ConvertTo-PublicSlotLots $row.totalVolume }
      trade_value = if ($null -ne $row.trade_value) { $row.trade_value } else { $row.tradeValue }
      bid_volume = $bid
      ask_volume = $ask
      ask_bid_ratio = if ($null -ne $row.ask_bid_ratio) { $row.ask_bid_ratio } elseif ($bid -gt 0) { $ask / $bid } else { $null }
      ask_ratio = if ($null -ne $row.ask_ratio) { $row.ask_ratio } elseif (($ask + $bid) -gt 0) { $ask / ($ask + $bid) } else { $null }
      stock_type = if ($row.stock_type) { $row.stock_type } else { $row.stockType }
      session = $row.session
      limit_up_price = if ($null -ne $row.limit_up_price) { $row.limit_up_price } else { $row.limitUpPrice }
      limit_down_price = if ($null -ne $row.limit_down_price) { $row.limit_down_price } else { $row.limitDownPrice }
      last_trade_time = if ($row.last_trade_time) { ConvertTo-IsoUtc $row.last_trade_time } elseif ($row.lastTradeTime) { ConvertTo-IsoUtc $row.lastTradeTime } else { $null }
      is_halted = if ($null -ne $row.is_halted) { $row.is_halted } else { $row.isHalted }
      is_trial = if ($null -ne $row.is_trial) { $row.is_trial } else { $row.isTrial }
      payload = if ($row.payload) { $row.payload } else { @{ volume_unit = "lots"; time_standard = "UTC" } }
    }
    if ($hasCumulativeBidAskColumns) {
      $out.cumulative_bid_volume = $cumBid
      $out.cumulative_ask_volume = $cumAsk
      $out.cumulative_bid_ask_volume = $cumTotal
    }
    $out
  }

  Invoke-PublicSlotUpsert -Table "fugle_quotes_live" -OnConflict "symbol" -Rows @($normalized)
}

function Write-PublicSlotIntraday1m {
  param([Parameter(Mandatory = $true)][object[]]$Rows)

  $now = ConvertTo-IsoUtc
  $normalized = foreach ($row in $Rows) {
    $candleTime = if ($row.candle_time) { ConvertTo-IsoUtc $row.candle_time } elseif ($row.time) { ConvertTo-IsoUtc $row.time } else { ConvertTo-IsoUtc $row.timestamp }
    @{
      symbol = [string]$row.symbol
      market = $row.market
      trade_date = if ($row.trade_date) { $row.trade_date } else { ([datetimeoffset]::Parse($candleTime)).ToOffset([timespan]::FromHours(8)).ToString("yyyy-MM-dd") }
      candle_time = $candleTime
      open = $row.open
      high = $row.high
      low = $row.low
      close = $row.close
      volume = ConvertTo-PublicSlotLots $row.volume
      updated_at = if ($row.updated_at) { ConvertTo-IsoUtc $row.updated_at } else { $now }
      payload = if ($row.payload) { $row.payload } else { @{ volume_unit = "lots"; time_standard = "UTC" } }
    }
  }

  Invoke-PublicSlotUpsert -Table "fugle_intraday_1m" -OnConflict "symbol,candle_time" -Rows @($normalized)
}

function Write-PublicSlotDailyVolume {
  param([Parameter(Mandatory = $true)][object[]]$Rows)

  $now = ConvertTo-IsoUtc
  $normalized = foreach ($row in $Rows) {
    @{
      symbol = [string]$row.symbol
      market = $row.market
      trade_date = $row.trade_date
      volume = ConvertTo-PublicSlotLots $row.volume
      updated_at = if ($row.updated_at) { ConvertTo-IsoUtc $row.updated_at } else { $now }
      payload = if ($row.payload) { $row.payload } else { @{ volume_unit = "lots"; time_standard = "UTC" } }
    }
  }

  Invoke-PublicSlotUpsert -Table "fugle_daily_volume" -OnConflict "symbol,trade_date" -Rows @($normalized)
}

function Write-PublicSlotDailyOhlcv {
  param([Parameter(Mandatory = $true)][object[]]$Rows)

  if (-not (Test-PublicSlotColumnAvailable -Table "fugle_daily_ohlcv" -Column "symbol")) { return }

  $now = ConvertTo-IsoUtc
  $normalized = foreach ($row in $Rows) {
    @{
      symbol = [string]$row.symbol
      market = $row.market
      trade_date = $row.trade_date
      open = $row.open
      high = $row.high
      low = $row.low
      close = $row.close
      volume = ConvertTo-PublicSlotLots $row.volume
      source = if ($row.source) { $row.source } else { "fugle" }
      name = $row.name
      industry = $row.industry
      updated_at = if ($row.updated_at) { ConvertTo-IsoUtc $row.updated_at } else { $now }
      payload = if ($row.payload) { $row.payload } else { @{ volume_unit = "lots"; time_standard = "UTC" } }
    }
  }

  Invoke-PublicSlotUpsert -Table "fugle_daily_ohlcv" -OnConflict "symbol,trade_date" -Rows @($normalized)
}

function Write-PublicSlotDailySyncStatus {
  param(
    [string]$TradeDate = (Get-Date).ToString("yyyy-MM-dd"),
    [string]$Source = "fugle_shared_source",
    [string]$Status = "running",
    [int]$SymbolsExpected = 0,
    [int]$SymbolsLoaded = 0,
    [int]$MissingSymbolsCount = 0,
    [string]$ErrorMessage = $null,
    [hashtable]$Payload = @{}
  )

  if (-not (Test-PublicSlotColumnAvailable -Table "fugle_daily_sync_status" -Column "trade_date")) { return }

  $now = ConvertTo-IsoUtc
  $row = @{
    trade_date = $TradeDate
    source = $Source
    started_at = if ($Payload.started_at) { ConvertTo-IsoUtc $Payload.started_at } else { $now }
    finished_at = if ($Status -in @("complete", "partial", "failed", "skipped", "no_trade_day")) { $now } else { $null }
    symbols_expected = $SymbolsExpected
    symbols_loaded = $SymbolsLoaded
    missing_symbols_count = $MissingSymbolsCount
    status = $Status
    error_message = $ErrorMessage
    updated_at = $now
    payload = $Payload
  }

  Invoke-PublicSlotUpsert -Table "fugle_daily_sync_status" -OnConflict "trade_date,source" -Rows @($row)
}

function Write-PublicSlotFutoptTickers {
  param([Parameter(Mandatory = $true)][object[]]$Rows)

  $now = ConvertTo-IsoUtc
  $normalized = foreach ($row in $Rows) {
    @{
      future_symbol = [string]$row.future_symbol
      name = $row.name
      product = $row.product
      contract_type = $row.contract_type
      end_date = $row.end_date
      exchange = $row.exchange
      underlying_name = $row.underlying_name
      underlying_symbol = $row.underlying_symbol
      session = $row.session
      updated_at = if ($row.updated_at) { ConvertTo-IsoUtc $row.updated_at } else { $now }
      payload = if ($row.payload) { $row.payload } else { @{} }
    }
  }

  Invoke-PublicSlotUpsert -Table "futopt_tickers" -OnConflict "future_symbol" -Rows @($normalized)
}

function Write-PublicSlotFutoptQuotesLive {
  param([Parameter(Mandatory = $true)][object[]]$Rows)

  $now = ConvertTo-IsoUtc
  $normalized = foreach ($row in $Rows) {
    @{
      future_symbol = [string]$row.future_symbol
      updated_at = if ($row.updated_at) { ConvertTo-IsoUtc $row.updated_at } else { $now }
      last_price = if ($null -ne $row.last_price) { $row.last_price } else { $row.price }
      open_price = $row.open_price
      high_price = $row.high_price
      low_price = $row.low_price
      previous_close = $row.previous_close
      change_percent = $row.change_percent
      total_volume = ConvertTo-PublicSlotLots $row.total_volume
      product = $row.product
      session = $row.session
      payload = if ($row.payload) { $row.payload } else { @{ volume_unit = "lots"; time_standard = "UTC" } }
    }
  }

  Invoke-PublicSlotUpsert -Table "futopt_quotes_live" -OnConflict "future_symbol" -Rows @($normalized)
}

function Write-PublicSlotPreopenSnapshot {
  param([Parameter(Mandatory = $true)][object[]]$Rows)

  $now = ConvertTo-IsoUtc
  $normalized = foreach ($row in $Rows) {
    @{
      symbol = [string]$row.symbol
      name = $row.name
      market = $row.market
      session = $row.session
      updated_at = if ($row.updated_at) { ConvertTo-IsoUtc $row.updated_at } else { $now }
      reference_price = $row.reference_price
      trial_price = $row.trial_price
      is_trial = $row.is_trial
      is_limit_up_bid = $row.is_limit_up_bid
      best_bid_price = $row.best_bid_price
      best_ask_price = $row.best_ask_price
      bid_volume = ConvertTo-PublicSlotLots $row.bid_volume
      ask_volume = ConvertTo-PublicSlotLots $row.ask_volume
      bid1_price = $row.bid1_price
      bid1_volume = ConvertTo-PublicSlotLots $row.bid1_volume
      bid2_price = $row.bid2_price
      bid2_volume = ConvertTo-PublicSlotLots $row.bid2_volume
      bid3_price = $row.bid3_price
      bid3_volume = ConvertTo-PublicSlotLots $row.bid3_volume
      bid4_price = $row.bid4_price
      bid4_volume = ConvertTo-PublicSlotLots $row.bid4_volume
      bid5_price = $row.bid5_price
      bid5_volume = ConvertTo-PublicSlotLots $row.bid5_volume
      ask1_price = $row.ask1_price
      ask1_volume = ConvertTo-PublicSlotLots $row.ask1_volume
      ask2_price = $row.ask2_price
      ask2_volume = ConvertTo-PublicSlotLots $row.ask2_volume
      ask3_price = $row.ask3_price
      ask3_volume = ConvertTo-PublicSlotLots $row.ask3_volume
      ask4_price = $row.ask4_price
      ask4_volume = ConvertTo-PublicSlotLots $row.ask4_volume
      ask5_price = $row.ask5_price
      ask5_volume = ConvertTo-PublicSlotLots $row.ask5_volume
      bid_levels_json = if ($row.bid_levels_json) { $row.bid_levels_json } else { @() }
      ask_levels_json = if ($row.ask_levels_json) { $row.ask_levels_json } else { @() }
      payload = if ($row.payload) { $row.payload } else { @{ volume_unit = "lots"; time_standard = "UTC" } }
    }
  }

  Invoke-PublicSlotUpsert -Table "fugle_preopen_snapshot" -OnConflict "symbol" -Rows @($normalized)
}

function Write-PublicSlotPreopenSnapshotHistory {
  param([Parameter(Mandatory = $true)][object[]]$Rows)

  if (-not (Test-PublicSlotColumnAvailable -Table "fugle_preopen_snapshot_history" -Column "symbol")) {
    return
  }

  $now = ConvertTo-IsoUtc
  $tradeDate = (Get-Date).ToString("yyyy-MM-dd")
  $hasUpdatedAtColumn = Test-PublicSlotColumnAvailable -Table "fugle_preopen_snapshot_history" -Column "updated_at"
  $normalized = foreach ($row in $Rows) {
    $observedAt = if ($row.updated_at) { ConvertTo-IsoUtc $row.updated_at } elseif ($row.timestamp) { ConvertTo-IsoUtc $row.timestamp } else { $now }
    $out = @{
      symbol = [string]$row.symbol
      observed_at = $observedAt
      name = $row.name
      market = $row.market
      session = $row.session
      trade_date = $tradeDate
      reference_price = $row.reference_price
      trial_price = $row.trial_price
      is_trial = if ($null -ne $row.is_trial) { $row.is_trial } else { $row.isTrial }
      is_limit_up_bid = if ($null -ne $row.is_limit_up_bid) { $row.is_limit_up_bid } else { $row.isLimitUpBid }
      best_bid_price = $row.best_bid_price
      best_ask_price = $row.best_ask_price
      bid_volume = ConvertTo-PublicSlotLots $row.bid_volume
      ask_volume = ConvertTo-PublicSlotLots $row.ask_volume
      bid1_price = $row.bid1_price
      bid1_volume = ConvertTo-PublicSlotLots $row.bid1_volume
      bid2_price = $row.bid2_price
      bid2_volume = ConvertTo-PublicSlotLots $row.bid2_volume
      bid3_price = $row.bid3_price
      bid3_volume = ConvertTo-PublicSlotLots $row.bid3_volume
      bid4_price = $row.bid4_price
      bid4_volume = ConvertTo-PublicSlotLots $row.bid4_volume
      bid5_price = $row.bid5_price
      bid5_volume = ConvertTo-PublicSlotLots $row.bid5_volume
      ask1_price = $row.ask1_price
      ask1_volume = ConvertTo-PublicSlotLots $row.ask1_volume
      ask2_price = $row.ask2_price
      ask2_volume = ConvertTo-PublicSlotLots $row.ask2_volume
      ask3_price = $row.ask3_price
      ask3_volume = ConvertTo-PublicSlotLots $row.ask3_volume
      ask4_price = $row.ask4_price
      ask4_volume = ConvertTo-PublicSlotLots $row.ask4_volume
      ask5_price = $row.ask5_price
      ask5_volume = ConvertTo-PublicSlotLots $row.ask5_volume
      bid_levels_json = if ($row.bid_levels_json) { $row.bid_levels_json } else { @() }
      ask_levels_json = if ($row.ask_levels_json) { $row.ask_levels_json } else { @() }
      payload = if ($row.payload) { $row.payload } else { @{ volume_unit = "lots"; time_standard = "UTC" } }
    }
    if ($hasUpdatedAtColumn) { $out.updated_at = $observedAt }
    $out
  }

  Invoke-PublicSlotUpsert -Table "fugle_preopen_snapshot_history" -OnConflict "symbol,observed_at" -Rows @($normalized)
}

function Write-PublicSlotStockTickers {
  param([Parameter(Mandatory = $true)][object[]]$Rows)

  $now = ConvertTo-IsoUtc
  $normalized = foreach ($row in $Rows) {
    @{
      symbol = [string]$row.symbol
      name = $row.name
      market = $row.market
      stock_type = if ($row.stock_type) { $row.stock_type } else { $row.stockType }
      industry = $row.industry
      type = $row.type
      is_etf = $row.is_etf
      is_suspended = $row.is_suspended
      updated_at = if ($row.updated_at) { ConvertTo-IsoUtc $row.updated_at } else { $now }
      payload = if ($row.payload) { $row.payload } else { @{} }
    }
  }

  Invoke-PublicSlotUpsert -Table "stock_tickers" -OnConflict "symbol" -Rows @($normalized)
}
