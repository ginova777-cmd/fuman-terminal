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
    [int]$TimeoutSec = 45,
    [int]$BatchSize = 300
  )

  if (-not $Rows -or $Rows.Count -eq 0) { return }
  if ([string]::IsNullOrWhiteSpace($script:SupabaseUrl)) {
    throw "Call Initialize-SupabasePublicSlotSource first."
  }

  if (-not [string]::IsNullOrWhiteSpace($env:FUMAN_PUBLIC_SLOT_UPSERT_TIMEOUT_SEC)) {
    $TimeoutSec = [int]$env:FUMAN_PUBLIC_SLOT_UPSERT_TIMEOUT_SEC
  }
  if (-not [string]::IsNullOrWhiteSpace($env:FUMAN_PUBLIC_SLOT_UPSERT_BATCH_SIZE)) {
    $BatchSize = [int]$env:FUMAN_PUBLIC_SLOT_UPSERT_BATCH_SIZE
  }

  $safeBatchSize = [math]::Max(1, [math]::Min($BatchSize, 500))
  if ($Rows.Count -gt $safeBatchSize) {
    for ($offset = 0; $offset -lt $Rows.Count; $offset += $safeBatchSize) {
      $count = [math]::Min($safeBatchSize, $Rows.Count - $offset)
      $chunk = New-Object object[] $count
      [Array]::Copy($Rows, $offset, $chunk, 0, $count)
      Invoke-PublicSlotUpsert -Table $Table -OnConflict $OnConflict -Rows $chunk -RetryCount $RetryCount -TimeoutSec $TimeoutSec -BatchSize $safeBatchSize
    }
    return
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

function ConvertTo-PublicSlotPayloadHashtable {
  param([object]$Payload)

  $out = @{}
  if ($null -eq $Payload) { return $out }
  if ($Payload -is [System.Collections.IDictionary]) {
    foreach ($key in $Payload.Keys) { $out[[string]$key] = $Payload[$key] }
    return $out
  }
  foreach ($prop in $Payload.PSObject.Properties) {
    $out[[string]$prop.Name] = $prop.Value
  }
  return $out
}

function Get-PublicSlotPayloadValue {
  param([object]$Payload, [string]$Key, [object]$Default = $null)
  if ($null -eq $Payload) { return $Default }
  if ($Payload -is [string] -and -not [string]::IsNullOrWhiteSpace($Payload)) {
    try { $Payload = $Payload | ConvertFrom-Json -Depth 80 } catch {}
  }
  if ($Payload -is [System.Collections.IDictionary] -and $Payload.Contains($Key)) {
    return $Payload[$Key]
  }
  $prop = $Payload.PSObject.Properties[$Key]
  if ($null -ne $prop -and $null -ne $prop.Value) { return $prop.Value }
  return $Default
}

function Test-PublicSlotPreserveFreshQuoteStatus {
  param(
    [string]$SourceName,
    [string]$Status,
    [hashtable]$Payload
  )

  if ($SourceName -ne "fugle_shared_source") { return $false }
  $newFreshQuotes = [int](Get-PublicSlotPayloadValue -Payload $Payload -Key "fresh_quotes_120s" -Default 0)
  $newFreshCoverage = [double](Get-PublicSlotPayloadValue -Payload $Payload -Key "fresh_quote_coverage_120s" -Default 0)
  $newScannerCanRun = [bool](Get-PublicSlotPayloadValue -Payload $Payload -Key "scanner_can_run_quote_only" -Default $false)
  if ($Status -eq "ok" -or ($newFreshQuotes -ge 1500 -and $newFreshCoverage -ge 0.9 -and $newScannerCanRun)) {
    return $false
  }

  try {
    $headers = Get-PublicSlotWriteHeaders
    $uri = "$script:SupabaseUrl/rest/v1/source_status`?source_name=eq.$SourceName&select=updated_at,status,payload&limit=1"
    $rows = @(Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 10 -ErrorAction Stop)
    if ($rows.Count -le 0) { return $false }
    $previous = $rows[0]
    $previousAgeSeconds = 999999
    try {
      $previousAgeSeconds = [int]([datetimeoffset]::UtcNow - [datetimeoffset]::Parse([string]$previous.updated_at).ToUniversalTime()).TotalSeconds
    } catch {}
    if ($previousAgeSeconds -gt 120) { return $false }
    $previousPayload = $previous.payload
    $previousFreshQuotes = [int](Get-PublicSlotPayloadValue -Payload $previousPayload -Key "fresh_quotes_120s" -Default 0)
    $previousFreshCoverage = [double](Get-PublicSlotPayloadValue -Payload $previousPayload -Key "fresh_quote_coverage_120s" -Default 0)
    $previousScannerCanRun = [bool](Get-PublicSlotPayloadValue -Payload $previousPayload -Key "scanner_can_run_quote_only" -Default $false)
    return ($previousFreshQuotes -ge 1500 -and $previousFreshCoverage -ge 0.9 -and $previousScannerCanRun)
  } catch {
    return $false
  }
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

  if (Test-PublicSlotPreserveFreshQuoteStatus -SourceName $SourceName -Status $Status -Payload $Payload) {
    return
  }

  Invoke-PublicSlotUpsert -Table "source_status" -OnConflict "source_name" -Rows @($row)
}

function Write-PublicSlotSourceCoverageSnapshot {
  param(
    [string]$SourceName = "fugle_shared_source",
    [string]$TradeDate = (Get-Date).ToString("yyyy-MM-dd"),
    [string]$Status = "unknown",
    [string]$Message = $null,
    [hashtable]$Payload = @{}
  )

  if (-not (Test-PublicSlotColumnAvailable -Table "fugle_source_coverage" -Column "checked_at")) { return }

  $now = ConvertTo-IsoUtc
  $row = @{
    source_name = $SourceName
    trade_date = $TradeDate
    checked_at = $now
    status = $Status
    quote_status = $Payload.quote_status
    preopen_status = $Payload.preopen_status
    intraday_1m_status = $Payload.intraday_1m_status
    daily_volume_status = $Payload.daily_volume_status
    active_symbols = [int]($Payload.active_symbols)
    quotes_symbols = [int]($Payload.quotes)
    preopen_symbols = [int]($Payload.preopen)
    daily_volume_symbols = [int]($Payload.daily_volume_rows)
    daily_volume_avg_symbols = [int]($Payload.daily_volume_avg_rows)
    intraday_1m_symbols_today = [int]($Payload.intraday_1m_symbols_today)
    intraday_1m_rows_today = [int]($Payload.intraday_1m_rows_today)
    ready_ge_35_symbols = [int]($Payload.ready_ge_35_symbols)
    ready_ge_80_symbols = [int]($Payload.ready_ge_80_symbols)
    ready_ge_200_symbols = [int]($Payload.ready_ge_200_symbols)
    latest_candle_time = $Payload.latest_candle_time
    latest_candle_time_taipei = $Payload.latest_candle_time_taipei
    quote_age_seconds = [int]($Payload.quote_age_seconds)
    intraday_1m_stale_seconds = [int]($Payload.intraday_1m_stale_seconds)
    message = $Message
    payload = $Payload
  }

  $optionalCoverageColumns = @{
    permission_status = $Payload.permission_status
    fresh_quotes_120s = [int]($Payload.fresh_quotes_120s)
    today_1m_symbols = [int]($Payload.today_1m_symbols)
    today_1m_rows = [int]($Payload.today_1m_rows)
    warmup_candle_count = [int]($Payload.warmup_candle_count)
    continuous_candle_count = [int]($Payload.continuous_candle_count)
    ready_ge_20_symbols = [int]($Payload.ready_ge_20_symbols)
    ready_ma20_continuous_symbols = [int]($Payload.ready_ma20_continuous_symbols)
    ready_ma35_continuous_symbols = [int]($Payload.ready_ma35_continuous_symbols)
    ready_macd_continuous_symbols = [int]($Payload.ready_macd_continuous_symbols)
    top_movers_ready20_count = [int]($Payload.top_movers_ready20_count)
    top_movers_ready35_count = [int]($Payload.top_movers_ready35_count)
    daily_volume_ready_symbols = [int]($Payload.daily_volume_ready_symbols)
    scanner_can_run_quote_only = [bool]($Payload.scanner_can_run_quote_only)
    scanner_can_run_opening = [bool]($Payload.scanner_can_run_opening)
    scanner_can_run_ma20 = [bool]($Payload.scanner_can_run_ma20)
    scanner_can_run_ma35 = [bool]($Payload.scanner_can_run_ma35)
    scanner_can_run_full_intraday = [bool]($Payload.scanner_can_run_full_intraday)
    scanner_block_reason = $Payload.scanner_block_reason
  }
  foreach ($column in $optionalCoverageColumns.Keys) {
    if (Test-PublicSlotColumnAvailable -Table "fugle_source_coverage" -Column $column) {
      $row[$column] = $optionalCoverageColumns[$column]
    }
  }

  Invoke-PublicSlotUpsert -Table "fugle_source_coverage" -OnConflict "source_name,checked_at" -Rows @($row)
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
    $payload = ConvertTo-PublicSlotPayloadHashtable $row.payload
    if (-not $payload.ContainsKey("volume_unit")) { $payload["volume_unit"] = "lots" }
    if (-not $payload.ContainsKey("time_standard")) { $payload["time_standard"] = "UTC" }
    if (-not $payload.ContainsKey("source")) { $payload["source"] = "fugle_direct" }
    if (-not $payload.ContainsKey("synthetic")) { $payload["synthetic"] = $false }
    if (-not $payload.ContainsKey("volume_strategy_usable")) {
      $payload["volume_strategy_usable"] = ((ConvertTo-PublicSlotLots $row.volume) -gt 0)
    }
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
      payload = $payload
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
  $hasUnderlyingColumns = (Test-PublicSlotColumnAvailable -Table "futopt_quotes_live" -Column "underlying_symbol") -and
    (Test-PublicSlotColumnAvailable -Table "futopt_quotes_live" -Column "underlying_name")
  $normalized = foreach ($row in $Rows) {
    $payload = ConvertTo-PublicSlotPayloadHashtable $row.payload
    $underlyingSymbol = if ($row.underlying_symbol) { $row.underlying_symbol } elseif ($payload.ContainsKey("underlying_symbol")) { $payload["underlying_symbol"] } else { $null }
    $underlyingName = if ($row.underlying_name) { $row.underlying_name } elseif ($payload.ContainsKey("underlying_name")) { $payload["underlying_name"] } else { $null }
    $out = @{
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
      payload = if ($payload.Count -gt 0) { $payload } else { @{ volume_unit = "lots"; time_standard = "UTC" } }
    }
    if ($hasUnderlyingColumns) {
      $out.underlying_symbol = $underlyingSymbol
      $out.underlying_name = $underlyingName
    }
    $out
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

function Get-PublicSlotPreopenCheckpointKey {
  param([string]$ObservedAtIso)

  if ([string]::IsNullOrWhiteSpace($ObservedAtIso)) { return $null }
  try {
    $observed = [datetimeoffset]::Parse($ObservedAtIso, [Globalization.CultureInfo]::InvariantCulture)
    $taipeiZone = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    $taipei = [TimeZoneInfo]::ConvertTime($observed, $taipeiZone)
    if ($taipei.Hour -eq 8 -and $taipei.Minute -in @(55, 58, 59)) {
      return $taipei.ToString("HH:mm")
    }
  } catch {
  }
  return $null
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
    $observedAt = if ($row.observed_at) { ConvertTo-IsoUtc $row.observed_at } else { $now }
    $checkpointKey = Get-PublicSlotPreopenCheckpointKey -ObservedAtIso $observedAt
    $payload = ConvertTo-PublicSlotPayloadHashtable $row.payload
    if (-not $payload.ContainsKey("volume_unit")) { $payload["volume_unit"] = "lots" }
    if (-not $payload.ContainsKey("time_standard")) { $payload["time_standard"] = "UTC" }
    $payload["writer_observed_at"] = $observedAt
    $payload["preopen_checkpoint_contract"] = "preopen_checkpoint_history_v1"
    $payload["preopen_checkpoint_required_keys"] = @("08:55", "08:58", "08:59")
    $payload["preopen_checkpoint_key"] = if ($checkpointKey) { $checkpointKey } else { "none" }
    $payload["preopen_checkpoint_present"] = [bool]$checkpointKey
    if ($row.updated_at) { $payload["quote_updated_at"] = ConvertTo-IsoUtc $row.updated_at }
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
      payload = $payload
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
