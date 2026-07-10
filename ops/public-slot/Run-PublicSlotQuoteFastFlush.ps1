param(
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$ScriptDir = $PSScriptRoot,
  [int]$LoopSeconds = 30,
  [int]$StopAfterMinutes = 0,
  [switch]$Once,
  [string[]]$RequiredSeedSymbols = @("3037", "2492", "2327", "2059")
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$ScheduleGuard = Join-Path $RepoRoot "schedule-guard.ps1"
if (Test-Path -LiteralPath $ScheduleGuard) {
  . $ScheduleGuard
  $GuardLogDir = Join-Path $RuntimeDir "logs"
  New-Item -ItemType Directory -Force -Path $GuardLogDir | Out-Null
  $GuardLog = Join-Path $GuardLogDir ("public-slot-quote-fast-flush-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  Invoke-FumanWeekdayGuard -Label "Public Slot Quote Fast Flush" -LogPath $GuardLog
}
$SourceHelper = Join-Path $ScriptDir "SupabasePublicSlotSource.ps1"
if (-not (Test-Path -LiteralPath $SourceHelper)) {
  throw "Missing Supabase public slot helper: $SourceHelper"
}
. $SourceHelper

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_SERVICE_ROLE_KEY)) {
  foreach ($scope in @("User", "Machine")) {
    $candidate = [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY", $scope)
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      $env:SUPABASE_SERVICE_ROLE_KEY = $candidate
      break
    }
  }
}
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_URL)) {
  $env:SUPABASE_URL = $ProjectUrl
}

$LogDir = Join-Path $ScriptDir "runtime"
$LogFile = Join-Path $LogDir ("public-slot-quote-fast-flush-{0}.log" -f (Get-Date -Format "yyyyMMdd"))
$QuotesFile = Join-Path $RuntimeDir "cache\intraday\fugle-ws-quotes.json"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
}

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -Depth 80
}

function Read-TextSecret {
  param([string[]]$Paths)
  foreach ($path in @($Paths)) {
    try {
      if (Test-Path -LiteralPath $path) {
        $value = (Get-Content -LiteralPath $path -Raw -ErrorAction Stop).Trim()
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
      }
    } catch {}
  }
  return ""
}

function Get-Number {
  param([object]$Value, [double]$Default = 0)
  if ($null -eq $Value) { return $Default }
  try {
    $number = [double]$Value
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return $Default }
    return $number
  } catch { return $Default }
}

function Convert-VolumeToLots {
  param([object]$Value)
  $number = Get-Number $Value 0
  if ($number -le 0) { return 0 }
  if ($number -ge 1000) { return [int][math]::Round($number / 1000, 0) }
  return [int][math]::Round($number, 0)
}

function Convert-Market {
  param([string]$Market)
  $value = ([string]$Market).Trim().ToUpperInvariant()
  if ($value -in @("TSE", "TWSE", "上市")) { return "TSE" }
  if ($value -in @("OTC", "TPEX", "上櫃")) { return "OTC" }
  return $Market
}

function Get-PublicSlotSessionLabel {
  $now = Get-Date
  $minutes = $now.Hour * 60 + $now.Minute
  if ($minutes -lt (9 * 60)) { return "preopen" }
  if ($minutes -le (13 * 60 + 30)) { return "regular" }
  return "after_close"
}

function Get-QuoteSeenAt {
  param([object]$Quote, [object]$Payload)
  foreach ($candidate in @($Quote.quoteSeenAt, $Quote.updatedAt, $Quote.timestamp, $Payload.updatedAt, $Payload.lastUpdatedAt)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
      try {
        $text = ([string]$candidate).Trim()
        if ($text -notmatch '(Z|[+-]\d{2}:\d{2})$') { $text = $text + "Z" }
        return ([datetimeoffset]::Parse($text)).ToUniversalTime().ToString("o")
      } catch {}
    }
  }
  return (Get-Date).ToUniversalTime().ToString("o")
}

function Invoke-FugleStockQuoteSeed {
  param([string]$Symbol, [string]$ApiKey)
  if ([string]::IsNullOrWhiteSpace($Symbol) -or [string]::IsNullOrWhiteSpace($ApiKey)) { return $null }
  $headers = @{
    "X-API-KEY" = $ApiKey
    "User-Agent" = "FumanPublicSlotQuoteFastFlush/1.0"
  }
  try {
    $uri = "https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/$Symbol"
    return Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 4 -ErrorAction Stop
  } catch {
    $statusCode = $null
    try { if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { $statusCode = [int]$_.Exception.Response.StatusCode } } catch {}
    $message = $_.Exception.Message
    if ($statusCode -in @(402, 403, 429) -or $message -match '402|403|429|Too Many|Payment Required|Forbidden') {
      Write-Log "WARN quote-seed $Symbol stopped status=$statusCode message=$message"
      $script:QuoteSeedStopped = $true
    } else {
      Write-Log "WARN quote-seed $Symbol failed status=$statusCode message=$message"
    }
    return $null
  }
}

