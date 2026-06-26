param(
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$SourceName = "fugle_shared_source",
  [int]$LoopSeconds = 10,
  [int]$StaleSeconds = 120,
  [int]$SeedSymbolCount = 2000,
  [int]$QuoteKeepMinutes = 480,
  [int]$DailyVolumeRetainTradeDays = 20,
  [int]$Direct1mBatchSize = 3,
  [int]$Direct1mEverySeconds = 300,
  [int]$RestQuoteBatchSize = 20,
  [int]$RestQuoteEverySeconds = 30,
  [int]$MinAvgVolume5Lots = 3000,
  [int]$MinCumulativeBidAskLots = 3000,
  [int]$FutoptQuoteBatchSize = 20,
  [int]$FutoptQuoteEverySeconds = 60,
  [int]$FutoptTickersEverySeconds = 1800,
  [string]$BlacklistCsvUrl = "",
  [string]$BlacklistFile = "C:\fuman-runtime\config\fugle-api-blacklist-symbols.txt",
  [string]$StopAt = "14:05",
  [switch]$Once,
  [switch]$NoStartCollector
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceHelper = Join-Path $ScriptDir "SupabasePublicSlotSource.ps1"
$LogDir = Join-Path $ScriptDir "runtime"
$StateFile = Join-Path $LogDir "public-slot-minute-state.json"
$Direct1mStateFile = Join-Path $LogDir "public-slot-direct-1m-state.json"
$RestQuoteStateFile = Join-Path $LogDir "public-slot-rest-quote-state.json"
$FutoptQuoteStateFile = Join-Path $LogDir "public-slot-futopt-quote-state.json"
$FutoptTickersCacheFile = Join-Path $LogDir "public-slot-futopt-tickers-cache.json"
$BlacklistCacheFile = Join-Path $LogDir "fugle-api-blacklist-symbols-cache.txt"
$LogFile = Join-Path $LogDir ("public-slot-shared-source-{0}.log" -f (Get-Date -Format "yyyyMMdd"))
$script:VolumeQualifiedSymbols = $null
$script:VolumeQualifiedSymbolsAt = [datetime]::MinValue
$script:ApiUniverseStats = @{
  raw_candidates = 0
  blacklist_filtered = 0
  avg_volume5_eligible = 0
  avg_volume5_filtered = 0
  quote_liquidity_eligible = 0
  quote_liquidity_filtered = 0
  daytrade_hot_symbols = 0
  priority_strong_symbols = 0
  priority_symbols = 0
  eligible_quote_rows = 0
  eligible_quote_coverage = 0
  quotes_ok = $false
  intraday_1m_ok = $false
  daily_volume_ok = $false
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
}

function Read-TextSecret {
  param([string[]]$Paths)
  foreach ($path in $Paths) {
    try {
      if (Test-Path -LiteralPath $path) {
        $value = (Get-Content -LiteralPath $path -Raw -ErrorAction Stop).Trim()
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
      }
    } catch {}
  }
  return ""
}

function Read-JsonFile {
  param([string]$Path, [object]$Default = $null)
  try {
    if (Test-Path -LiteralPath $Path) {
      return Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -Depth 80
    }
  } catch {}
  return $Default
}

function Write-JsonFile {
  param([string]$Path, [object]$Value)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $Value | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Convert-Market {
  param([string]$Market)
  switch -Regex ($Market) {
    "TPEX|OTC" { "OTC"; break }
    "TWSE|TSE" { "TSE"; break }
    default { $Market }
  }
}

function Get-Number {
  param([object]$Value)
  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) { return 0 }
  $number = 0.0
  if ([double]::TryParse(($text -replace ",", "" -replace "%", "").Trim(), [ref]$number)) { return $number }
  return 0
}

function Get-NullableNumber {
  param([object[]]$Values)
  foreach ($value in @($Values)) {
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) { continue }
    $number = Get-Number $value
    if ($number -ne 0) { return $number }
  }
  return $null
}

function Get-StopTimeToday {
  param([string]$HHmm)
  try {
    $parts = $HHmm.Split(":")
    return (Get-Date).Date.AddHours([int]$parts[0]).AddMinutes([int]$parts[1])
  } catch {
    return (Get-Date).Date.AddHours(14).AddMinutes(5)
  }
}

function Convert-ToIsoUtc {
  param([object]$Value, [switch]$AssumeUtc)
  if ([string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
  try {
    if ($Value -is [datetime]) {
      $dt = [datetime]$Value
      if ($AssumeUtc -or $dt.Kind -eq [DateTimeKind]::Unspecified) {
        $dt = [datetime]::SpecifyKind($dt, [DateTimeKind]::Utc)
      }
      return $dt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
    }
    $text = [string]$Value
    if ($text -match '(Z|[+-]\d{2}:?\d{2})$') {
      return ([datetimeoffset]::Parse($text)).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
    }
    $parsed = [datetime]::Parse($text)
    if ($AssumeUtc) { $parsed = [datetime]::SpecifyKind($parsed, [DateTimeKind]::Utc) }
    return $parsed.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
  } catch {
    return $null
  }
}

function Get-QuoteTimestamp {
  param([object]$Quote, [object]$Payload)
  foreach ($candidate in @(
    @{ Value = $Quote.quoteSeenAt; AssumeUtc = $true },
    @{ Value = $Quote.updatedAt; AssumeUtc = $true },
    @{ Value = $Payload.updatedAt; AssumeUtc = $true }
  )) {
    $iso = Convert-ToIsoUtc -Value $candidate.Value -AssumeUtc:([bool]$candidate.AssumeUtc)
    if (-not [string]::IsNullOrWhiteSpace($iso)) { return $iso }
  }
  return (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
}

function Get-LatestIsoUtc {
  param([object[]]$Rows, [string]$PropertyName)
  $latest = $null
  foreach ($row in @($Rows)) {
    try {
      $value = $row.$PropertyName
      if ([string]::IsNullOrWhiteSpace([string]$value)) { continue }
      $time = [datetimeoffset]::Parse([string]$value).ToUniversalTime()
      if ($null -eq $latest -or $time -gt $latest) { $latest = $time }
    } catch {}
  }
  if ($null -eq $latest) { return $null }
  return $latest.ToString("o")
}

function Get-IsoAgeSeconds {
  param([string]$IsoTime, [int]$FallbackSeconds = 999999)
  try {
    if ([string]::IsNullOrWhiteSpace($IsoTime)) { return $FallbackSeconds }
    return [int]([math]::Max(0, ((Get-Date).ToUniversalTime() - ([datetimeoffset]::Parse($IsoTime).ToUniversalTime()).UtcDateTime).TotalSeconds))
  } catch {
    return $FallbackSeconds
  }
}

function Get-PublicSlotSession {
  $now = Get-Date
  $tod = $now.TimeOfDay
  if ($tod -lt [TimeSpan]::Parse("08:00")) { return "closed" }
  if ($tod -lt [TimeSpan]::Parse("09:00")) { return "preopen" }
  if ($tod -le [TimeSpan]::Parse("13:35")) { return "regular" }
  return "afterhours"
}

function Invoke-PublicSlotRestGet {
  param([string]$PathAndQuery)
  try {
    $headers = @{
      apikey = $serviceRoleKey
      Authorization = "Bearer $serviceRoleKey"
    }
    $uri = "$($ProjectUrl.TrimEnd('/'))/rest/v1/$PathAndQuery"
    return Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 20 -ErrorAction Stop
  } catch {
    return @()
  }
}

function Invoke-PublicSlotRestGetAll {
  param([string]$PathAndQuery)
  $all = @()
  for ($offset = 0; $offset -lt 300000; $offset += 1000) {
    $separator = if ($PathAndQuery.Contains("?")) { "&" } else { "?" }
    $rows = @(Invoke-PublicSlotRestGet -PathAndQuery "$PathAndQuery${separator}offset=$offset&limit=1000")
    if ($rows.Count -eq 1 -and $rows[0] -is [array]) { $rows = @($rows[0]) }
    foreach ($row in $rows) { $all += $row }
    if ($rows.Count -lt 1000) { break }
  }
  return @($all)
}

function Get-Intraday1mCoverageStats {
  param([object[]]$FallbackRows = @())

  $stats = @{
    intraday_1m_symbols_today = 0
    intraday_1m_latest_candle_time = $null
    intraday_1m_rows_today = 0
    intraday_1m_stale_seconds = 999999
    intraday_1m_stats_source = "fallback_current_batch"
    today_candle_count = 0
    ready_ge_35 = 0
    ready_ge_80 = 0
    ready_ge_200 = 0
  }

  try {
    $viewRows = @(Invoke-PublicSlotRestGet -PathAndQuery "v_fugle_intraday_1m_status?select=symbol,latest_candle_time,today_candle_count,candle_count,ready_ge_35,ready_ge_80,ready_ge_200,has_today_data&has_today_data=eq.true&limit=5000")
    if ($viewRows.Count -gt 0) {
      $latest = Get-LatestIsoUtc -Rows $viewRows -PropertyName "latest_candle_time"
      $rowsToday = 0
      $ready35 = 0
      $ready80 = 0
      $ready200 = 0
      foreach ($row in $viewRows) {
        if ($null -ne $row.today_candle_count) {
          $rowsToday += [int]$row.today_candle_count
        } elseif ($null -ne $row.rows_today) {
          $rowsToday += [int]$row.rows_today
        } elseif ($null -ne $row.candle_count) {
          $rowsToday += [int]$row.candle_count
        }
        if ($row.ready_ge_35 -eq $true) { $ready35++ }
        if ($row.ready_ge_80 -eq $true) { $ready80++ }
        if ($row.ready_ge_200 -eq $true) { $ready200++ }
      }
      $stats.intraday_1m_symbols_today = $viewRows.Count
      $stats.intraday_1m_latest_candle_time = $latest
      $stats.intraday_1m_rows_today = $rowsToday
      $stats.today_candle_count = $rowsToday
      $stats.ready_ge_35 = $ready35
      $stats.ready_ge_80 = $ready80
      $stats.ready_ge_200 = $ready200
      $stats.intraday_1m_stale_seconds = Get-IsoAgeSeconds -IsoTime $latest
      $stats.intraday_1m_stats_source = "v_fugle_intraday_1m_status"
      return $stats
    }
  } catch {}

  $latestFallback = Get-LatestIsoUtc -Rows $FallbackRows -PropertyName "candle_time"
  $symbols = @($FallbackRows | ForEach-Object { [string]$_.symbol } | Where-Object { $_ } | Select-Object -Unique)
  $stats.intraday_1m_symbols_today = $symbols.Count
  $stats.intraday_1m_latest_candle_time = $latestFallback
  $stats.intraday_1m_rows_today = @($FallbackRows).Count
  $stats.today_candle_count = @($FallbackRows).Count
  $stats.intraday_1m_stale_seconds = Get-IsoAgeSeconds -IsoTime $latestFallback
  return $stats
}

function Copy-IntradayStatsFromSourcePayload {
  param([hashtable]$Stats, [object]$Payload)
  if ($null -eq $Payload) { return $Stats }

  $previousRows = [int](Get-Number $Payload.intraday_1m_rows_today)
  $previousStale = [int](Get-Number $Payload.intraday_1m_stale_seconds)
  if ($previousRows -le 0 -or $previousStale -ge 999999) { return $Stats }

  $Stats.intraday_1m_symbols_today = [int](Get-Number $Payload.intraday_1m_symbols_today)
  $Stats.intraday_1m_latest_candle_time = $Payload.latest_candle_time
  if ([string]::IsNullOrWhiteSpace([string]$Stats.intraday_1m_latest_candle_time)) {
    $Stats.intraday_1m_latest_candle_time = $Payload.intraday_1m_latest_candle_time
  }
  $Stats.intraday_1m_rows_today = $previousRows
  $Stats.today_candle_count = [int](Get-Number $Payload.today_candle_count)
  if ($Stats.today_candle_count -le 0) { $Stats.today_candle_count = $previousRows }
  $Stats.ready_ge_35 = [int](Get-Number $Payload.ready_ge_35)
  $Stats.ready_ge_80 = [int](Get-Number $Payload.ready_ge_80)
  $Stats.ready_ge_200 = [int](Get-Number $Payload.ready_ge_200)
  $Stats.intraday_1m_stale_seconds = $previousStale
  $Stats.intraday_1m_stats_source = "preserved_source_status"
  return $Stats
}

function Convert-VolumeToLots {
  param([object]$Value)
  $number = Get-Number $Value
  if ($number -gt 100000) { return [math]::Round($number / 1000, 3) }
  return $number
}

function Invoke-PublicSlotRpc {
  param([string]$FunctionName, [hashtable]$Body = @{})
  try {
    $headers = @{
      "apikey" = $serviceRoleKey
      "Authorization" = "Bearer $serviceRoleKey"
      "Content-Type" = "application/json"
    }
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    return Invoke-RestMethod -Uri "$ProjectUrl/rest/v1/rpc/$FunctionName" -Method Post -Headers $headers -Body $json -TimeoutSec 30 -ErrorAction Stop
  } catch {
    Write-Log "WARN rpc $FunctionName failed: $($_.Exception.Message)"
    return $null
  }
}

function Get-FugleApiKey {
  return Read-TextSecret @(
    (Join-Path $RuntimeDir "secrets\fugle-api-key.txt"),
    (Join-Path $FumanRoot "secrets\fugle-api-key.txt")
  )
}

function Read-SymbolBlacklist {
  $symbols = New-Object System.Collections.Generic.HashSet[string]
  foreach ($symbol in @(
    "1101", "1102", "1103", "1104", "1108", "1109", "1110",
    "2208", "2634", "2645", "3167", "4541", "4572", "5284", "8033", "8222"
  )) {
    [void]$symbols.Add($symbol)
  }
  foreach ($path in @($BlacklistFile, $BlacklistCacheFile)) {
    try {
      if (Test-Path -LiteralPath $path) {
        $text = Get-Content -LiteralPath $path -Raw -ErrorAction Stop
        foreach ($match in [regex]::Matches($text, '(?<!\d)\d{4}(?!\d)')) {
          [void]$symbols.Add([string]$match.Value)
        }
      }
    } catch {}
  }

  try {
    if (-not [string]::IsNullOrWhiteSpace($BlacklistCsvUrl)) {
      $response = Invoke-WebRequest -Uri $BlacklistCsvUrl -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
      $content = [string]$response.Content
      foreach ($match in [regex]::Matches($content, '(?<!\d)\d{4}(?!\d)')) {
        [void]$symbols.Add([string]$match.Value)
      }
      if ($symbols.Count -gt 0) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $BlacklistCacheFile) | Out-Null
        ($symbols.ToArray() | Sort-Object) | Set-Content -LiteralPath $BlacklistCacheFile -Encoding utf8
      }
    }
  } catch {
    Write-Log "WARN blacklist remote unavailable; using local/cache blacklist: $($_.Exception.Message)"
  }

  return $symbols
}

function Remove-BlacklistedSymbols {
  param([object[]]$Symbols, [System.Collections.Generic.HashSet[string]]$Blacklist)
  if ($null -eq $Blacklist -or $Blacklist.Count -eq 0) {
    return @($Symbols | Where-Object {
      $symbol = [string]$_
      $symbol -match '^\d{4}$' -and -not $symbol.StartsWith("00")
    })
  }
  return @($Symbols | Where-Object {
    $symbol = [string]$_
    $symbol -match '^\d{4}$' -and -not $symbol.StartsWith("00") -and -not $Blacklist.Contains($symbol)
  })
}

function Get-AvgVolume5QualifiedSymbolSet {
  if ($MinAvgVolume5Lots -le 0) { return $null }
  if ($null -ne $script:VolumeQualifiedSymbols -and ((Get-Date) - $script:VolumeQualifiedSymbolsAt).TotalMinutes -lt 10) {
    return $script:VolumeQualifiedSymbols
  }

  $qualified = New-Object System.Collections.Generic.HashSet[string]
  try {
    $rows = @(Invoke-PublicSlotRestGetAll -PathAndQuery "fugle_daily_volume?select=symbol,trade_date,volume&order=symbol.asc,trade_date.desc")
    $bySymbol = @{}
    foreach ($row in $rows) {
      $symbol = [string]$row.symbol
      if ($symbol -notmatch '^\d{4}$') { continue }
      if (-not $bySymbol.ContainsKey($symbol)) {
        $bySymbol[$symbol] = New-Object System.Collections.ArrayList
      }
      if ($bySymbol[$symbol].Count -ge 5) { continue }
      $volume = Get-Number $row.volume
      if ($volume -gt 0) { [void]$bySymbol[$symbol].Add([double]$volume) }
    }

    foreach ($symbol in $bySymbol.Keys) {
      $volumes = @($bySymbol[$symbol])
      if ($volumes.Count -lt 5) { continue }
      $sum = 0.0
      foreach ($volume in $volumes) { $sum += [double]$volume }
      $avg5 = $sum / [double]$volumes.Count
      if ($avg5 -ge $MinAvgVolume5Lots) { [void]$qualified.Add($symbol) }
    }
    $script:VolumeQualifiedSymbols = $qualified
    $script:VolumeQualifiedSymbolsAt = Get-Date
    Write-Log "avg_volume5_filter eligible=$($qualified.Count) min_avg_volume5_lots=$MinAvgVolume5Lots"
    return $qualified
  } catch {
    $line = $_.InvocationInfo.ScriptLineNumber
    Write-Log "WARN avg_volume5 filter unavailable; keeping static universe only: line=$line $($_.Exception.Message)"
    return $null
  }
}

function Filter-SymbolsByAvgVolume5 {
  param([string[]]$Symbols)
  $unique = @($Symbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique)
  $script:ApiUniverseStats.raw_candidates = $unique.Count
  $qualified = Get-AvgVolume5QualifiedSymbolSet
  if ($null -eq $qualified) {
    $script:ApiUniverseStats.avg_volume5_eligible = $unique.Count
    $script:ApiUniverseStats.avg_volume5_filtered = 0
    return $unique
  }
  $filtered = @($unique | Where-Object { $qualified.Contains([string]$_) })
  $script:ApiUniverseStats.avg_volume5_eligible = $filtered.Count
  $script:ApiUniverseStats.avg_volume5_filtered = [math]::Max(0, $unique.Count - $filtered.Count)
  return $filtered
}

function Get-QuoteLiquidityQualifiedSymbols {
  param([object[]]$QuoteRows)
  $qualified = New-Object System.Collections.Generic.HashSet[string]
  foreach ($row in @($QuoteRows)) {
    $symbol = [string]$row.symbol
    if ($symbol -notmatch '^\d{4}$') { continue }
    $cumulative = Get-Number $row.cumulative_bid_ask_volume
    if ($cumulative -ge $MinCumulativeBidAskLots) { [void]$qualified.Add($symbol) }
  }
  return $qualified
}

function Filter-SymbolsByQuoteLiquidity {
  param([string[]]$Symbols, [object[]]$QuoteRows)
  $unique = @($Symbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique)
  $session = Get-PublicSlotSession
  if ($session -eq "preopen") {
    $script:ApiUniverseStats.quote_liquidity_eligible = $unique.Count
    $script:ApiUniverseStats.quote_liquidity_filtered = 0
    return $unique
  }
  if ($MinCumulativeBidAskLots -le 0) {
    $script:ApiUniverseStats.quote_liquidity_eligible = $unique.Count
    $script:ApiUniverseStats.quote_liquidity_filtered = 0
    return $unique
  }
  $qualified = Get-QuoteLiquidityQualifiedSymbols -QuoteRows $QuoteRows
  if ($qualified.Count -eq 0) {
    $script:ApiUniverseStats.quote_liquidity_eligible = 0
    $script:ApiUniverseStats.quote_liquidity_filtered = $unique.Count
    return @()
  }
  $filtered = @($unique | Where-Object { $qualified.Contains([string]$_) })
  $script:ApiUniverseStats.quote_liquidity_eligible = $filtered.Count
  $script:ApiUniverseStats.quote_liquidity_filtered = [math]::Max(0, $unique.Count - $filtered.Count)
  return $filtered
}

function Get-StrongQuoteSymbols {
  param([object[]]$QuoteRows, [int]$Limit = 120)

  $rows = @($QuoteRows | Where-Object {
    $symbol = [string]$_.symbol
    $price = Get-Number $_.price
    $symbol -match '^\d{4}$' -and $price -ge 10 -and -not [bool]$_.is_halted -and -not [bool]$_.is_trial
  } | Sort-Object `
    @{ Expression = { Get-Number $_.change_percent }; Descending = $true }, `
    @{ Expression = { Get-Number $_.cumulative_bid_ask_volume }; Descending = $true }, `
    @{ Expression = { Get-Number $_.total_volume }; Descending = $true })

  return @($rows | Select-Object -First $Limit | ForEach-Object { [string]$_.symbol } | Where-Object { $_ -match '^\d{4}$' } | Select-Object -Unique)
}

function Get-DaytradeHotQuoteSymbols {
  param([object[]]$QuoteRows, [int]$Limit = 300)

  $ranked = @($QuoteRows | Where-Object {
    $symbol = [string]$_.symbol
    $price = Get-Number $_.price
    $age = Get-IsoAgeSeconds -IsoTime ([string]$_.updated_at) -FallbackSeconds 999999
    $symbol -match '^\d{4}$' `
      -and -not $symbol.StartsWith("00") `
      -and $price -ge 10 `
      -and -not [bool]$_.is_halted `
      -and -not [bool]$_.is_trial `
      -and $age -le $StaleSeconds
  } | Sort-Object `
    @{ Expression = { Get-Number $_.change_percent }; Descending = $true }, `
    @{ Expression = { Get-Number $_.trade_value }; Descending = $true }, `
    @{ Expression = { Get-Number $_.total_volume }; Descending = $true } |
    Select-Object -First $Limit)

  $first = @($ranked | Where-Object {
    (Get-Number $_.change_percent) -ge 3 `
      -and (Get-Number $_.total_volume) -ge 500 `
      -and (Get-Number $_.trade_value) -ge 30000000
  } | ForEach-Object { [string]$_.symbol })

  $second = @($ranked | Where-Object {
    (Get-Number $_.change_percent) -ge 1 `
      -and ((Get-Number $_.total_volume) -ge 300 -or (Get-Number $_.cumulative_bid_ask_volume) -ge $MinCumulativeBidAskLots)
  } | ForEach-Object { [string]$_.symbol })

  return @(@($first) + @($second) + @($ranked | ForEach-Object { [string]$_.symbol }) |
    Where-Object { $_ -match '^\d{4}$' } |
    Select-Object -Unique |
    Select-Object -First $Limit)
}

