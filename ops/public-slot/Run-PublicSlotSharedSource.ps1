param(
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$SourceName = "fugle_shared_source",
  [int]$LoopSeconds = 10,
  [int]$StaleSeconds = 45,
  [int]$SeedSymbolCount = 2000,
  [int]$QuoteKeepMinutes = 480,
  [int]$DailyVolumeRetainTradeDays = 20,
  [int]$Direct1mBatchSize = 3,
  [int]$Direct1mEverySeconds = 300,
  [string]$BlacklistCsvUrl = "https://docs.google.com/spreadsheets/d/1NHFgGryPyktbf1YLlUaXtIId_e5aF9LPE_glQrcN2V0/export?format=csv&gid=32050833",
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
$BlacklistCacheFile = Join-Path $LogDir "fugle-api-blacklist-symbols-cache.txt"
$LogFile = Join-Path $LogDir ("public-slot-shared-source-{0}.log" -f (Get-Date -Format "yyyyMMdd"))

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

function Get-Intraday1mCoverageStats {
  param([object[]]$FallbackRows = @())

  $stats = @{
    intraday_1m_symbols_today = 0
    intraday_1m_latest_candle_time = $null
    intraday_1m_rows_today = 0
    intraday_1m_stale_seconds = 999999
    intraday_1m_stats_source = "fallback_current_batch"
  }

  try {
    $viewRows = @(Invoke-PublicSlotRestGet -PathAndQuery "v_fugle_intraday_1m_status?select=symbol,latest_candle_time,candle_count,rows_today,has_today_data&has_today_data=eq.true&limit=5000")
    if ($viewRows.Count -gt 0) {
      $latest = Get-LatestIsoUtc -Rows $viewRows -PropertyName "latest_candle_time"
      $rowsToday = 0
      foreach ($row in $viewRows) {
        if ($null -ne $row.rows_today) { $rowsToday += [int]$row.rows_today }
      }
      $stats.intraday_1m_symbols_today = $viewRows.Count
      $stats.intraday_1m_latest_candle_time = $latest
      $stats.intraday_1m_rows_today = $rowsToday
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
  $stats.intraday_1m_stale_seconds = Get-IsoAgeSeconds -IsoTime $latestFallback
  return $stats
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
    Write-Log "WARN blacklist sheet unavailable; using local/cache blacklist: $($_.Exception.Message)"
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
  return @(Remove-BlacklistedSymbols -Symbols (@($symbols | Select-Object -Unique)) -Blacklist $script:SymbolBlacklist | Select-Object -First $SeedSymbolCount)
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
      $rows.Add([ordered]@{
        symbol = $Symbol
        market = $market
        trade_date = $parsed.ToString("yyyy-MM-dd")
        candle_time = $time
        open = Get-Number $item.open
        high = Get-Number $item.high
        low = Get-Number $item.low
        close = $close
        volume = Convert-VolumeToLots $item.volume
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
  if (Test-ProcessAlive $status.pid) { return "already-running pid=$($status.pid)" }

  $nodeExe = "C:\Program Files\nodejs\node.exe"
  $collector = Join-Path $FumanRoot "scripts\fugle-websocket-collector.js"
  if (-not (Test-Path -LiteralPath $nodeExe)) { return "node missing: $nodeExe" }
  if (-not (Test-Path -LiteralPath $collector)) { return "collector missing: $collector" }

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $nodeExe
  $psi.Arguments = "`"$collector`""
  $psi.WorkingDirectory = $FumanRoot
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
    $updatedAt = Get-QuoteTimestamp -Quote $quote -Payload $Payload
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
    $rows.Add([ordered]@{
      symbol = $symbol
      name = $quoteName
      market = Convert-Market ([string]$quote.market)
      updated_at = $updatedAt
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
      session = "regular"
      last_trade_time = $updatedAt
      is_halted = $false
      is_trial = $false
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
    $referencePrice = Get-Number $quote.prevClose
    $trialPrice = Get-Number $quote.close
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
      is_trial = ((Get-PublicSlotSession) -eq "preopen")
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
  $rows = New-Object System.Collections.Generic.List[object]
  $daily = New-Object System.Collections.Generic.List[object]
  $today = (Get-Date).ToString("yyyy-MM-dd")

  foreach ($quote in $QuoteRows) {
    $symbol = [string]$quote.symbol
    $minute = ([datetimeoffset]::Parse([string]$quote.updated_at)).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:00Z")
    $price = Get-Number $quote.price
    $totalVolume = [int64](Convert-VolumeToLots $quote.total_volume)
    if ($price -le 0 -or $symbol -notmatch '^\d{4}$') { continue }

    $bucket = $state.buckets.$symbol
    if ($null -eq $bucket -or [string]$bucket.minute -ne $minute) {
      $bucket = [pscustomobject]@{
        minute = $minute
        open = $price
        high = $price
        low = $price
        close = $price
        start_volume = $totalVolume
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

    $rows.Add([ordered]@{
      symbol = $symbol
      market = [string]$quote.market
      trade_date = $today
      candle_time = $minute
      open = Get-Number $bucket.open
      high = Get-Number $bucket.high
      low = Get-Number $bucket.low
      close = Get-Number $bucket.close
      volume = [int64]([math]::Max(0, [int64]$bucket.last_volume - [int64]$bucket.start_volume))
      updated_at = (Get-Date).ToUniversalTime().ToString("o")
      payload = @{ source = "fugle-ws-aggregate"; total_volume = $totalVolume; volume_unit = "lots"; time_standard = "UTC" }
    })

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

    $quoteRows = Convert-QuotesToRows -Quotes $quotes -Payload $payload
    $preopenRows = Convert-QuotesToPreopenRows -Quotes $quotes -Payload $payload
    $minutePayload = Update-MinuteRows -QuoteRows $quoteRows
    $direct1mPayload = Invoke-Direct1mWarmupBatch -Symbols (Get-WarmupSymbols) -ApiKey $fugleApiKey
    $txfPayload = Convert-TaifexToFutoptRows -Payload (Invoke-TaifexFuturesQuote -Cid "TXF") -Product "TXF"

    if ($quoteRows.Count -gt 0) { Write-PublicSlotQuotesLive -Rows $quoteRows }
    if ($minutePayload.minuteRows.Count -gt 0) { Write-PublicSlotIntraday1m -Rows $minutePayload.minuteRows }
    if ($direct1mPayload.rows.Count -gt 0) { Write-PublicSlotIntraday1m -Rows $direct1mPayload.rows }
    if ($minutePayload.dailyRows.Count -gt 0) { Write-PublicSlotDailyVolume -Rows $minutePayload.dailyRows }
    if ($preopenRows.Count -gt 0) { Write-PublicSlotPreopenSnapshot -Rows $preopenRows }
    if ($preopenRows.Count -gt 0) { Write-PublicSlotPreopenSnapshotHistory -Rows $preopenRows }
    if ($txfPayload.quotes.Count -gt 0) { Write-PublicSlotFutoptQuotesLive -Rows $txfPayload.quotes }
    if ($txfPayload.tickers.Count -gt 0) { Write-PublicSlotFutoptTickers -Rows $txfPayload.tickers }
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

    $lastQuoteAt = Get-LatestIsoUtc -Rows $quoteRows -PropertyName "updated_at"
    $combined1mRows = @($minutePayload.minuteRows) + @($direct1mPayload.rows)
    $last1mAt = Get-LatestIsoUtc -Rows $combined1mRows -PropertyName "candle_time"
    $quoteAgeSeconds = Get-IsoAgeSeconds -IsoTime $lastQuoteAt -FallbackSeconds $age
    $intradayStats = Get-Intraday1mCoverageStats -FallbackRows $combined1mRows
    $session = Get-PublicSlotSession
    $status = if ($quoteRows.Count -gt 0 -and $quoteAgeSeconds -le $StaleSeconds) { "ok" } else { "stale" }
    $blacklistCount = if ($null -ne $script:SymbolBlacklist) { $script:SymbolBlacklist.Count } else { 0 }
    $rawSymbols = $seeded + $blacklistCount
    $cumulativeBidAskRows = @($quoteRows | Where-Object { $null -ne $_.cumulative_bid_ask_volume }).Count
    $message = "writer=running; collector=$collectorState; raw_symbols=$rawSymbols; active_symbols=$seeded; blacklist_count=$blacklistCount; quotes=$($quoteRows.Count); quote_age_seconds=$quoteAgeSeconds; last_quote_at=$lastQuoteAt; preopen=$($preopenRows.Count); preopen_history_attempted=$($preopenRows.Count); futopt=$($txfPayload.quotes.Count); intraday_1m_symbols_today=$($intradayStats.intraday_1m_symbols_today); intraday_1m_rows_today=$($intradayStats.intraday_1m_rows_today); intraday_1m_stale_seconds=$($intradayStats.intraday_1m_stale_seconds); latest_candle_time=$($intradayStats.intraday_1m_latest_candle_time); cumulative_bid_ask_rows=$cumulativeBidAskRows; direct_1m_attempted=$($direct1mPayload.attempted); direct_1m_rows=$($direct1mPayload.rows.Count)"
    Write-PublicSlotSourceStatus -SourceName $StatusSourceName -Status $status -Message $message -StaleSeconds $quoteAgeSeconds -Payload @{
      raw_symbols = $rawSymbols
      active_symbols = $seeded
      blacklist_count = $blacklistCount
      quotes = $quoteRows.Count
      eligible_symbols = $seeded
      blacklist_symbols = $blacklistCount
      quote_count = $quoteRows.Count
      symbols = $seeded
      intraday_1m_rows = $combined1mRows.Count
      intraday_1m_symbols_today = $intradayStats.intraday_1m_symbols_today
      intraday_1m_latest_candle_time = $intradayStats.intraday_1m_latest_candle_time
      latest_candle_time = $intradayStats.intraday_1m_latest_candle_time
      intraday_1m_rows_today = $intradayStats.intraday_1m_rows_today
      intraday_1m_stale_seconds = $intradayStats.intraday_1m_stale_seconds
      intraday_1m_stats_source = $intradayStats.intraday_1m_stats_source
      daily_volume_rows = $minutePayload.dailyRows.Count
      preopen_rows = $preopenRows.Count
      preopen_history_attempted = $preopenRows.Count
      futopt_quotes = $txfPayload.quotes.Count
      futopt_tickers = $txfPayload.tickers.Count
      last_quote_at = $lastQuoteAt
      last_1m_at = $last1mAt
      last_daily_volume_date = (Get-Date).ToString("yyyy-MM-dd")
      quote_age_seconds = $quoteAgeSeconds
      quote_cache_file_age_seconds = $age
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
      futopt_quote_count = $txfPayload.quotes.Count
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
      futopt_scope = "TXF live quotes; futopt_tickers keeps mapping when available"
    }
    Write-PublicSlotMarketCalendar -Rows @([ordered]@{
      trade_date = (Get-Date).ToString("yyyy-MM-dd")
      market = "TW"
      is_open = ($session -in @("preopen", "regular"))
      session = $session
      note = "Updated by public slot shared source"
      payload = @{ source = "public-slot-shared-source" }
    })
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
    Write-PublicSlotSourceStatus -SourceName $StatusSourceName -Status "stopped" -Message "Stopped after $StopAt" -StaleSeconds 0 -Payload @{}
  } catch {}
}
Write-Log "Public slot shared source stopped."
