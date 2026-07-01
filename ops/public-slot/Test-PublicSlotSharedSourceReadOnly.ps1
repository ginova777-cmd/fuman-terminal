param(
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$AnonKey = "",
  [int]$MaxSourceAgeSeconds = 90,
  [double]$MinFreshQuoteCoverage120 = 0.90,
  [int]$MinFreshQuoteCount120 = 1500,
  [int]$MaxQuoteAgeSeconds = 60,
  [int]$MaxIntraday1mStaleSeconds = 120,
  [int]$MinReadyMa35Continuous = 1500,
  [int]$MinFutoptMapped = 1,
  [int]$MinFutoptThisLoop = 1,
  [string]$OpeningBoostStart = "08:45",
  [string]$OpeningBoostEnd = "12:00",
  [switch]$JsonOnly
)

$ErrorActionPreference = "Stop"

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

function Convert-ToNumber {
  param([object]$Value, [double]$Default = 0)
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $Default }
  $text = ([string]$Value).Replace(",", "").Replace("%", "").Trim()
  $number = 0.0
  if ([double]::TryParse($text, [ref]$number)) { return $number }
  return $Default
}

function Convert-ToBool {
  param([object]$Value)
  if ($Value -is [bool]) { return [bool]$Value }
  return ([string]$Value) -match "^(1|true|yes|ok|ready)$"
}

function Convert-HHmmToTimeSpan {
  param([string]$Value)
  try {
    $parts = $Value.Split(":")
    return New-TimeSpan -Hours ([int]$parts[0]) -Minutes ([int]$parts[1])
  } catch {
    return New-TimeSpan -Hours 0
  }
}

function Test-InTimeWindow {
  param([string]$Start, [string]$End)
  $now = (Get-Date).TimeOfDay
  $startTs = Convert-HHmmToTimeSpan $Start
  $endTs = Convert-HHmmToTimeSpan $End
  return ($now -ge $startTs -and $now -le $endTs)
}

if ([string]::IsNullOrWhiteSpace($AnonKey)) {
  $AnonKey = Read-TextSecret -Paths @(
    (Join-Path $RuntimeDir "secrets\supabase-anon-key.txt"),
    (Join-Path $PSScriptRoot "..\..\secrets\supabase-anon-key.txt")
  )
}
if ([string]::IsNullOrWhiteSpace($AnonKey)) {
  throw "SUPABASE_ANON_KEY is required for read-only scorecard checks."
}

$headers = @{
  apikey = $AnonKey
  Authorization = "Bearer $AnonKey"
}

$uri = "$($ProjectUrl.TrimEnd('/'))/rest/v1/v_fuman_shared_source_readonly_scorecard?select=*&limit=1"
$rows = @(Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 15)
$issues = New-Object System.Collections.Generic.List[object]
$warnings = New-Object System.Collections.Generic.List[object]

if ($rows.Count -lt 1) {
  $issues.Add(@{ issue = "readonly_scorecard_missing"; detail = @{ view = "v_fuman_shared_source_readonly_scorecard" } })
  $result = @{
    ok = $false
    status = "critical"
    issues = $issues
    warnings = $warnings
    evidence = @{ rowCount = 0; checkedAt = (Get-Date).ToUniversalTime().ToString("o") }
  }
  $result | ConvertTo-Json -Depth 20
  exit 2
}

$row = $rows[0]
$sourceAge = [int](Convert-ToNumber $row.source_status_age_seconds 999999)
$freshCoverage = [double](Convert-ToNumber $row.fresh_quote_coverage_120s 0)
$freshQuotes = [int](Convert-ToNumber $row.fresh_quotes_120s 0)
$quoteAge = [int](Convert-ToNumber $row.quote_age_seconds 999999)
$intradayStale = [int](Convert-ToNumber $row.intraday_1m_stale_seconds 999999)
$readyMa35 = [int](Convert-ToNumber $row.ready_ma35_continuous 0)
$futoptMapped = [int](Convert-ToNumber $row.futopt_stock_mapped 0)
$futoptThisLoop = [int](Convert-ToNumber $row.futopt_stock_this_loop 0)
$scannerQuoteOnly = Convert-ToBool $row.scanner_can_run_quote_only
$scannerOpening = Convert-ToBool $row.scanner_can_run_opening
$openingBoostActive = Convert-ToBool $row.opening_boost_active
$restQuoteRateLimited = Convert-ToBool $row.rest_quote_rate_limited
$restEffectiveBatch = [int](Convert-ToNumber $row.rest_quote_effective_batch_size 0)
$readthroughRows = [int](Convert-ToNumber $row.fresh_quote_readthrough_rows 0)
$activeSymbols = [int](Convert-ToNumber $row.active_symbols 0)
$quotes = [int](Convert-ToNumber $row.quotes 0)
$inOpeningBoostWindow = Test-InTimeWindow -Start $OpeningBoostStart -End $OpeningBoostEnd