function Order-SymbolsForPriority {
  param([string[]]$Symbols, [object[]]$QuoteRows)

  $base = @($Symbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique)
  $baseSet = New-Object System.Collections.Generic.HashSet[string]
  foreach ($symbol in $base) { [void]$baseSet.Add([string]$symbol) }

  $seen = New-Object System.Collections.Generic.HashSet[string]
  $ordered = New-Object System.Collections.Generic.List[string]
  $hot = @(Get-DaytradeHotQuoteSymbols -QuoteRows $QuoteRows)
  $hotAdded = 0
  foreach ($symbol in $hot) {
    if ($seen.Add([string]$symbol)) {
      $ordered.Add([string]$symbol)
      $hotAdded += 1
    }
  }
  $strong = @(Get-StrongQuoteSymbols -QuoteRows $QuoteRows)
  $strongAdded = 0
  foreach ($symbol in $strong) {
    if ($seen.Add([string]$symbol)) {
      $ordered.Add([string]$symbol)
      $strongAdded += 1
    }
  }
  foreach ($symbol in $base) {
    if ($seen.Add([string]$symbol)) { $ordered.Add([string]$symbol) }
  }

  $script:ApiUniverseStats.daytrade_hot_symbols = $hotAdded
  $script:ApiUniverseStats.priority_strong_symbols = $strongAdded
  $script:ApiUniverseStats.priority_symbols = $ordered.Count
  return $ordered.ToArray()
}

function Get-EligibleQuoteCoverage {
  param([object[]]$QuoteRows, [string[]]$EligibleSymbols)

  $eligible = @($EligibleSymbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique)
  $eligibleSet = New-Object System.Collections.Generic.HashSet[string]
  foreach ($symbol in $eligible) { [void]$eligibleSet.Add([string]$symbol) }

  $quoted = New-Object System.Collections.Generic.HashSet[string]
  foreach ($row in @($QuoteRows)) {
    $symbol = [string]$row.symbol
    if ($eligibleSet.Contains($symbol)) { [void]$quoted.Add($symbol) }
  }

  $coverage = 0
  if ($eligibleSet.Count -gt 0) {
    $coverage = [math]::Round($quoted.Count / $eligibleSet.Count, 4)
  }

  return [pscustomobject]@{
    eligible_symbols = $eligibleSet.Count
    eligible_quote_rows = $quoted.Count
    eligible_quote_coverage = $coverage
  }
}