function Convert-FugleStockQuoteSeedToFastQuote {
  param([object]$Quote)
  if ($null -eq $Quote) { return $null }
  $symbol = ([string]$Quote.symbol) -replace "\D", ""
  if ([string]::IsNullOrWhiteSpace($symbol) -or $symbol.Length -ne 4) { return $null }

  $bestBid = $null
  $bestAsk = $null
  try { $bestBid = @($Quote.bids)[0] } catch {}
  try { $bestAsk = @($Quote.asks)[0] } catch {}

  $lastPrice = Get-Number $Quote.lastPrice 0
  if ($lastPrice -le 0) { $lastPrice = Get-Number $Quote.lastTrial.price 0 }
  if ($lastPrice -le 0) { $lastPrice = Get-Number $Quote.closePrice 0 }
  if ($lastPrice -le 0) { return $null }

  $previousClose = Get-Number $Quote.previousClose 0
  if ($previousClose -le 0) { $previousClose = Get-Number $Quote.referencePrice 0 }
  $updatedAt = ""
  try {
    $candidate = [string]$Quote.lastUpdated
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      if ($candidate -notmatch '(Z|[+-]\d{2}:\d{2})$') { $candidate = $candidate + "Z" }
      $updatedAt = ([datetimeoffset]::Parse($candidate)).ToUniversalTime().ToString("o")
    }
  } catch {}
  if ([string]::IsNullOrWhiteSpace($updatedAt)) { $updatedAt = (Get-Date).ToUniversalTime().ToString("o") }
  $isTrial = [bool]$Quote.isTrial

  return [pscustomobject][ordered]@{
    code = $symbol
    symbol = $symbol
    name = [string]$Quote.name
    market = Convert-Market ([string]$Quote.market)
    price = $lastPrice
    lastPrice = $lastPrice
    close = $lastPrice
    open = Get-Number $Quote.openPrice 0
    openPrice = Get-Number $Quote.openPrice 0
    high = Get-Number $Quote.highPrice 0
    highPrice = Get-Number $Quote.highPrice 0
    low = Get-Number $Quote.lowPrice 0
    lowPrice = Get-Number $Quote.lowPrice 0
    prevClose = $previousClose
    previousClose = $previousClose
    percent = Get-Number $Quote.changePercent 0
    changePercent = Get-Number $Quote.changePercent 0
    tradeVolume = Convert-VolumeToLots $Quote.total.tradeVolume
    totalVolume = Convert-VolumeToLots $Quote.total.tradeVolume
    tradeValue = [int64](Get-Number $Quote.total.tradeValue 0)
    bidVolume = Convert-VolumeToLots $bestBid.size
    askVolume = Convert-VolumeToLots $bestAsk.size
    cumulativeBidVolume = Convert-VolumeToLots $Quote.total.tradeVolumeAtBid
    cumulativeAskVolume = Convert-VolumeToLots $Quote.total.tradeVolumeAtAsk
    quoteSeenAt = $updatedAt
    updatedAt = $updatedAt
    timestamp = $updatedAt
    isTrial = $isTrial
    session = if ($isTrial) { "preopen" } else { Get-PublicSlotSessionLabel }
    source = "fugle-rest-intraday-quote-seed"
  }
}