if ($sourceAge -gt $MaxSourceAgeSeconds) {
  $issues.Add(@{ issue = "source_status_stale"; detail = @{ ageSeconds = $sourceAge; max = $MaxSourceAgeSeconds } })
}
if ($freshCoverage -lt $MinFreshQuoteCoverage120) {
  $issues.Add(@{ issue = "fresh_quote_coverage_low"; detail = @{ coverage = $freshCoverage; min = $MinFreshQuoteCoverage120; activeSymbols = $activeSymbols; quotes = $quotes } })
}
if ($freshCoverage -lt $MinFreshQuoteCoverage120 -and $restQuoteRateLimited) {
  $issues.Add(@{ issue = "rest_quote_rate_limited_while_coverage_low"; detail = @{ coverage = $freshCoverage; restQuoteRateLimited = $restQuoteRateLimited } })
}
if ($freshQuotes -lt $MinFreshQuoteCount120) {
  $issues.Add(@{ issue = "fresh_quote_count_low"; detail = @{ freshQuotes120s = $freshQuotes; min = $MinFreshQuoteCount120 } })
}
if ($quoteAge -gt $MaxQuoteAgeSeconds) {
  $issues.Add(@{ issue = "quote_age_too_old"; detail = @{ ageSeconds = $quoteAge; max = $MaxQuoteAgeSeconds } })
}
if (-not $scannerQuoteOnly) {
  $issues.Add(@{ issue = "scanner_can_run_quote_only_false"; detail = @{ scannerBlockReason = $row.scanner_block_reason } })
}
if (-not $scannerOpening) {
  $issues.Add(@{ issue = "scanner_can_run_opening_false"; detail = @{ scannerBlockReason = $row.scanner_block_reason } })
}
if ($intradayStale -gt $MaxIntraday1mStaleSeconds) {
  $issues.Add(@{ issue = "intraday_1m_stale"; detail = @{ staleSeconds = $intradayStale; max = $MaxIntraday1mStaleSeconds } })
}
if ($readyMa35 -lt $MinReadyMa35Continuous) {
  $issues.Add(@{ issue = "ma35_continuous_not_ready"; detail = @{ readyMa35Continuous = $readyMa35; min = $MinReadyMa35Continuous } })
}
if ($futoptMapped -lt $MinFutoptMapped) {
  $issues.Add(@{ issue = "futopt_underlying_mapping_missing"; detail = @{ futoptStockMapped = $futoptMapped; min = $MinFutoptMapped } })
}
if ($futoptThisLoop -lt $MinFutoptThisLoop) {
  $warnings.Add(@{ warning = "futopt_this_loop_low"; detail = @{ futoptStockThisLoop = $futoptThisLoop; min = $MinFutoptThisLoop } })
}
if ($inOpeningBoostWindow -and $freshCoverage -lt $MinFreshQuoteCoverage120) {
  if (-not $openingBoostActive) {
    $issues.Add(@{ issue = "opening_boost_not_active_while_coverage_low"; detail = @{ openingBoostWindow = $row.opening_boost_window; expectedWindow = "$OpeningBoostStart-$OpeningBoostEnd" } })
  }
  if ($restEffectiveBatch -le 0) {
    $issues.Add(@{ issue = "rest_quote_effective_batch_zero"; detail = @{ restQuoteEffectiveBatchSize = $restEffectiveBatch } })
  }
  if ($readthroughRows -le 0) {
    $issues.Add(@{ issue = "fresh_quote_readthrough_not_running"; detail = @{ freshQuoteReadthroughRows = $readthroughRows } })
  }
}

$ok = ($issues.Count -eq 0)
$status = if ($ok) { if ($warnings.Count -gt 0) { "warning" } else { "ok" } } else { "critical" }
$result = @{
  ok = $ok
  status = $status
  checkedAt = (Get-Date).ToUniversalTime().ToString("o")
  mode = "read-only"
  source = "v_fuman_shared_source_readonly_scorecard"
  issues = $issues
  warnings = $warnings
  evidence = @{
    sourceStatus = $row.source_status
    readonlyVerdict = $row.readonly_verdict
    sourceStatusAgeSeconds = $sourceAge
    activeSymbols = $activeSymbols
    quotes = $quotes
    freshQuotes120s = $freshQuotes
    freshQuoteCoverage120s = $freshCoverage
    quoteAgeSeconds = $quoteAge
    scannerBlockReason = $row.scanner_block_reason
    scannerCanRunQuoteOnly = $scannerQuoteOnly
    scannerCanRunOpening = $scannerOpening
    intraday1mStaleSeconds = $intradayStale
    readyMa20Continuous = [int](Convert-ToNumber $row.ready_ma20_continuous 0)
    readyMa35Continuous = $readyMa35
    futoptStockMapped = $futoptMapped
    futoptStockThisLoop = $futoptThisLoop
    openingBoostActive = $openingBoostActive
    openingBoostWindow = $row.opening_boost_window
    restQuoteRateLimited = $restQuoteRateLimited
    restQuoteEffectiveBatchSize = $restEffectiveBatch
    freshQuoteReadthroughRows = $readthroughRows
    writerComputer = $row.writer_computer
    writerOwnerComputer = $row.writer_owner_computer
  }
}

if (-not $JsonOnly) {
  Write-Host ("[shared-source-readonly] status={0} quoteCoverage120={1} freshQuotes120={2} quoteAge={3}s scannerOpening={4} ma35={5} futoptMapped={6}" -f $status, $freshCoverage, $freshQuotes, $quoteAge, $scannerOpening, $readyMa35, $futoptMapped)
}
$result | ConvertTo-Json -Depth 30
if (-not $ok) { exit 2 }
if ($warnings.Count -gt 0) { exit 1 }
exit 0