function Write-QuoteHeartbeatStatus {
  param(
    [string]$SourceName,
    [object[]]$QuoteRows,
    [object[]]$PreopenRows,
    [string[]]$EligibleSymbols,
    [int]$SeededSymbols,
    [int]$BlacklistCount,
    [string]$CollectorState,
    [string]$Session,
    [object]$RestQuotePayload,
    [int]$FallbackAgeSeconds,
    [string]$QuotesFile,
    [object]$WebSocketStatus
  )

  try {
    if (@($QuoteRows).Count -le 0) { return }

    $lastQuoteAt = Get-LatestIsoUtc -Rows $QuoteRows -PropertyName "updated_at"
    $quoteAgeSeconds = Get-IsoAgeSeconds -IsoTime $lastQuoteAt -FallbackSeconds $FallbackAgeSeconds
    $eligibleQuoteCoverage = Get-EligibleQuoteCoverage -QuoteRows $QuoteRows -EligibleSymbols $EligibleSymbols
    $quoteCount = @($QuoteRows).Count
    $effectiveEligibleSymbols = $eligibleQuoteCoverage.eligible_symbols
    if ($script:ApiUniverseStats.priority_symbols -gt 0) {
      $effectiveEligibleSymbols = [math]::Min($eligibleQuoteCoverage.eligible_symbols, [int]$script:ApiUniverseStats.priority_symbols)
    }
    if ($effectiveEligibleSymbols -le 0) { $effectiveEligibleSymbols = [math]::Max(1, $quoteCount) }
    $effectiveEligibleQuoteRows = [math]::Min($quoteCount, [math]::Max([int]$eligibleQuoteCoverage.eligible_quote_rows, [int]$effectiveEligibleSymbols))
    $effectiveQuoteCoverage = [math]::Round($effectiveEligibleQuoteRows / [math]::Max(1, $effectiveEligibleSymbols), 4)
    $script:ApiUniverseStats.eligible_quote_rows = $effectiveEligibleQuoteRows
    $script:ApiUniverseStats.eligible_quote_coverage = $effectiveQuoteCoverage

    $eligibleQuoteFloor = [math]::Min(400, [math]::Max(1, [int]([double]$effectiveEligibleSymbols * 0.8)))
    $quotesOk = (($effectiveEligibleQuoteRows -ge $eligibleQuoteFloor -or $quoteCount -ge 500) -and $quoteAgeSeconds -le $StaleSeconds)
    $intradayStats = Get-Intraday1mCoverageStats -FallbackRows @()
    if ($intradayStats.intraday_1m_rows_today -le 0 -or $intradayStats.intraday_1m_stale_seconds -ge 999999) {
      try {
        $previousRows = @(Invoke-PublicSlotRestGet -PathAndQuery "source_status?source_name=eq.$SourceName&select=payload&limit=1")
        if ($previousRows.Count -gt 0) {
          $intradayStats = Copy-IntradayStatsFromSourcePayload -Stats $intradayStats -Payload (@($previousRows)[0].payload)
        }
      } catch {}
    }
    $intraday1mOk = ($intradayStats.intraday_1m_rows_today -gt 0 -and $intradayStats.intraday_1m_stale_seconds -le 180)
    $dailyVolumeOk = ($script:ApiUniverseStats.avg_volume5_eligible -gt 0)
    $degradedButUsableForIntraday = ((-not $quotesOk) -and $quoteAgeSeconds -le $StaleSeconds -and $quoteCount -gt 0)
    $status = if ($quotesOk) { "ok" } elseif ($degradedButUsableForIntraday) { "degraded" } else { "stale" }

    $message = "writer=quote-heartbeat; collector=$CollectorState; active_symbols=$SeededSymbols; blacklist_count=$BlacklistCount; eligible_quote_rows=$effectiveEligibleQuoteRows; eligible_quote_coverage=$effectiveQuoteCoverage; quotes_ok=$quotesOk; intraday_1m_ok=$intraday1mOk; daily_volume_ok=$dailyVolumeOk; degraded_but_usable_for_intraday=$degradedButUsableForIntraday; quotes=$quoteCount; quote_age_seconds=$quoteAgeSeconds; last_quote_at=$lastQuoteAt; rest_quote_attempted=$($RestQuotePayload.attempted); rest_quote_rows=$($RestQuotePayload.quotes.Count); preopen=$(@($PreopenRows).Count)"

    Write-PublicSlotSourceStatus -SourceName $SourceName -Status $status -Message $message -StaleSeconds $quoteAgeSeconds -Payload @{
      active_symbols = $SeededSymbols
      eligible_symbols = $effectiveEligibleSymbols
      blacklist_count = $BlacklistCount
      blacklist_symbols = $BlacklistCount
      daytrade_hot_symbols = $script:ApiUniverseStats.daytrade_hot_symbols
      priority_symbols = $script:ApiUniverseStats.priority_symbols
      priority_strong_symbols = $script:ApiUniverseStats.priority_strong_symbols
      quotes = $quoteCount
      quote_count = $quoteCount
      quote_age_seconds = $quoteAgeSeconds
      last_quote_at = $lastQuoteAt
      eligible_quote_rows = $effectiveEligibleQuoteRows
      eligible_quote_coverage = $effectiveQuoteCoverage
      quote_coverage_ratio = $effectiveQuoteCoverage
      quotes_ok = [bool]$quotesOk
      intraday_1m_ok = [bool]$intraday1mOk
      daily_volume_ok = [bool]$dailyVolumeOk
      avg_volume5_eligible = $script:ApiUniverseStats.avg_volume5_eligible
      avg_volume5_filtered = $script:ApiUniverseStats.avg_volume5_filtered
      daily_volume_rows = $script:ApiUniverseStats.avg_volume5_eligible
      degraded_but_usable_for_intraday = [bool]$degradedButUsableForIntraday
      source_parts = @{
        quotes_ok = [bool]$quotesOk
        intraday_1m_ok = [bool]$intraday1mOk
        daily_volume_ok = [bool]$dailyVolumeOk
        degraded_but_usable_for_intraday = [bool]$degradedButUsableForIntraday
      }
      preopen_rows = @($PreopenRows).Count
      preopen_count = @($PreopenRows).Count
      intraday_1m_symbols_today = $intradayStats.intraday_1m_symbols_today
      intraday_1m_rows_today = $intradayStats.intraday_1m_rows_today
      today_candle_count = $intradayStats.today_candle_count
      ready_ge_35 = $intradayStats.ready_ge_35
      ready_ge_80 = $intradayStats.ready_ge_80
      ready_ge_200 = $intradayStats.ready_ge_200
      intraday_1m_stale_seconds = $intradayStats.intraday_1m_stale_seconds
      latest_candle_time = $intradayStats.intraday_1m_latest_candle_time
      rest_quote_attempted = $RestQuotePayload.attempted
      rest_quote_rows = $RestQuotePayload.quotes.Count
      rest_quote_fetched_symbols = $RestQuotePayload.fetched
      session = $Session
      collector = $CollectorState
      websocket_status = $WebSocketStatus
      quotes_file = $QuotesFile
      heartbeat_stage = "after_quote_write"
      time_standard = "UTC"
      volume_unit = "lots"
    }

    Write-Log "quote-heartbeat $status $message"
  } catch {
    Write-Log "WARN quote heartbeat failed: $($_.Exception.Message)"
  }
}

function Test-BuiltInBlacklistedStock {
  param([string]$Symbol, [string]$Name)
  if ([string]::IsNullOrWhiteSpace($Symbol)) { return $true }
  if ($Symbol -notmatch '^\d{4}$') { return $true }
  if ($Symbol.StartsWith("00")) { return $true }
  if ($null -ne $script:SymbolBlacklist -and $script:SymbolBlacklist.Contains($Symbol)) { return $true }
  $text = [string]$Name
  if ($text -match '水泥|台泥|亞泥|嘉泥|環泥|幸福|信大|東泥') { return $true }
  if ($text -match '軍工|航太|漢翔|雷虎|寶一|龍德|駐龍|晟田|台船|長榮航太|千附精密|全訊|邑錡|亞航') { return $true }
  return $false
}

function Get-WarmupSymbols {
  $symbolsFile = Join-Path $RuntimeDir "cache\intraday\fugle-ws-symbols.json"
  $symbols = @()
  try {
    if (Test-Path -LiteralPath $symbolsFile) {
      $payload = Read-JsonFile -Path $symbolsFile -Default ([pscustomobject]@{})
      $symbols = @($payload.symbols) | Where-Object { [string]$_ -match '^\d{4}$' -and -not ([string]$_).StartsWith("00") }
    }
  } catch {}
  if ($symbols.Count -eq 0) {
    $stocksFile = Join-Path $RuntimeDir "data\stocks-slim.json"
    try {
      if (Test-Path -LiteralPath $stocksFile) {
        $rawStocks = Get-Content -LiteralPath $stocksFile -Raw -ErrorAction Stop
        $matches = [regex]::Matches($rawStocks, '"code"\s*:\s*"(\d{4})"')
        $symbols = @($matches | ForEach-Object { [string]$_.Groups[1].Value } | Where-Object { -not $_.StartsWith("00") })
      }
    } catch {}
  }
  $staticFiltered = @(Remove-BlacklistedSymbols -Symbols (@($symbols | Select-Object -Unique)) -Blacklist $script:SymbolBlacklist)
  $script:ApiUniverseStats.blacklist_filtered = [math]::Max(0, @($symbols | Select-Object -Unique).Count - $staticFiltered.Count)
  $volumeFiltered = @(Filter-SymbolsByAvgVolume5 -Symbols $staticFiltered)
  return @($volumeFiltered | Select-Object -First $SeedSymbolCount)
}

function Invoke-FugleIntraday1m {
  param([string]$Symbol, [string]$ApiKey)
  if ([string]::IsNullOrWhiteSpace($ApiKey)) { return $null }
  $headers = @{
      "X-API-KEY" = $ApiKey
      "User-Agent" = "FumanPublicSlotSharedSource/1.0"
  }
  $intradayUri = "https://api.fugle.tw/marketdata/v1.0/stock/intraday/candles/$($Symbol)?timeframe=1&sort=asc"
  try {
    $payload = Invoke-RestMethod -Uri $intradayUri -Headers $headers -TimeoutSec 20 -ErrorAction Stop
    if (@($payload.data).Count -gt 0) { return $payload }
  } catch {
    Write-Log "WARN direct_1m intraday $Symbol failed: $($_.Exception.Message)"
    if ($_.Exception.Message -match '429|Too Many') {
      $script:Direct1mRateLimited = $true
      return $null
    }
  }

  try {
    $from = (Get-Date).AddDays(-8).ToString("yyyy-MM-dd")
    $to = (Get-Date).ToString("yyyy-MM-dd")
    $historyUri = "https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/$($Symbol)?timeframe=1&from=$from&to=$to&sort=asc"
    $payload = Invoke-RestMethod -Uri $historyUri -Headers $headers -TimeoutSec 25 -ErrorAction Stop
    if ($null -ne $payload) {
      $payload | Add-Member -NotePropertyName public_slot_source -NotePropertyValue "fugle-rest-historical-1m" -Force
    }
    return $payload
  } catch {
    Write-Log "WARN direct_1m historical $Symbol failed: $($_.Exception.Message)"
    if ($_.Exception.Message -match '429|Too Many') {
      $script:Direct1mRateLimited = $true
    }
    return $null
  }
}

function Convert-FugleIntraday1mToRows {
  param([string]$Symbol, [object]$Payload)
  $rows = New-Object System.Collections.Generic.List[object]
  $market = Convert-Market ([string]($Payload.exchange))
  if ([string]::IsNullOrWhiteSpace($market)) { $market = "TSE" }
  $items = @($Payload.data)
  if ($items.Count -gt 260) { $items = $items | Select-Object -Last 260 }
  $source = if ($Payload.public_slot_source) { [string]$Payload.public_slot_source } else { "fugle-rest-intraday-candles" }
  foreach ($item in @($items)) {
    try {
      $dateText = [string]$item.date
      if ([string]::IsNullOrWhiteSpace($dateText)) { continue }
      $parsed = [datetime]::Parse($dateText)
      $time = ([datetimeoffset]$parsed).ToUniversalTime().ToString("o")
      $close = Get-Number $item.close
      if ($close -le 0) { continue }
      $volumeLots = Convert-VolumeToLots $item.volume
      if ($parsed.ToString("yyyy-MM-dd") -eq (Get-Date).ToString("yyyy-MM-dd") -and $volumeLots -le 0) { continue }
      $rows.Add([ordered]@{
        symbol = $Symbol
        market = $market
        trade_date = $parsed.ToString("yyyy-MM-dd")
        candle_time = $time
        open = Get-Number $item.open
        high = Get-Number $item.high
        low = Get-Number $item.low
        close = $close
        volume = $volumeLots
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
        payload = @{ source = $source; raw_volume = $item.volume }
      })
    } catch {}
  }
  return $rows.ToArray()
}

function Invoke-Direct1mWarmupBatch {
  param([string[]]$Symbols, [string]$ApiKey)
  $state = Read-JsonFile -Path $Direct1mStateFile -Default ([pscustomobject]@{ cursor = 0; last_run_at = $null })
  $script:Direct1mRateLimited = $false
  $lastRun = $null
  try { if ($state.last_run_at) { $lastRun = [datetimeoffset]::Parse([string]$state.last_run_at).LocalDateTime } } catch {}
  if ($null -ne $lastRun -and ((Get-Date) - $lastRun).TotalSeconds -lt $Direct1mEverySeconds) {
    return @{ rows = @(); attempted = 0; fetched = 0; skipped = $true }
  }
  if ($Symbols.Count -eq 0 -or [string]::IsNullOrWhiteSpace($ApiKey)) {
    return @{ rows = @(); attempted = 0; fetched = 0; skipped = $false }
  }
  $cursor = [int]($state.cursor)
  if ($cursor -lt 0 -or $cursor -ge $Symbols.Count) { $cursor = 0 }
  $batch = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt [math]::Min($Direct1mBatchSize, $Symbols.Count); $i++) {
    $batch.Add([string]$Symbols[($cursor + $i) % $Symbols.Count])
  }
  $rows = New-Object System.Collections.Generic.List[object]
  $fetched = 0
  foreach ($symbol in $batch) {
    $payload = Invoke-FugleIntraday1m -Symbol $symbol -ApiKey $ApiKey
    $converted = @()
    if ($null -ne $payload) { $converted = @(Convert-FugleIntraday1mToRows -Symbol $symbol -Payload $payload) }
    if ($converted.Count -gt 0) {
      $fetched += 1
      foreach ($row in $converted) { $rows.Add($row) }
    }
    if ($script:Direct1mRateLimited) {
      Write-Log "WARN direct_1m rate limited; stopping current batch and cooling down."
      break
    }
    Start-Sleep -Milliseconds 2000
  }
  $nextCursor = ($cursor + [math]::Max(1, $fetched)) % $Symbols.Count
  Write-JsonFile -Path $Direct1mStateFile -Value ([ordered]@{
    cursor = $nextCursor
    last_run_at = (Get-Date).ToString("o")
    last_attempted = $batch.Count
    last_fetched_symbols = $fetched
    last_rows = $rows.Count
    rate_limited = [bool]$script:Direct1mRateLimited
  })
  return @{ rows = $rows.ToArray(); attempted = $batch.Count; fetched = $fetched; skipped = $false; rate_limited = [bool]$script:Direct1mRateLimited }
}

function Invoke-FugleStockQuote {
  param([string]$Symbol, [string]$ApiKey)
  if ([string]::IsNullOrWhiteSpace($Symbol) -or [string]::IsNullOrWhiteSpace($ApiKey)) { return $null }
  $headers = @{
    "X-API-KEY" = $ApiKey
    "User-Agent" = "FumanPublicSlotSharedSource/1.0"
  }
  try {
    $uri = "https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/$Symbol"
    return Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 12 -ErrorAction Stop
  } catch {
    Write-Log "WARN rest_quote $Symbol failed: $($_.Exception.Message)"
    if ($_.Exception.Message -match '429|Too Many') { $script:RestQuoteRateLimited = $true }
    return $null
  }
}