function Add-RequiredQuoteSeeds {
  param([object[]]$Quotes, [string[]]$Symbols, [string]$ApiKey)
  $script:QuoteSeedStopped = $false
  $byCode = [ordered]@{}
  foreach ($quote in @($Quotes)) {
    $symbol = ([string]($quote.symbol ?? $quote.code)) -replace "\D", ""
    if ($symbol.Length -eq 4) { $byCode[$symbol] = $quote }
  }
  $attempted = 0
  $fetched = 0
  foreach ($symbol in @($Symbols)) {
    $clean = ([string]$symbol) -replace "\D", ""
    if ($clean.Length -ne 4) { continue }
    if ($script:QuoteSeedStopped) { break }
    $attempted += 1
    $payload = Invoke-FugleStockQuoteSeed -Symbol $clean -ApiKey $ApiKey
    $quote = Convert-FugleStockQuoteSeedToFastQuote -Quote $payload
    if ($null -ne $quote) {
      # Required guard symbols are always REST-seeded and overwrite WS snapshots.
      $byCode[$clean] = $quote
      $fetched += 1
    }
    Start-Sleep -Milliseconds 250
  }
  return @{ quotes = @($byCode.Values); attempted = $attempted; fetched = $fetched }
}
function Convert-FastQuoteRows {
  param([object[]]$Quotes, [object]$Payload)
  foreach ($quote in @($Quotes)) {
    $symbol = [string]($quote.symbol ?? $quote.code)
    $symbol = $symbol -replace "\D", ""
    if ([string]::IsNullOrWhiteSpace($symbol) -or $symbol.Length -ne 4) { continue }
    $bid = if ($null -ne $quote.bidVolume) { $quote.bidVolume } elseif ($null -ne $quote.bid_volume) { $quote.bid_volume } else { 0 }
    $ask = if ($null -ne $quote.askVolume) { $quote.askVolume } elseif ($null -ne $quote.ask_volume) { $quote.ask_volume } else { 0 }
    $seenAt = Get-QuoteSeenAt -Quote $quote -Payload $Payload
    @{
      symbol = $symbol
      name = $quote.name
      market = $quote.market
      updated_at = $seenAt
      timestamp = $seenAt
      price = if ($null -ne $quote.price) { $quote.price } elseif ($null -ne $quote.lastPrice) { $quote.lastPrice } else { $quote.close }
      openPrice = if ($null -ne $quote.openPrice) { $quote.openPrice } else { $quote.open }
      highPrice = if ($null -ne $quote.highPrice) { $quote.highPrice } else { $quote.high }
      lowPrice = if ($null -ne $quote.lowPrice) { $quote.lowPrice } else { $quote.low }
      previousClose = if ($null -ne $quote.previousClose) { $quote.previousClose } else { $quote.prevClose }
      changePercent = if ($null -ne $quote.changePercent) { $quote.changePercent } elseif ($null -ne $quote.percent) { $quote.percent } else { $quote.change_percent }
      totalVolume = if ($null -ne $quote.totalVolume) { $quote.totalVolume } elseif ($null -ne $quote.tradeVolume) { $quote.tradeVolume } else { $quote.volume }
      tradeValue = if ($null -ne $quote.tradeValue) { $quote.tradeValue } else { $quote.totalTradeValue }
      bidVolume = $bid
      askVolume = $ask
      cumulativeBidVolume = $quote.cumulativeBidVolume
      cumulativeAskVolume = $quote.cumulativeAskVolume
      cumulativeBidAskVolume = $quote.cumulativeBidAskVolume
      stockType = if ($quote.stockType) { $quote.stockType } else { $quote.stock_type }
      session = $quote.session
      limitUpPrice = $quote.limitUpPrice
      limitDownPrice = $quote.limitDownPrice
      lastTradeTime = if ($quote.lastTradeTime) { $quote.lastTradeTime } else { $quote.last_trade_time }
      isHalted = $quote.isHalted
      isTrial = $quote.isTrial
      payload = @{
        source = if ($quote.source) { $quote.source } else { "fugle-websocket-quote-fast-flush" }
        channel = if ($Payload.channel) { $Payload.channel } else { "websocket:aggregates" }
        volume_unit = "lots"
        time_standard = "UTC"
        quote_seen_at = $seenAt
      }
    }
  }
}

$fugleApiKey = Read-TextSecret @(
  (Join-Path $RuntimeDir "secrets\fugle-api-key.txt"),
  (Join-Path $ScriptDir "..\..\secrets\fugle-api-key.txt")
)

$serviceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) {
  $serviceRoleKey = Read-TextSecret @(
    (Join-Path $RuntimeDir "secrets\supabase-service-role-key.txt"),
    (Join-Path $ScriptDir "..\..\secrets\supabase-service-role-key.txt")
  )
}
Initialize-SupabasePublicSlotSource -Url $ProjectUrl -ServiceRoleKey $serviceRoleKey
$stopAt = if ($StopAfterMinutes -gt 0) { (Get-Date).AddMinutes($StopAfterMinutes) } else { [datetime]::MaxValue }
Write-Log "quote fast flush started quotesFile=$QuotesFile loopSeconds=$LoopSeconds once=$Once requiredSeedSymbols=$($RequiredSeedSymbols -join ',')"

do {
  $started = Get-Date
  try {
    $payload = Read-JsonFile -Path $QuotesFile
    $quotes = @($payload.quotes)
    $seed = Add-RequiredQuoteSeeds -Quotes $quotes -Symbols $RequiredSeedSymbols -ApiKey $fugleApiKey
    $quotes = @($seed.quotes)
    $rows = @(Convert-FastQuoteRows -Quotes $quotes -Payload $payload)
    if ($rows.Count -gt 0) {
      Write-PublicSlotQuotesLive -Rows $rows
      $latestAt = ($rows | Sort-Object updated_at -Descending | Select-Object -First 1).updated_at
      $age = 999999
      try { $age = [int](((Get-Date).ToUniversalTime() - ([datetimeoffset]::Parse([string]$latestAt)).UtcDateTime).TotalSeconds) } catch {}
      Write-Log "quote-fast-flush rows=$($rows.Count) latest_at=$latestAt age_seconds=$age seed_attempted=$($seed.attempted) seed_fetched=$($seed.fetched)"
    } else {
      Write-Log "quote-fast-flush skipped rows=0"
    }
  } catch {
    Write-Log "ERROR quote-fast-flush $($_.Exception.Message)"
  }
  if ($Once) { break }
  $elapsed = [int]((Get-Date) - $started).TotalSeconds
  Start-Sleep -Seconds ([math]::Max(1, $LoopSeconds - $elapsed))
} while ((Get-Date) -lt $stopAt)

Write-Log "quote fast flush stopped"