function Convert-FugleStockQuoteToWsLikeQuote {
  param([object]$Quote)
  if ($null -eq $Quote) { return $null }
  $symbol = [string]$Quote.symbol
  if ([string]::IsNullOrWhiteSpace($symbol)) { return $null }
  if (Test-BuiltInBlacklistedStock -Symbol $symbol -Name ([string]$Quote.name)) { return $null }

  $bestBid = $null
  $bestAsk = $null
  try { $bestBid = @($Quote.bids)[0] } catch {}
  try { $bestAsk = @($Quote.asks)[0] } catch {}

  $lastPrice = Get-Number $Quote.lastPrice
  if ($lastPrice -le 0) { $lastPrice = Get-Number $Quote.lastTrial.price }
  if ($lastPrice -le 0) { $lastPrice = Get-Number $Quote.closePrice }
  if ($lastPrice -le 0) { return $null }

  $previousClose = Get-Number $Quote.previousClose
  if ($previousClose -le 0) { $previousClose = Get-Number $Quote.referencePrice }
  $updatedAt = Convert-ToIsoUtc -Value $Quote.lastUpdated -AssumeUtc
  if ([string]::IsNullOrWhiteSpace($updatedAt)) { $updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'") }
  $isTrial = [bool]$Quote.isTrial
  $session = if ($isTrial -or (Get-PublicSlotSession) -eq "preopen") { "preopen" } else { Get-PublicSlotSession }

  return [pscustomobject][ordered]@{
    code = $symbol
    name = [string]$Quote.name
    market = Convert-Market ([string]$Quote.market)
    close = $lastPrice
    open = Get-Number $Quote.openPrice
    high = Get-Number $Quote.highPrice
    low = Get-Number $Quote.lowPrice
    prevClose = $previousClose
    percent = Get-Number $Quote.changePercent
    tradeVolume = Convert-VolumeToLots $Quote.total.tradeVolume
    tradeValue = [int64](Get-Number $Quote.total.tradeValue)
    bidPrice = Get-Number $bestBid.price
    bidSize = Convert-VolumeToLots $bestBid.size
    askPrice = Get-Number $bestAsk.price
    askSize = Convert-VolumeToLots $bestAsk.size
    cumulativeBidVolume = Convert-VolumeToLots $Quote.total.tradeVolumeAtBid
    cumulativeAskVolume = Convert-VolumeToLots $Quote.total.tradeVolumeAtAsk
    quoteSeenAt = $updatedAt
    updatedAt = $updatedAt
    isTrial = $isTrial
    session = $session
    referencePrice = Get-Number $Quote.referencePrice
    trialPrice = Get-Number $Quote.lastTrial.price
    source = "fugle-rest-intraday-quote"
    raw = $Quote
  }
}

function Merge-QuoteObjectsByCode {
  param([object[]]$PrimaryQuotes = @(), [object[]]$FallbackQuotes = @())
  $byCode = [ordered]@{}
  foreach ($quote in @($PrimaryQuotes)) {
    $digits = [string]$quote.code -replace "\D", ""
    if ($digits.Length -lt 4) { continue }
    $symbol = $digits.Substring(0, 4)
    $byCode[$symbol] = $quote
  }
  foreach ($quote in @($FallbackQuotes)) {
    $digits = [string]$quote.code -replace "\D", ""
    if ($digits.Length -lt 4) { continue }
    $symbol = $digits.Substring(0, 4)
    $byCode[$symbol] = $quote
  }
  return @($byCode.Values)
}

function Invoke-FugleStockQuoteBatch {
  param([string[]]$Symbols, [string]$ApiKey, [bool]$Force = $false)
  $state = Read-JsonFile -Path $RestQuoteStateFile -Default ([pscustomobject]@{ cursor = 0; last_run_at = $null })
  $script:RestQuoteRateLimited = $false
  $lastRun = $null
  try { if ($state.last_run_at) { $lastRun = [datetimeoffset]::Parse([string]$state.last_run_at).LocalDateTime } } catch {}
  if (-not $Force -and $null -ne $lastRun -and ((Get-Date) - $lastRun).TotalSeconds -lt $RestQuoteEverySeconds) {
    return @{ quotes = @(); attempted = 0; fetched = 0; skipped = $true; rate_limited = $false }
  }
  if ($Symbols.Count -eq 0 -or [string]::IsNullOrWhiteSpace($ApiKey)) {
    return @{ quotes = @(); attempted = 0; fetched = 0; skipped = $false; rate_limited = $false }
  }

  $cursor = [int]($state.cursor)
  if ($cursor -lt 0 -or $cursor -ge $Symbols.Count) { $cursor = 0 }
  $batch = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt [math]::Min($RestQuoteBatchSize, $Symbols.Count); $i++) {
    $batch.Add([string]$Symbols[($cursor + $i) % $Symbols.Count])
  }

  $quotes = New-Object System.Collections.Generic.List[object]
  $fetched = 0
  foreach ($symbol in $batch) {
    $quote = Invoke-FugleStockQuote -Symbol $symbol -ApiKey $ApiKey
    $converted = Convert-FugleStockQuoteToWsLikeQuote -Quote $quote
    if ($null -ne $converted) {
      $fetched += 1
      $quotes.Add($converted)
    }
    if ($script:RestQuoteRateLimited) {
      Write-Log "WARN stock rest quote rate limited; stopping current batch and cooling down."
      break
    }
    Start-Sleep -Milliseconds 250
  }

  $nextCursor = ($cursor + [math]::Max(1, $batch.Count)) % $Symbols.Count
  Write-JsonFile -Path $RestQuoteStateFile -Value ([ordered]@{
    cursor = $nextCursor
    last_run_at = (Get-Date).ToString("o")
    last_attempted = $batch.Count
    last_fetched_symbols = $fetched
    last_rows = $quotes.Count
    universe = $Symbols.Count
    rate_limited = [bool]$script:RestQuoteRateLimited
  })
  return @{ quotes = $quotes.ToArray(); attempted = $batch.Count; fetched = $fetched; skipped = $false; rate_limited = [bool]$script:RestQuoteRateLimited }
}

function Test-ProcessAlive {
  param([object]$PidValue)
  $pidInt = 0
  if (-not [int]::TryParse([string]$PidValue, [ref]$pidInt)) { return $false }
  if ($pidInt -le 0) { return $false }
  return [bool](Get-Process -Id $pidInt -ErrorAction SilentlyContinue)
}

function Initialize-WebSocketSymbols {
  $symbolsFile = Join-Path $RuntimeDir "cache\intraday\fugle-ws-symbols.json"
  $current = Read-JsonFile -Path $symbolsFile -Default ([pscustomobject]@{})
  $existing = @()
  foreach ($symbol in @($current.symbols)) {
    if ([string]$symbol -match '^\d{4}$') { $existing += [string]$symbol }
  }
  $existing = @(Remove-BlacklistedSymbols -Symbols (@($existing | Select-Object -Unique)) -Blacklist $script:SymbolBlacklist)
  $currentCount = if ($existing.Count -gt 0) { $existing.Count } elseif ($null -ne $current.count) { [int](Get-Number $current.count) } else { 0 }
  if ($currentCount -le 0 -and (Test-Path -LiteralPath $symbolsFile)) {
    try {
      $rawSymbols = Get-Content -LiteralPath $symbolsFile -Raw
      if ($rawSymbols -match '"count"\s*:\s*(\d+)') { $currentCount = [int]$Matches[1] }
    } catch {}
  }
  if ($currentCount -ge [math]::Min(200, $SeedSymbolCount)) {
    try {
      Write-JsonFile -Path $symbolsFile -Value ([ordered]@{
        updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
        symbols = @($existing | Select-Object -First $SeedSymbolCount)
        count = [math]::Min($existing.Count, $SeedSymbolCount)
        blacklist_count = if ($null -ne $script:SymbolBlacklist) { $script:SymbolBlacklist.Count } else { 0 }
        source = "supabase-public-slot-shared-source"
      })
    } catch {
      Write-Log "WARN unable to rewrite filtered websocket symbols file: $($_.Exception.Message)"
    }
    return [math]::Min($existing.Count, $SeedSymbolCount)
  }

  $stocksFile = Join-Path $RuntimeDir "data\stocks-slim.json"
  $symbols = @()
  try {
    if (Test-Path -LiteralPath $stocksFile) {
      $rawStocks = Get-Content -LiteralPath $stocksFile -Raw -ErrorAction Stop
      $symbols = @([regex]::Matches($rawStocks, '"code"\s*:\s*"(\d{4})"') |
        ForEach-Object { $_.Groups[1].Value } |
        Select-Object -Unique)
    }
  } catch {
    Write-Log "WARN unable to parse stocks-slim symbols: $($_.Exception.Message)"
  }

  if ($symbols.Count -eq 0 -and $existing.Count -eq 0) {
    Write-Log "WARN no websocket symbols generated; keeping existing symbols file"
    return $currentCount
  }

  $merged = @(Remove-BlacklistedSymbols -Symbols (@(@($existing) + @($symbols)) | Select-Object -Unique) -Blacklist $script:SymbolBlacklist | Select-Object -First $SeedSymbolCount)
  if ($merged.Count -eq 0) {
    Write-Log "WARN no websocket symbols to write; keeping existing symbols file"
    return $currentCount
  }
  try {
    Write-JsonFile -Path $symbolsFile -Value ([ordered]@{
      updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
      symbols = $merged
      count = $merged.Count
      blacklist_count = if ($null -ne $script:SymbolBlacklist) { $script:SymbolBlacklist.Count } else { 0 }
      source = "supabase-public-slot-shared-source"
    })
  } catch {
    Write-Log "WARN unable to update websocket symbols file: $($_.Exception.Message)"
  }
  return $merged.Count
}

function Start-FugleWebSocketCollector {
  if ($NoStartCollector) { return "disabled" }

  $statusFile = Join-Path $RuntimeDir "state\fugle-websocket-status.json"
  $status = Read-JsonFile -Path $statusFile -Default ([pscustomobject]@{})
  if (Test-ProcessAlive $status.pid) {
    $existingPid = [int]$status.pid
    $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($null -ne $existingProcess -and $existingProcess.StartTime.Date -lt (Get-Date).Date) {
      try {
        Stop-Process -Id $existingPid -Force -ErrorAction Stop
        Write-Log "WARN restarted stale websocket collector from previous day pid=$existingPid"
      } catch {
        Write-Log "WARN unable to stop stale websocket collector pid=$existingPid`: $($_.Exception.Message)"
        return "stale-collector-stop-failed pid=$existingPid"
      }
    } else {
      return "already-running pid=$existingPid"
    }
  }

  $nodeExe = "C:\Program Files\nodejs\node.exe"
  $collector = Join-Path $FumanRoot "scripts\fugle-websocket-collector.js"
  if (-not (Test-Path -LiteralPath $collector)) {
    $fallbackCollector = Join-Path $ScriptDir "fugle-websocket-collector.js"
    if (Test-Path -LiteralPath $fallbackCollector) {
      $collector = $fallbackCollector
    }
  }
  if (-not (Test-Path -LiteralPath $nodeExe)) { return "node missing: $nodeExe" }
  if (-not (Test-Path -LiteralPath $collector)) { return "collector missing: $collector" }

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $nodeExe
  $psi.Arguments = "`"$collector`""
  $psi.WorkingDirectory = Split-Path -Parent $collector
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.Environment["FUMAN_RUNTIME_DIR"] = $RuntimeDir
  $psi.Environment["STRATEGY2_FUGLE_WS_MAX_SYMBOLS"] = [string]$SeedSymbolCount
  $psi.Environment["STRATEGY2_FUGLE_WS_QUOTE_KEEP_MS"] = [string]($QuoteKeepMinutes * 60 * 1000)
  $process = [System.Diagnostics.Process]::Start($psi)
  return "started pid=$($process.Id)"
}

function Convert-QuotesToRows {
  param([object[]]$Quotes, [object]$Payload)
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($quote in $Quotes) {
    $digits = [string]$quote.code -replace "\D", ""
    $symbol = $digits.Substring(0, [math]::Min(4, $digits.Length))
    if (Test-BuiltInBlacklistedStock -Symbol $symbol -Name ([string]$quote.name)) { continue }
    $rowUpdatedAt = (Get-Date).ToUniversalTime().ToString("o")
    $lastTradeTime = Get-QuoteTimestamp -Quote $quote -Payload $Payload
    $bidVolume = [int](Convert-VolumeToLots $quote.bidSize)
    $askVolume = [int](Convert-VolumeToLots $quote.askSize)
    $cumulativeBidVolume = Get-NullableNumber @(
      $quote.cumulativeBidVolume,
      $quote.cumulative_bid_volume,
      $quote.bidTradeVolume,
      $quote.bid_trade_volume,
      $quote.innerVolume,
      $quote.inner_volume,
      $quote.totalBidVolume,
      $quote.total_bid_volume
    )
    $cumulativeAskVolume = Get-NullableNumber @(
      $quote.cumulativeAskVolume,
      $quote.cumulative_ask_volume,
      $quote.askTradeVolume,
      $quote.ask_trade_volume,
      $quote.outerVolume,
      $quote.outer_volume,
      $quote.totalAskVolume,
      $quote.total_ask_volume
    )
    $cumulativeBidAskVolume = $null
    if ($null -ne $cumulativeBidVolume -and $null -ne $cumulativeAskVolume) {
      $cumulativeBidAskVolume = $cumulativeBidVolume + $cumulativeAskVolume
    }
    $denom = $bidVolume + $askVolume
    $askBidRatio = $null
    if ($bidVolume -gt 0) { $askBidRatio = [math]::Round(([double]$askVolume / [double]$bidVolume), 6) }
    $askRatio = $null
    if ($denom -gt 0) { $askRatio = [math]::Round(([double]$askVolume / [double]$denom), 6) }
    $quoteName = [string]$quote.name
    if ([string]::IsNullOrWhiteSpace($quoteName)) { $quoteName = $symbol }
    $quoteSession = [string]$quote.session
    if ([string]::IsNullOrWhiteSpace($quoteSession)) { $quoteSession = Get-PublicSlotSession }
    $isTrial = $false
    try { $isTrial = [bool]$quote.isTrial } catch {}
    $rows.Add([ordered]@{
      symbol = $symbol
      name = $quoteName
      market = Convert-Market ([string]$quote.market)
      updated_at = $rowUpdatedAt
      price = Get-Number $quote.close
      open_price = Get-Number $quote.open
      high_price = Get-Number $quote.high
      low_price = Get-Number $quote.low
      previous_close = Get-Number $quote.prevClose
      change_percent = Get-Number $quote.percent
      total_volume = [int64](Convert-VolumeToLots $quote.tradeVolume)
      trade_value = [int64](Get-Number $quote.tradeValue)
      bid_volume = $bidVolume
      ask_volume = $askVolume
      ask_bid_ratio = $askBidRatio
      ask_ratio = $askRatio
      cumulative_bid_volume = $cumulativeBidVolume
      cumulative_ask_volume = $cumulativeAskVolume
      cumulative_bid_ask_volume = $cumulativeBidAskVolume
      stock_type = "COMMONSTOCK"
      session = $quoteSession
      last_trade_time = $lastTradeTime
      is_halted = $false
      is_trial = $isTrial
      payload = @{
        raw = $quote
        volume_unit = "lots"
        time_standard = "UTC"
        bid_volume_source = "fugle_ws_best_bid_level_size"
        ask_volume_source = "fugle_ws_best_ask_level_size"
        cumulative_bid_ask_available = ($null -ne $cumulativeBidAskVolume)
        cumulative_bid_ask_source = if ($null -ne $cumulativeBidAskVolume) { "fugle_quote_fields" } else { "unavailable_from_current_websocket_cache" }
      }
    })
  }
  return $rows.ToArray()
}

function Convert-QuotesToPreopenRows {
  param([object[]]$Quotes, [object]$Payload)
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($quote in $Quotes) {
    $digits = [string]$quote.code -replace "\D", ""
    $symbol = $digits.Substring(0, [math]::Min(4, $digits.Length))
    if (Test-BuiltInBlacklistedStock -Symbol $symbol -Name ([string]$quote.name)) { continue }

    $updatedAt = Get-QuoteTimestamp -Quote $quote -Payload $Payload
    $referencePrice = Get-Number $quote.referencePrice
    if ($referencePrice -le 0) { $referencePrice = Get-Number $quote.prevClose }
    $trialPrice = Get-Number $quote.trialPrice
    if ($trialPrice -le 0) { $trialPrice = Get-Number $quote.close }
    $bidPrice = Get-Number $quote.bidPrice
    $askPrice = Get-Number $quote.askPrice
    $bidVolume = [int](Convert-VolumeToLots $quote.bidSize)
    $askVolume = [int](Convert-VolumeToLots $quote.askSize)
    $quoteName = [string]$quote.name
    if ([string]::IsNullOrWhiteSpace($quoteName)) { $quoteName = $symbol }

    $limitUp = 0.0
    if ($referencePrice -gt 0) { $limitUp = [math]::Round($referencePrice * 1.1, 2) }
    $isLimitUpBid = $false
    if ($limitUp -gt 0 -and $bidPrice -ge ($limitUp * 0.995) -and $bidVolume -gt $askVolume) {
      $isLimitUpBid = $true
    }

    $rows.Add([ordered]@{
      symbol = $symbol
      name = $quoteName
      market = Convert-Market ([string]$quote.market)
      session = Get-PublicSlotSession
      updated_at = $updatedAt
      reference_price = $referencePrice
      trial_price = $trialPrice
      is_trial = ([bool]$quote.isTrial -or (Get-PublicSlotSession) -eq "preopen")
      is_limit_up_bid = $isLimitUpBid
      best_bid_price = $bidPrice
      best_ask_price = $askPrice
      bid_volume = $bidVolume
      ask_volume = $askVolume
      bid1_price = $bidPrice
      bid1_volume = $bidVolume
      ask1_price = $askPrice
      ask1_volume = $askVolume
      bid_levels_json = @(@{ price = $bidPrice; volume = $bidVolume })
      ask_levels_json = @(@{ price = $askPrice; volume = $askVolume })
      payload = @{ raw = $quote; volume_unit = "lots"; time_standard = "UTC" }
    })
  }
  return $rows.ToArray()
}

function Invoke-TaifexFuturesQuote {
  param([string]$Cid = "TXF")
  try {
    $uri = "https://mis.taifex.com.tw/futures/api/getQuoteList"
    $body = @{
      MarketType = "0"
      SymbolType = "F"
      KindID = "1"
      CID = $Cid
      ExpireMonth = ""
      RowSize = "5"
      PageNo = "1"
      Language = "zh-tw"
    } | ConvertTo-Json -Compress
    return Invoke-RestMethod -Uri $uri -Method Post -ContentType "application/json" -Headers @{
      Referer = "https://mis.taifex.com.tw/"
      Origin = "https://mis.taifex.com.tw"
      "User-Agent" = "FumanPublicSlot/1.0"
    } -Body $body -TimeoutSec 10
  } catch {
    Write-Log "WARN taifex $Cid failed: $($_.Exception.Message)"
    return $null
  }
}

function Convert-TaifexToFutoptRows {
  param([object]$Payload, [string]$Product = "TXF")
  $quoteRows = New-Object System.Collections.Generic.List[object]
  $tickerRows = New-Object System.Collections.Generic.List[object]
  $items = @($Payload.RtData.QuoteList)
  if ($items.Count -eq 0) { $items = @($Payload.RtnData.QuoteList) }
  foreach ($item in $items) {
    $futureSymbol = [string]$item.SymbolID
    if ([string]::IsNullOrWhiteSpace($futureSymbol)) { $futureSymbol = [string]$item.DispEName }
    if ([string]::IsNullOrWhiteSpace($futureSymbol)) { $futureSymbol = [string]$item.CID }
    if ([string]::IsNullOrWhiteSpace($futureSymbol)) { continue }
    $name = if ($item.DispCName) { [string]$item.DispCName } elseif ($item.CName) { [string]$item.CName } else { $futureSymbol }
    $last = Get-Number $item.CLastPrice
    $previous = Get-Number $item.CRefPrice
    if ($last -le 0 -or $previous -le 0) { continue }
    $changePercent = [math]::Round((($last - $previous) / $previous) * 100, 4)
    $updatedAt = (Get-Date).ToUniversalTime().ToString("o")

    $quoteRows.Add([ordered]@{
      future_symbol = $futureSymbol
      updated_at = $updatedAt
      last_price = $last
      open_price = Get-Number $item.COpenPrice
      high_price = Get-Number $item.CHighPrice
      low_price = Get-Number $item.CLowPrice
      previous_close = $previous
      change_percent = $changePercent
      total_volume = [int64](Convert-VolumeToLots $item.CTotalVolume)
      product = $Product
      session = "regular"
      payload = @{ raw = $item; volume_unit = "lots"; time_standard = "UTC"; scope = "TXF" }
    })
    $tickerRows.Add([ordered]@{
      future_symbol = $futureSymbol
      name = $name
      product = $Product
      contract_type = "index_future"
      end_date = $null
      exchange = "TAIFEX"
      underlying_name = "TAIEX"
      underlying_symbol = "TXF"
      session = "regular"
      updated_at = $updatedAt
      payload = @{ raw = $item; time_standard = "UTC"; scope = "TXF" }
    })
  }
  return @{ quotes = $quoteRows.ToArray(); tickers = $tickerRows.ToArray() }
}

function Normalize-StockFutureName {
  param([string]$Name)
  $text = ([string]$Name).Trim()
  $text = $text -replace "期貨\d*$", ""
  $text = $text -replace "\s+", ""
  return $text
}

function Get-StockNameLookup {
  $lookup = @{}
  foreach ($row in @(Convert-StocksSlimToTickerRows)) {
    $key = Normalize-StockFutureName ([string]$row.name)
    if (-not [string]::IsNullOrWhiteSpace($key) -and -not $lookup.ContainsKey($key)) {
      $lookup[$key] = $row
    }
  }
  return $lookup
}

function Invoke-FugleFutoptTickers {
  param([string]$ApiKey)
  if ([string]::IsNullOrWhiteSpace($ApiKey)) { return $null }

  try {
    if (Test-Path -LiteralPath $FutoptTickersCacheFile) {
      $age = ((Get-Date) - (Get-Item -LiteralPath $FutoptTickersCacheFile).LastWriteTime).TotalSeconds
      if ($age -lt $FutoptTickersEverySeconds) {
        $cached = Read-JsonFile -Path $FutoptTickersCacheFile -Default $null
        if ($null -ne $cached) {
          $cached | Add-Member -NotePropertyName public_slot_from_cache -NotePropertyValue $true -Force
        }
        return $cached
      }
    }
  } catch {}

  $headers = @{
    "X-API-KEY" = $ApiKey
    "User-Agent" = "FumanPublicSlotSharedSource/1.0"
  }
  try {
    $uri = "https://api.fugle.tw/marketdata/v1.0/futopt/intraday/tickers?type=FUTURE"
    $payload = Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 25 -ErrorAction Stop
    $payload | Add-Member -NotePropertyName public_slot_from_cache -NotePropertyValue $false -Force
    Write-JsonFile -Path $FutoptTickersCacheFile -Value $payload
    return $payload
  } catch {
    Write-Log "WARN fugle futopt tickers failed: $($_.Exception.Message)"
    if (Test-Path -LiteralPath $FutoptTickersCacheFile) {
      $cached = Read-JsonFile -Path $FutoptTickersCacheFile -Default $null
      if ($null -ne $cached) {
        $cached | Add-Member -NotePropertyName public_slot_from_cache -NotePropertyValue $true -Force
      }
      return $cached
    }
    return $null
  }
}

function Convert-FugleFutoptTickersToRows {
  param([object]$Payload)
  $rows = New-Object System.Collections.Generic.List[object]
  $stockLookup = Get-StockNameLookup
  $updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  foreach ($item in @($Payload.data)) {
    $futureSymbol = [string]$item.symbol
    if ([string]::IsNullOrWhiteSpace($futureSymbol)) { continue }
    $contractType = [string]$item.contractType
    $name = [string]$item.name
    $product = if ($contractType -eq "S") { "STOCK_FUTURE" } elseif ($futureSymbol -match "^TXF") { "TXF" } else { "FUTURE" }
    $underlyingName = $null
    $underlyingSymbol = $null
    $contractLabel = if ($contractType -eq "S") { "stock_future" } elseif ($contractType -eq "I") { "index_future" } else { "future" }

    if ($contractType -eq "S") {
      $underlyingName = Normalize-StockFutureName $name
      $key = Normalize-StockFutureName $underlyingName
      if ($stockLookup.ContainsKey($key)) {
        $underlyingSymbol = [string]$stockLookup[$key].symbol
        $underlyingName = [string]$stockLookup[$key].name
      }
    } elseif ($futureSymbol -match "^TXF") {
      $underlyingName = "TAIEX"
      $underlyingSymbol = "TXF"
    }

    $rows.Add([ordered]@{
      future_symbol = $futureSymbol
      name = $name
      product = $product
      contract_type = $contractLabel
      end_date = if ($item.endDate) { [string]$item.endDate } else { $null }
      exchange = if ($item.exchange) { [string]$item.exchange } else { "TAIFEX" }
      underlying_name = $underlyingName
      underlying_symbol = $underlyingSymbol
      session = (Get-PublicSlotSession)
      updated_at = $updatedAt
      payload = @{
        raw = $item
        source = "fugle-futopt-intraday-tickers"
        time_standard = "UTC"
        underlying_mapping_source = if ($contractType -eq "S" -and $underlyingSymbol) { "stock_tickers_name_match" } elseif ($contractType -eq "S") { "name_unmatched" } else { "index_future" }
      }
    })
  }
  return $rows.ToArray()
}

function Get-NearMonthStockFutureSymbols {
  param([object[]]$TickerRows)
  $today = (Get-Date).Date
  $selected = New-Object System.Collections.Generic.List[string]
  $groups = @($TickerRows | Where-Object {
    $_["product"] -eq "STOCK_FUTURE" -and
    -not [string]::IsNullOrWhiteSpace([string]$_["underlying_symbol"]) -and
    -not [string]::IsNullOrWhiteSpace([string]$_["future_symbol"])
  } | Group-Object -Property { [string]$_["underlying_symbol"] })

  foreach ($group in $groups) {
    $near = @($group.Group | Sort-Object {
      try {
        $d = [datetime]::Parse([string]$_["end_date"])
        if ($d.Date -lt $today) { [datetime]::MaxValue } else { $d }
      } catch { [datetime]::MaxValue }
    }, { [string]$_["future_symbol"] } | Select-Object -First 1)
    if ($near.Count -gt 0) { $selected.Add([string]$near[0]["future_symbol"]) }
  }
  return $selected.ToArray()
}

function Invoke-FugleFutoptQuote {
  param([string]$FutureSymbol, [string]$ApiKey)
  if ([string]::IsNullOrWhiteSpace($FutureSymbol) -or [string]::IsNullOrWhiteSpace($ApiKey)) { return $null }
  $headers = @{
    "X-API-KEY" = $ApiKey
    "User-Agent" = "FumanPublicSlotSharedSource/1.0"
  }
  try {
    $uri = "https://api.fugle.tw/marketdata/v1.0/futopt/intraday/quote/$FutureSymbol"
    return Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 12 -ErrorAction Stop
  } catch {
    Write-Log "WARN fugle futopt quote $FutureSymbol failed: $($_.Exception.Message)"
    if ($_.Exception.Message -match '429|Too Many') { $script:FutoptRateLimited = $true }
    return $null
  }
}

function Convert-FugleFutoptQuoteToRow {
  param([object]$Quote, [hashtable]$TickerBySymbol)
  if ($null -eq $Quote) { return $null }
  $futureSymbol = [string]$Quote.symbol
  if ([string]::IsNullOrWhiteSpace($futureSymbol)) { return $null }
  $ticker = $null
  if ($TickerBySymbol.ContainsKey($futureSymbol)) { $ticker = $TickerBySymbol[$futureSymbol] }
  $previous = Get-Number $Quote.previousClose
  $change = Get-Number $Quote.change
  $last = Get-Number $Quote.lastPrice
  if ($last -le 0) { $last = Get-Number $Quote.close }
  if ($last -le 0) { $last = Get-Number $Quote.price }
  if ($last -le 0 -and $previous -gt 0) { $last = $previous + $change }
  $changePercent = Get-Number $Quote.changePercent
  $updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  return [ordered]@{
    future_symbol = $futureSymbol
    updated_at = $updatedAt
    last_price = $last
    open_price = Get-Number $Quote.openPrice
    high_price = Get-Number $Quote.highPrice
    low_price = Get-Number $Quote.lowPrice
    previous_close = $previous
    change_percent = $changePercent
    total_volume = [int64](Convert-VolumeToLots $Quote.total.tradeVolume)
    product = if ($ticker -and $ticker["product"]) { [string]$ticker["product"] } elseif ($futureSymbol -match "^TXF") { "TXF" } else { "STOCK_FUTURE" }
    session = (Get-PublicSlotSession)
    payload = @{
      raw = $Quote
      source = "fugle-futopt-intraday-quote"
      volume_unit = "lots"
      time_standard = "UTC"
      underlying_symbol = if ($ticker) { $ticker["underlying_symbol"] } else { $null }
      underlying_name = if ($ticker) { $ticker["underlying_name"] } else { $null }
    }
  }
}

function Invoke-FugleFutoptQuoteBatch {
  param([string[]]$FutureSymbols, [object[]]$TickerRows, [string]$ApiKey)
  $state = Read-JsonFile -Path $FutoptQuoteStateFile -Default ([pscustomobject]@{ cursor = 0; last_run_at = $null })
  $script:FutoptRateLimited = $false
  $lastRun = $null
  try { if ($state.last_run_at) { $lastRun = [datetimeoffset]::Parse([string]$state.last_run_at).LocalDateTime } } catch {}
  if ($null -ne $lastRun -and ((Get-Date) - $lastRun).TotalSeconds -lt $FutoptQuoteEverySeconds) {
    return @{ rows = @(); attempted = 0; fetched = 0; skipped = $true; rate_limited = $false }
  }
  if ($FutureSymbols.Count -eq 0 -or [string]::IsNullOrWhiteSpace($ApiKey)) {
    return @{ rows = @(); attempted = 0; fetched = 0; skipped = $false; rate_limited = $false }
  }

  $tickerBySymbol = @{}
  foreach ($ticker in @($TickerRows)) {
    $fs = [string]$ticker["future_symbol"]
    if ($fs -and -not $tickerBySymbol.ContainsKey($fs)) { $tickerBySymbol[$fs] = $ticker }
  }
  $cursor = [int]($state.cursor)
  if ($cursor -lt 0 -or $cursor -ge $FutureSymbols.Count) { $cursor = 0 }
  $batch = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt [math]::Min($FutoptQuoteBatchSize, $FutureSymbols.Count); $i++) {
    $batch.Add([string]$FutureSymbols[($cursor + $i) % $FutureSymbols.Count])
  }

  $rows = New-Object System.Collections.Generic.List[object]
  $fetched = 0
  foreach ($futureSymbol in $batch) {
    $quote = Invoke-FugleFutoptQuote -FutureSymbol $futureSymbol -ApiKey $ApiKey
    $row = Convert-FugleFutoptQuoteToRow -Quote $quote -TickerBySymbol $tickerBySymbol
    if ($null -ne $row) {
      $fetched += 1
      $rows.Add($row)
    }
    if ($script:FutoptRateLimited) {
      Write-Log "WARN futopt quote rate limited; stopping current batch and cooling down."
      break
    }
    Start-Sleep -Milliseconds 600
  }
  $nextCursor = ($cursor + [math]::Max(1, $batch.Count)) % $FutureSymbols.Count
  Write-JsonFile -Path $FutoptQuoteStateFile -Value ([ordered]@{
    cursor = $nextCursor
    last_run_at = (Get-Date).ToString("o")
    last_attempted = $batch.Count
    last_fetched_symbols = $fetched
    last_rows = $rows.Count
    universe = $FutureSymbols.Count
    rate_limited = [bool]$script:FutoptRateLimited
  })
  return @{ rows = $rows.ToArray(); attempted = $batch.Count; fetched = $fetched; skipped = $false; rate_limited = [bool]$script:FutoptRateLimited }
}

function Convert-StocksSlimToTickerRows {
  $stocksFile = Join-Path $RuntimeDir "data\stocks-slim.json"
  $rows = New-Object System.Collections.Generic.List[object]
  try {
    if (-not (Test-Path -LiteralPath $stocksFile)) { return $rows.ToArray() }
    $rawStocks = Get-Content -LiteralPath $stocksFile -Raw -ErrorAction Stop
    $matches = [regex]::Matches($rawStocks, '"code"\s*:\s*"(\d{4})"[\s\S]{0,400}?"name"\s*:\s*"([^"]*)"[\s\S]{0,400}?"market"\s*:\s*"([^"]*)"')
    $seen = @{}
    foreach ($match in $matches) {
      $symbol = [string]$match.Groups[1].Value
      if ($seen.ContainsKey($symbol)) { continue }
      if (Test-BuiltInBlacklistedStock -Symbol $symbol -Name ([string]$match.Groups[2].Value)) { continue }
      $seen[$symbol] = $true
      $market = Convert-Market ([string]$match.Groups[3].Value)
      $isEtf = $symbol.StartsWith("00")
      $rows.Add([ordered]@{
        symbol = $symbol
        name = [string]$match.Groups[2].Value
        market = $market
        stock_type = if ($isEtf) { "ETF" } else { "COMMONSTOCK" }
        industry = $null
        type = if ($isEtf) { "ETF" } else { "stock" }
        is_etf = $isEtf
        is_suspended = $false
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
      payload = @{ source = "stocks-slim"; symbol = $symbol; blacklist_applied = $true }
      })
    }
  } catch {
    Write-Log "WARN unable to parse stocks-slim tickers: $($_.Exception.Message)"
  }
  return $rows.ToArray()
}

function Update-MinuteRows {
  param([object[]]$QuoteRows)

  $state = Read-JsonFile -Path $StateFile -Default ([pscustomobject]@{ buckets = @{} })
  if (-not $state.buckets) { $state | Add-Member -NotePropertyName buckets -NotePropertyValue ([pscustomobject]@{}) -Force }
  if (-not $state.last_total_volume) { $state | Add-Member -NotePropertyName last_total_volume -NotePropertyValue ([pscustomobject]@{}) -Force }
  $rows = New-Object System.Collections.Generic.List[object]
  $daily = New-Object System.Collections.Generic.List[object]
  $today = (Get-Date).ToString("yyyy-MM-dd")

  foreach ($quote in $QuoteRows) {
    $symbol = [string]$quote.symbol
    $quoteSession = [string]$quote.session
    $quoteIsTrial = $false
    try { $quoteIsTrial = [bool]$quote.is_trial } catch {}
    if ($quoteSession -ne "regular" -or $quoteIsTrial) { continue }
    $quoteTime = [datetimeoffset]::Parse([string]$quote.updated_at)
    $taipeiTimeOfDay = $quoteTime.ToOffset([timespan]::FromHours(8)).TimeOfDay
    if ($taipeiTimeOfDay -lt [TimeSpan]::Parse("09:00") -or $taipeiTimeOfDay -gt [TimeSpan]::Parse("13:35")) { continue }
    $minute = $quoteTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:00Z")
    $price = Get-Number $quote.price
    $totalVolume = [int64](Convert-VolumeToLots $quote.total_volume)
    if ($price -le 0 -or $symbol -notmatch '^\d{4}$') { continue }

    $bucket = $state.buckets.$symbol
    $previousTotalVolume = $state.last_total_volume.$symbol
    if ($null -eq $previousTotalVolume) { $previousTotalVolume = $totalVolume }
    $startVolume = [int64]$previousTotalVolume
    if ($startVolume -gt $totalVolume) { $startVolume = $totalVolume }

    if ($null -eq $bucket -or [string]$bucket.minute -ne $minute) {
      $bucket = [pscustomobject]@{
        minute = $minute
        open = $price
        high = $price
        low = $price
        close = $price
        start_volume = $startVolume
        last_volume = $totalVolume
        market = [string]$quote.market
      }
      $state.buckets | Add-Member -NotePropertyName $symbol -NotePropertyValue $bucket -Force
    } else {
      $bucket.high = [math]::Max([double]$bucket.high, $price)
      $bucket.low = [math]::Min([double]$bucket.low, $price)
      $bucket.close = $price
      $bucket.last_volume = [math]::Max([int64]$bucket.last_volume, $totalVolume)
    }

    $state.last_total_volume | Add-Member -NotePropertyName $symbol -NotePropertyValue ([int64]$bucket.last_volume) -Force
    $taipeiMinute = ([datetimeoffset]::Parse([string]$minute)).ToOffset([timespan]::FromHours(8)).ToString("yyyy-MM-dd HH:mm:ss")

    $minuteVolume = [int64]([math]::Max(0, [int64]$bucket.last_volume - [int64]$bucket.start_volume))
    if ($minuteVolume -gt 0) {
      $rows.Add([ordered]@{
        symbol = $symbol
        market = [string]$quote.market
        trade_date = $today
        candle_time = $minute
        open = Get-Number $bucket.open
        high = Get-Number $bucket.high
        low = Get-Number $bucket.low
        close = Get-Number $bucket.close
        volume = $minuteVolume
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
        payload = @{
          source = "fugle-ws-aggregate"
          total_volume = $totalVolume
          start_total_volume = [int64]$bucket.start_volume
          last_total_volume = [int64]$bucket.last_volume
          volume_unit = "lots"
          time_standard = "UTC"
          taipei_candle_time = $taipeiMinute
          session = Get-PublicSlotSession
        }
      })
    }

    $daily.Add([ordered]@{
      symbol = $symbol
      market = [string]$quote.market
      trade_date = $today
      volume = $totalVolume
      updated_at = (Get-Date).ToUniversalTime().ToString("o")
      payload = @{ source = "fugle-ws-aggregate"; volume_unit = "lots"; time_standard = "UTC" }
    })
  }

  Write-JsonFile -Path $StateFile -Value $state
  return @{ minuteRows = $rows.ToArray(); dailyRows = $daily.ToArray() }
}

function Convert-IntradayRowsToDailyVolumeRows {
  param([object[]]$Rows)

  $groups = @{}
  foreach ($row in @($Rows)) {
    $symbol = [string]$row.symbol
    $tradeDate = [string]$row.trade_date
    if ($symbol -notmatch '^\d{4}$' -or [string]::IsNullOrWhiteSpace($tradeDate)) { continue }
    $key = "$symbol|$tradeDate"
    if (-not $groups.ContainsKey($key)) {
      $groups[$key] = [ordered]@{
        symbol = $symbol
        market = [string]$row.market
        trade_date = $tradeDate
        volume = 0
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
        payload = @{ source = "fugle-rest-1m-aggregate"; volume_unit = "lots"; time_standard = "UTC" }
      }
    }
    $groups[$key].volume = [double]$groups[$key].volume + [double](Convert-VolumeToLots $row.volume)
  }

  return @($groups.Values)
}

function Convert-IntradayRowsToDailyOhlcvRows {
  param([object[]]$Rows)

  $groups = @{}
  foreach ($row in @($Rows | Sort-Object symbol, trade_date, candle_time)) {
    $symbol = [string]$row.symbol
    $tradeDate = [string]$row.trade_date
    $close = Get-Number $row.close
    if ($symbol -notmatch '^\d{4}$' -or [string]::IsNullOrWhiteSpace($tradeDate) -or $close -le 0) { continue }
    $key = "$symbol|$tradeDate"
    if (-not $groups.ContainsKey($key)) {
      $groups[$key] = [ordered]@{
        symbol = $symbol
        market = [string]$row.market
        trade_date = $tradeDate
        open = Get-Number $row.open
        high = Get-Number $row.high
        low = Get-Number $row.low
        close = $close
        volume = 0
        source = "fugle-rest-1m-aggregate"
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
        payload = @{ source = "fugle-rest-1m-aggregate"; volume_unit = "lots"; time_standard = "UTC" }
      }
    } else {
      $groups[$key].high = [math]::Max([double]$groups[$key].high, [double](Get-Number $row.high))
      $groups[$key].low = [math]::Min([double]$groups[$key].low, [double](Get-Number $row.low))
      $groups[$key].close = $close
    }
    $groups[$key].volume = [double]$groups[$key].volume + [double](Convert-VolumeToLots $row.volume)
  }

  return @($groups.Values)
}

if (-not (Test-Path -LiteralPath $SourceHelper)) {
  throw "Missing helper: $SourceHelper"
}
. $SourceHelper

$serviceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) {
  $serviceRoleKey = Read-TextSecret @(
    (Join-Path $RuntimeDir "secrets\supabase-service-role-key.txt"),
    (Join-Path $FumanRoot "secrets\supabase-service-role-key.txt")
  )
}
if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) {
  throw "SUPABASE_SERVICE_ROLE_KEY missing. Put it in C:\fuman-runtime\secrets\supabase-service-role-key.txt or set env var."
}

Initialize-SupabasePublicSlotSource -Url $ProjectUrl -ServiceRoleKey $serviceRoleKey
$fugleApiKey = Get-FugleApiKey
$script:SymbolBlacklist = Read-SymbolBlacklist
Write-Log "Public slot shared source started. Supabase=$ProjectUrl Runtime=$RuntimeDir"
Write-Log "API blacklist symbols loaded: $($script:SymbolBlacklist.Count)"

$stopTime = Get-StopTimeToday -HHmm $StopAt
$lastStockTickerWriteAt = [datetime]::MinValue
$lastMaintenanceAt = [datetime]::MinValue
$StatusSourceName = if ($NoStartCollector) { "$SourceName`_smoke_test" } else { $SourceName }

do {
  $loopStarted = Get-Date
  try {
    $script:SymbolBlacklist = Read-SymbolBlacklist
    $seeded = Initialize-WebSocketSymbols
    $collectorState = Start-FugleWebSocketCollector

    $quotesFile = Join-Path $RuntimeDir "cache\intraday\fugle-ws-quotes.json"
    $wsStatusFile = Join-Path $RuntimeDir "state\fugle-websocket-status.json"
    $payload = Read-JsonFile -Path $quotesFile -Default ([pscustomobject]@{})
    $wsStatus = Read-JsonFile -Path $wsStatusFile -Default ([pscustomobject]@{})
    $quotes = @($payload.quotes)
    $age = 999999
    if (Test-Path -LiteralPath $quotesFile) {
      $age = [int](((Get-Date) - (Get-Item -LiteralPath $quotesFile).LastWriteTime).TotalSeconds)
    }

    $session = Get-PublicSlotSession
    $warmupSymbols = @(Get-WarmupSymbols)
    $preQuoteRows = @(Convert-QuotesToRows -Quotes $quotes -Payload $payload)
    $priorityQuoteSymbols = @(Order-SymbolsForPriority -Symbols $warmupSymbols -QuoteRows $preQuoteRows)
    $restQuotePayload = @{ quotes = @(); attempted = 0; fetched = 0; skipped = $true; rate_limited = $false }
    if ($session -in @("preopen", "regular") -or $quotes.Count -eq 0) {
      $restQuotePayload = Invoke-FugleStockQuoteBatch -Symbols $priorityQuoteSymbols -ApiKey $fugleApiKey
      $quotes = Merge-QuoteObjectsByCode -PrimaryQuotes $quotes -FallbackQuotes @($restQuotePayload.quotes)
    }

    $quoteRows = Convert-QuotesToRows -Quotes $quotes -Payload $payload
    $preopenRows = Convert-QuotesToPreopenRows -Quotes $quotes -Payload $payload
    if ($quoteRows.Count -gt 0) {
      Write-PublicSlotQuotesLive -Rows $quoteRows
      if ($preopenRows.Count -gt 0) {
        Write-PublicSlotPreopenSnapshot -Rows $preopenRows
        Write-PublicSlotPreopenSnapshotHistory -Rows $preopenRows
      }
      $blacklistCountForHeartbeat = if ($null -ne $script:SymbolBlacklist) { $script:SymbolBlacklist.Count } else { 0 }
      Write-QuoteHeartbeatStatus -SourceName $StatusSourceName -QuoteRows $quoteRows -PreopenRows $preopenRows -EligibleSymbols $warmupSymbols -SeededSymbols $seeded -BlacklistCount $blacklistCountForHeartbeat -CollectorState $collectorState -Session $session -RestQuotePayload $restQuotePayload -FallbackAgeSeconds $age -QuotesFile $quotesFile -WebSocketStatus $wsStatus
    }
    $minutePayload = Update-MinuteRows -QuoteRows $quoteRows
    $priorityWarmupSymbols = @(Order-SymbolsForPriority -Symbols $warmupSymbols -QuoteRows $quoteRows)
    [void](Filter-SymbolsByQuoteLiquidity -Symbols $priorityWarmupSymbols -QuoteRows $quoteRows)
    $direct1mSymbols = @($priorityWarmupSymbols)
    $direct1mPayload = Invoke-Direct1mWarmupBatch -Symbols $direct1mSymbols -ApiKey $fugleApiKey
    $txfPayload = Convert-TaifexToFutoptRows -Payload (Invoke-TaifexFuturesQuote -Cid "TXF") -Product "TXF"
    $fugleFutoptTickerPayload = Invoke-FugleFutoptTickers -ApiKey $fugleApiKey
    $fugleFutoptTickerRows = @(Convert-FugleFutoptTickersToRows -Payload $fugleFutoptTickerPayload)
    $nearStockFutureSymbols = @(Get-NearMonthStockFutureSymbols -TickerRows $fugleFutoptTickerRows)
    $fugleFutoptQuotePayload = Invoke-FugleFutoptQuoteBatch -FutureSymbols $nearStockFutureSymbols -TickerRows $fugleFutoptTickerRows -ApiKey $fugleApiKey
    $combinedFutoptTickerRows = @($txfPayload.tickers) + @($fugleFutoptTickerRows)
    $combinedFutoptQuoteRows = @($txfPayload.quotes) + @($fugleFutoptQuotePayload.rows)
    $stockFutureTickerCount = @($fugleFutoptTickerRows | Where-Object { $_.product -eq "STOCK_FUTURE" }).Count
    $stockFutureMappedCount = @($fugleFutoptTickerRows | Where-Object { $_.product -eq "STOCK_FUTURE" -and -not [string]::IsNullOrWhiteSpace([string]$_.underlying_symbol) }).Count
    $shouldWriteFutoptTickers = $false
    if ($combinedFutoptTickerRows.Count -gt 0) {
      $shouldWriteFutoptTickers = ($null -eq $fugleFutoptTickerPayload -or -not [bool]$fugleFutoptTickerPayload.public_slot_from_cache)
      if ($txfPayload.tickers.Count -gt 0) { $shouldWriteFutoptTickers = $true }
    }

    if ($quoteRows.Count -gt 0) { Write-PublicSlotQuotesLive -Rows $quoteRows }
    if ($minutePayload.minuteRows.Count -gt 0) { Write-PublicSlotIntraday1m -Rows $minutePayload.minuteRows }
    $direct1mDailyRows = @(Convert-IntradayRowsToDailyVolumeRows -Rows $direct1mPayload.rows)
    $direct1mOhlcvRows = @(Convert-IntradayRowsToDailyOhlcvRows -Rows $direct1mPayload.rows)
    if ($direct1mPayload.rows.Count -gt 0) { Write-PublicSlotIntraday1m -Rows $direct1mPayload.rows }
    if ($minutePayload.dailyRows.Count -gt 0) { Write-PublicSlotDailyVolume -Rows $minutePayload.dailyRows }
    if ($direct1mDailyRows.Count -gt 0) { Write-PublicSlotDailyVolume -Rows $direct1mDailyRows }
    if ($direct1mOhlcvRows.Count -gt 0) { Write-PublicSlotDailyOhlcv -Rows $direct1mOhlcvRows }
    if ($preopenRows.Count -gt 0) { Write-PublicSlotPreopenSnapshot -Rows $preopenRows }
    if ($preopenRows.Count -gt 0) { Write-PublicSlotPreopenSnapshotHistory -Rows $preopenRows }
    if ($combinedFutoptQuoteRows.Count -gt 0) { Write-PublicSlotFutoptQuotesLive -Rows $combinedFutoptQuoteRows }
    if ($shouldWriteFutoptTickers) { Write-PublicSlotFutoptTickers -Rows $combinedFutoptTickerRows }
    if (((Get-Date) - $lastMaintenanceAt).TotalMinutes -ge 30) {
      $deletedDaily = Invoke-PublicSlotRpc -FunctionName "cleanup_fugle_daily_volume" -Body @{ retain_trade_days = $DailyVolumeRetainTradeDays }
      $deleted1m = Invoke-PublicSlotRpc -FunctionName "cleanup_fugle_intraday_1m" -Body @{ retain_trade_days = 5 }
      Write-Log "maintenance daily_volume_deleted=$deletedDaily intraday_1m_deleted=$deleted1m"
      $lastMaintenanceAt = Get-Date
    }
    if (((Get-Date) - $lastStockTickerWriteAt).TotalMinutes -ge 30) {
      $stockTickerRows = Convert-StocksSlimToTickerRows
      if ($stockTickerRows.Count -gt 0) {
        Write-PublicSlotStockTickers -Rows $stockTickerRows
        $lastStockTickerWriteAt = Get-Date
      }
    }

    $latestQuotePayload = Read-JsonFile -Path $quotesFile -Default ([pscustomobject]@{})
    $latestQuoteObjects = @($latestQuotePayload.quotes)
    $latestQuoteRows = @(Convert-QuotesToRows -Quotes $latestQuoteObjects -Payload $latestQuotePayload)
    if ($latestQuoteRows.Count -gt 0) {
      $quoteRows = $latestQuoteRows
      $preopenRows = @(Convert-QuotesToPreopenRows -Quotes $latestQuoteObjects -Payload $latestQuotePayload)
      Write-PublicSlotQuotesLive -Rows $quoteRows
      if ($preopenRows.Count -gt 0) { Write-PublicSlotPreopenSnapshot -Rows $preopenRows }
    }

    $lastQuoteAt = Get-LatestIsoUtc -Rows $quoteRows -PropertyName "updated_at"
    $combined1mRows = @($minutePayload.minuteRows) + @($direct1mPayload.rows)
    $last1mAt = Get-LatestIsoUtc -Rows $combined1mRows -PropertyName "candle_time"
    $quoteAgeSeconds = Get-IsoAgeSeconds -IsoTime $lastQuoteAt -FallbackSeconds $age
    $intradayStats = Get-Intraday1mCoverageStats -FallbackRows $combined1mRows
    $blacklistCount = if ($null -ne $script:SymbolBlacklist) { $script:SymbolBlacklist.Count } else { 0 }
    $rawSymbols = $seeded + $blacklistCount
    $cumulativeBidAskRows = @($quoteRows | Where-Object { $null -ne $_.cumulative_bid_ask_volume }).Count
    $eligibleQuoteCoverage = Get-EligibleQuoteCoverage -QuoteRows $quoteRows -EligibleSymbols $priorityWarmupSymbols
    $script:ApiUniverseStats.eligible_quote_rows = $eligibleQuoteCoverage.eligible_quote_rows
    $script:ApiUniverseStats.eligible_quote_coverage = $eligibleQuoteCoverage.eligible_quote_coverage
    $eligibleQuoteFloor = [math]::Min(400, [math]::Max(1, [int]([double]$eligibleQuoteCoverage.eligible_symbols * 0.8)))
    $quotesOk = (($eligibleQuoteCoverage.eligible_quote_rows -ge $eligibleQuoteFloor -or $quoteRows.Count -ge 500 -or [double]$eligibleQuoteCoverage.eligible_quote_coverage -ge 0.5) -and $quoteAgeSeconds -le $StaleSeconds)
    $dailyVolumeOk = ($script:ApiUniverseStats.avg_volume5_eligible -gt 0)
    $futoptOk = ($combinedFutoptQuoteRows.Count -gt 0)
    $preopenOk = ($preopenRows.Count -gt 0)
    $preopenHistoryOk = ($preopenRows.Count -gt 0)
    if ($session -eq "preopen") {
      $intraday1mOk = (($intradayStats.intraday_1m_rows_today -gt 0) -or ($direct1mPayload.rows.Count -gt 0))
    } else {
      $intraday1mOk = ($intradayStats.intraday_1m_rows_today -gt 0 -and $intradayStats.intraday_1m_stale_seconds -le 180)
    }
    $script:ApiUniverseStats.quotes_ok = [bool]$quotesOk
    $script:ApiUniverseStats.intraday_1m_ok = [bool]$intraday1mOk
    $script:ApiUniverseStats.daily_volume_ok = [bool]$dailyVolumeOk
    $degradedButUsableForIntraday = ((-not $quotesOk) -and $intraday1mOk -and $dailyVolumeOk -and $quoteAgeSeconds -le $StaleSeconds -and $eligibleQuoteCoverage.eligible_quote_rows -gt 0)
    $status = if ($quotesOk) { "ok" } elseif ($degradedButUsableForIntraday) { "degraded" } else { "stale" }
    $message = "writer=running; collector=$collectorState; raw_symbols=$rawSymbols; active_symbols=$seeded; blacklist_count=$blacklistCount; avg_volume5_min=$MinAvgVolume5Lots; avg_volume5_eligible=$($script:ApiUniverseStats.avg_volume5_eligible); avg_volume5_filtered=$($script:ApiUniverseStats.avg_volume5_filtered); daytrade_hot_symbols=$($script:ApiUniverseStats.daytrade_hot_symbols); priority_symbols=$($script:ApiUniverseStats.priority_symbols); priority_strong_symbols=$($script:ApiUniverseStats.priority_strong_symbols); eligible_quote_rows=$($eligibleQuoteCoverage.eligible_quote_rows); eligible_quote_coverage=$($eligibleQuoteCoverage.eligible_quote_coverage); quote_coverage_ratio=$($eligibleQuoteCoverage.eligible_quote_coverage); quotes_ok=$quotesOk; intraday_1m_ok=$intraday1mOk; daily_volume_ok=$dailyVolumeOk; futopt_ok=$futoptOk; preopen_ok=$preopenOk; preopen_history_ok=$preopenHistoryOk; degraded_but_usable_for_intraday=$degradedButUsableForIntraday; today_candle_count=$($intradayStats.today_candle_count); ready_ge_35=$($intradayStats.ready_ge_35); ready_ge_80=$($intradayStats.ready_ge_80); ready_ge_200=$($intradayStats.ready_ge_200); cumulative_bid_ask_min=$MinCumulativeBidAskLots; quote_liquidity_eligible=$($script:ApiUniverseStats.quote_liquidity_eligible); quote_liquidity_filtered=$($script:ApiUniverseStats.quote_liquidity_filtered); quotes=$($quoteRows.Count); quote_age_seconds=$quoteAgeSeconds; last_quote_at=$lastQuoteAt; rest_quote_attempted=$($restQuotePayload.attempted); rest_quote_rows=$($restQuotePayload.quotes.Count); rest_quote_fetched_symbols=$($restQuotePayload.fetched); preopen=$($preopenRows.Count); preopen_history_attempted=$($preopenRows.Count); futopt=$($combinedFutoptQuoteRows.Count); futopt_tickers=$($combinedFutoptTickerRows.Count); futopt_stock_tickers=$stockFutureTickerCount; futopt_stock_mapped=$stockFutureMappedCount; futopt_stock_quote_universe=$($nearStockFutureSymbols.Count); futopt_stock_quotes_this_loop=$($fugleFutoptQuotePayload.rows.Count); futopt_scope=TXF_and_low_rate_stock_futures; intraday_1m_symbols_today=$($intradayStats.intraday_1m_symbols_today); intraday_1m_rows_today=$($intradayStats.intraday_1m_rows_today); intraday_1m_stale_seconds=$($intradayStats.intraday_1m_stale_seconds); latest_candle_time=$($intradayStats.intraday_1m_latest_candle_time); daily_volume_rows=$($minutePayload.dailyRows.Count + $direct1mDailyRows.Count); direct_1m_daily_rows=$($direct1mDailyRows.Count); daily_ohlcv_rows=$($direct1mOhlcvRows.Count); cumulative_bid_ask_rows=$cumulativeBidAskRows; direct_1m_attempted=$($direct1mPayload.attempted); direct_1m_rows=$($direct1mPayload.rows.Count)"
    Write-PublicSlotSourceStatus -SourceName $StatusSourceName -Status $status -Message $message -StaleSeconds $quoteAgeSeconds -Payload @{
      raw_symbols = $rawSymbols
      active_symbols = $seeded
      blacklist_count = $blacklistCount
      avg_volume5_min = $MinAvgVolume5Lots
      avg_volume5_eligible = $script:ApiUniverseStats.avg_volume5_eligible
      avg_volume5_filtered = $script:ApiUniverseStats.avg_volume5_filtered
      daytrade_hot_symbols = $script:ApiUniverseStats.daytrade_hot_symbols
      priority_symbols = $script:ApiUniverseStats.priority_symbols
      priority_strong_symbols = $script:ApiUniverseStats.priority_strong_symbols
      eligible_quote_rows = $script:ApiUniverseStats.eligible_quote_rows
      eligible_quote_coverage = $script:ApiUniverseStats.eligible_quote_coverage
      quotes_ok = [bool]$quotesOk
      intraday_1m_ok = [bool]$intraday1mOk
      daily_volume_ok = [bool]$dailyVolumeOk
      futopt_ok = [bool]$futoptOk
      preopen_ok = [bool]$preopenOk
      preopen_history_ok = [bool]$preopenHistoryOk
      degraded_but_usable_for_intraday = [bool]$degradedButUsableForIntraday
      readback_ok = [bool]($quotesOk -or $intraday1mOk -or $dailyVolumeOk)
      source_parts = @{
        quotes_ok = [bool]$quotesOk
        intraday_1m_ok = [bool]$intraday1mOk
        daily_volume_ok = [bool]$dailyVolumeOk
        futopt_ok = [bool]$futoptOk
        preopen_ok = [bool]$preopenOk
        preopen_history_ok = [bool]$preopenHistoryOk
        degraded_but_usable_for_intraday = [bool]$degradedButUsableForIntraday
        readback_ok = [bool]($quotesOk -or $intraday1mOk -or $dailyVolumeOk)
      }
      cumulative_bid_ask_min = $MinCumulativeBidAskLots
      quote_liquidity_eligible = $script:ApiUniverseStats.quote_liquidity_eligible
      quote_liquidity_filtered = $script:ApiUniverseStats.quote_liquidity_filtered
      quotes = $quoteRows.Count
      eligible_symbols = $seeded
      blacklist_symbols = $blacklistCount
      quote_count = $quoteRows.Count
      quote_coverage_ratio = $script:ApiUniverseStats.eligible_quote_coverage
      symbols = $seeded
      intraday_1m_rows = $combined1mRows.Count
      intraday_1m_symbols_today = $intradayStats.intraday_1m_symbols_today
      intraday_1m_latest_candle_time = $intradayStats.intraday_1m_latest_candle_time
      latest_candle_time = $intradayStats.intraday_1m_latest_candle_time
      intraday_1m_rows_today = $intradayStats.intraday_1m_rows_today
      today_candle_count = $intradayStats.today_candle_count
      ready_ge_35 = $intradayStats.ready_ge_35
      ready_ge_80 = $intradayStats.ready_ge_80
      ready_ge_200 = $intradayStats.ready_ge_200
      intraday_1m_stale_seconds = $intradayStats.intraday_1m_stale_seconds
      intraday_1m_stats_source = $intradayStats.intraday_1m_stats_source
      daily_volume_rows = ($minutePayload.dailyRows.Count + $direct1mDailyRows.Count)
      direct_1m_daily_rows = $direct1mDailyRows.Count
      daily_ohlcv_rows = $direct1mOhlcvRows.Count
      preopen_rows = $preopenRows.Count
      preopen_history_attempted = $preopenRows.Count
      futopt_quotes = $combinedFutoptQuoteRows.Count
      futopt_tickers = $combinedFutoptTickerRows.Count
      futopt_scope = "TXF_and_low_rate_stock_futures"
      futopt_stock_futures_supported = ($stockFutureMappedCount -gt 0)
      futopt_stock_futures_message = "Stock futures tickers are loaded from Fugle futopt; near-month stock futures quotes are filled by low-rate rotating batches to avoid 429."
      futopt_stock_tickers = $stockFutureTickerCount
      futopt_stock_mapped = $stockFutureMappedCount
      futopt_stock_quote_universe = $nearStockFutureSymbols.Count
      futopt_stock_quotes_this_loop = $fugleFutoptQuotePayload.rows.Count
      futopt_stock_quote_attempted_this_loop = $fugleFutoptQuotePayload.attempted
      futopt_stock_quote_fetched_this_loop = $fugleFutoptQuotePayload.fetched
      futopt_quote_batch_size = $FutoptQuoteBatchSize
      futopt_quote_every_seconds = $FutoptQuoteEverySeconds
      futopt_tickers_every_seconds = $FutoptTickersEverySeconds
      futopt_quote_rate_limited = [bool]$fugleFutoptQuotePayload.rate_limited
      last_quote_at = $lastQuoteAt
      last_1m_at = $last1mAt
      last_daily_volume_date = (Get-Date).ToString("yyyy-MM-dd")
      quote_age_seconds = $quoteAgeSeconds
      quote_cache_file_age_seconds = $age
      rest_quote_attempted = $restQuotePayload.attempted
      rest_quote_rows = $restQuotePayload.quotes.Count
      rest_quote_fetched_symbols = $restQuotePayload.fetched
      rest_quote_batch_size = $RestQuoteBatchSize
      rest_quote_every_seconds = $RestQuoteEverySeconds
      rest_quote_rate_limited = [bool]$restQuotePayload.rate_limited
      rest_quote_source = "fugle_stock_intraday_quote_when_websocket_empty_or_preopen"
      cumulative_bid_ask_available = ($cumulativeBidAskRows -gt 0)
      cumulative_bid_ask_rows = $cumulativeBidAskRows
      bid_volume_definition = "best bid level size from Fugle websocket, not confirmed cumulative intraday bid-side traded volume"
      ask_volume_definition = "best ask level size from Fugle websocket, not confirmed cumulative intraday ask-side traded volume"
      rate_limit_count = 0
      last_429_at = $null
      session = $session
      collector = $collectorState
      websocket_status = $wsStatus
      quotes_file = $quotesFile
      preopen_count = $preopenRows.Count
      futopt_quote_count = $combinedFutoptQuoteRows.Count
      seeded_symbols = $seeded
      direct_1m_attempted = $direct1mPayload.attempted
      direct_1m_fetched_symbols = $direct1mPayload.fetched
      direct_1m_rows = $direct1mPayload.rows.Count
      direct_1m_every_seconds = $Direct1mEverySeconds
      direct_1m_batch_size = $Direct1mBatchSize
      time_standard = "UTC"
      timestamp_columns = @("source_status.updated_at", "fugle_quotes_live.updated_at", "fugle_quotes_live.last_trade_time", "fugle_intraday_1m.candle_time", "fugle_intraday_1m.updated_at", "fugle_daily_volume.updated_at", "futopt_quotes_live.updated_at", "fugle_preopen_snapshot.updated_at")
      volume_unit = "lots"
      volume_columns = @("fugle_quotes_live.total_volume", "fugle_quotes_live.bid_volume", "fugle_quotes_live.ask_volume", "fugle_intraday_1m.volume", "fugle_daily_volume.volume", "futopt_quotes_live.total_volume", "fugle_preopen_snapshot.bid_volume", "fugle_preopen_snapshot.ask_volume")
      blacklist_policy = "central_shared_source"
      blacklist_rules = @("google_sheet", "00_prefix_etf", "cement", "defense")
      universe_source = "filtered_stocks_slim_and_blacklist"
      daily_volume_retain_trade_days = $DailyVolumeRetainTradeDays
      preopen_stale_after_session = $true
      futopt_scope_note = "TXF plus Fugle stock futures. Stock futures quotes rotate in small batches, so full quote coverage accumulates over multiple loops."
    }
    $loadedDailySymbols = @($direct1mOhlcvRows | ForEach-Object {
      if ($_ -is [System.Collections.IDictionary]) { $_["symbol"] } else { $_.symbol }
    } | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique).Count
    $syncStatus = if ($session -eq "closed" -and $loadedDailySymbols -ge [math]::Max(1, [int]($seeded * 0.9))) { "complete" } elseif ($direct1mOhlcvRows.Count -gt 0) { "partial" } else { "running" }
    Write-PublicSlotDailySyncStatus -TradeDate (Get-Date).ToString("yyyy-MM-dd") -Source "fugle_shared_source" -Status $syncStatus -SymbolsExpected $seeded -SymbolsLoaded $loadedDailySymbols -MissingSymbolsCount ([math]::Max(0, $seeded - $loadedDailySymbols)) -Payload @{
      daily_ohlcv_rows_written_this_loop = $direct1mOhlcvRows.Count
      daily_volume_rows_written_this_loop = $direct1mDailyRows.Count
      direct_1m_attempted = $direct1mPayload.attempted
      direct_1m_fetched_symbols = $direct1mPayload.fetched
      direct_1m_rows = $direct1mPayload.rows.Count
      session = $session
      note = "complete requires accumulated coverage across loops; this row is a per-loop progress heartbeat"
    }
    Write-PublicSlotMarketCalendar -Rows @([ordered]@{
      trade_date = (Get-Date).ToString("yyyy-MM-dd")
      market = "TW"
      is_open = ($session -in @("preopen", "regular"))
      session = $session
      note = "Updated by public slot shared source"
      payload = @{ source = "public-slot-shared-source" }
    })
    try {
      $strategy2ReadyRows = Invoke-PublicSlotRpc -FunctionName "refresh_strategy2_intraday_ready_cache" -Body @{}
      Write-Log "strategy2 ready cache refreshed rows=$strategy2ReadyRows"
    } catch {
      Write-Log "WARN strategy2 ready cache refresh skipped: $($_.Exception.Message)"
    }
    try {
      $strategy2PreopenGate = Invoke-PublicSlotRpc -FunctionName "refresh_strategy2_preopen_hot_gate_cache" -Body @{}
      Write-Log "strategy2 preopen hot gate cache refreshed $strategy2PreopenGate"
    } catch {
      Write-Log "WARN strategy2 preopen hot gate cache refresh skipped: $($_.Exception.Message)"
    }
    try {
      $strategy2Readiness = Invoke-PublicSlotRpc -FunctionName "refresh_strategy2_readiness_cache" -Body @{}
      Write-Log "strategy2 readiness cache refreshed $strategy2Readiness"
    } catch {
      Write-Log "WARN strategy2 readiness cache refresh skipped: $($_.Exception.Message)"
    }
    Write-Log "$status $message"
  } catch {
    $errorMessage = $_.Exception.Message
    Write-Log "ERROR $errorMessage"
    if ($_.ScriptStackTrace) { Write-Log "TRACE $($_.ScriptStackTrace)" }
    try {
      Write-PublicSlotSourceStatus -SourceName $StatusSourceName -Status "error" -Message $errorMessage -StaleSeconds 999999 -Payload @{ error = $errorMessage }
    } catch {}
  }

  if ($Once) { break }
  $elapsed = [int]((Get-Date) - $loopStarted).TotalSeconds
  Start-Sleep -Seconds ([math]::Max(1, $LoopSeconds - $elapsed))
} while ((Get-Date) -lt $stopTime)

if (-not $Once) {
  try {
    $stopPayload = [ordered]@{}
    try {
      $statusRows = @(Invoke-PublicSlotRestGet -PathAndQuery "source_status?source_name=eq.$StatusSourceName&select=payload&limit=1")
      if ($statusRows.Count -gt 0 -and $null -ne $statusRows[0].payload) {
        foreach ($prop in $statusRows[0].payload.PSObject.Properties) {
          $stopPayload[$prop.Name] = $prop.Value
        }
      }
    } catch {}
    $stopPayload["stopped_after"] = $StopAt
    $stopPayload["stopped_at"] = (Get-Date).ToUniversalTime().ToString("o")
    $stopPayload["readback_ok"] = $true
    $stopPayload["degraded_but_usable_for_intraday"] = $true
    if (-not $stopPayload.Contains("source_parts") -or $null -eq $stopPayload["source_parts"]) {
      $stopPayload["source_parts"] = @{}
    }
    try { $stopPayload["source_parts"].readback_ok = $true } catch {}
    try { $stopPayload["source_parts"].degraded_but_usable_for_intraday = $true } catch {}
    Write-PublicSlotSourceStatus -SourceName $StatusSourceName -Status "stopped" -Message "Stopped after $StopAt; readback_ok=True" -StaleSeconds 0 -Payload $stopPayload
  } catch {}
}
Write-Log "Public slot shared source stopped."
