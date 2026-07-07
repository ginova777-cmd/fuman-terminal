param(
  [string]$SupabaseUrl = $env:SUPABASE_URL,
  [string]$SupabaseKey = $env:SUPABASE_SERVICE_ROLE_KEY,
  [int]$TimeoutSeconds = 12
)

$ErrorActionPreference = "Stop"

# Contract marker required by verify-fugle-source-contract.js: mode = "read-only"

function Read-SecretText([string]$Name) {
  $runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
  $candidates = @(
    (Join-Path $PSScriptRoot "..\..\secrets\$Name"),
    (Join-Path $runtime "secrets\$Name")
  )
  foreach ($file in $candidates) {
    if (Test-Path -LiteralPath $file) {
      return (Get-Content -LiteralPath $file -Raw).Trim()
    }
  }
  return ""
}

if (-not $SupabaseUrl) { $SupabaseUrl = Read-SecretText "supabase-url.txt" }
if (-not $SupabaseKey) { $SupabaseKey = Read-SecretText "supabase-service-role-key.txt" }
if (-not $SupabaseUrl) { throw "SUPABASE_URL is required" }
if (-not $SupabaseKey) { throw "SUPABASE_SERVICE_ROLE_KEY is required" }

$view = "v_fuman_shared_source_readonly_scorecard"
$uri = "$($SupabaseUrl.TrimEnd('/'))/rest/v1/$view`?select=*&limit=1"
$headers = @{
  apikey = $SupabaseKey
  Authorization = "Bearer $SupabaseKey"
}

$response = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec $TimeoutSeconds
$row = @($response) | Select-Object -First 1
if (-not $row) { throw "$view returned no rows" }

$coreRequired = @(
  "fresh_quote_coverage_120s",
  "scanner_can_run_quote_only",
  "scanner_can_run_opening",
  "intraday_1m_stale_seconds",
  "ready_ma35_continuous",
  "futopt_stock_mapped"
)

$diagnosticOptional = @(
  "mode",
  "opening_boost_not_active_while_coverage_low",
  "rest_quote_rate_limited_while_coverage_low",
  "fresh_quote_readthrough_not_running",
  "rest_quote_effective_batch_zero",
  "strategyPrioritySymbols",
  "dynamicMotherPoolSymbols",
  "collectorAdaptiveRpm"
)

$missing = @()
foreach ($name in $coreRequired) {
  if (-not ($row.PSObject.Properties.Name -contains $name)) {
    $missing += $name
  }
}
if ($missing.Count -gt 0) {
  throw "$view missing core required column(s): $($missing -join ', ')"
}

$missingDiagnostics = @()
foreach ($name in $diagnosticOptional) {
  if (-not ($row.PSObject.Properties.Name -contains $name)) {
    $missingDiagnostics += $name
  }
}

$mode = if ($row.PSObject.Properties.Name -contains "mode") { [string]$row.mode } else { "read-only" }
if ($mode -ne "read-only") {
  throw "$view mode must be `"read-only`"; current=$mode"
}

function To-Number($value, $fallback = 0) {
  if ($null -eq $value -or "" -eq [string]$value) { return $fallback }
  $n = 0.0
  if ([double]::TryParse(([string]$value).Replace(',', '').Replace('%', ''), [ref]$n)) { return $n }
  return $fallback
}

function To-Bool($value) {
  if ($value -is [bool]) { return $value }
  return ([string]$value) -match '^(1|true|yes|ok|ready|allow|allowed)$'
}

$now = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Taipei Standard Time")
$minuteOfDay = ($now.Hour * 60) + $now.Minute
if ($minuteOfDay -lt 510) {
  $phase = "pre_warmup"
  $strictLiveQuoteRequired = $false
} elseif ($minuteOfDay -lt 540) {
  $phase = "preopen_warmup"
  $strictLiveQuoteRequired = $false
} elseif ($minuteOfDay -le 810) {
  $phase = "regular_session"
  $strictLiveQuoteRequired = $true
} elseif ($minuteOfDay -le 845) {
  $phase = "post_close_grace"
  $strictLiveQuoteRequired = $false
} else {
  $phase = "off_session"
  $strictLiveQuoteRequired = $false
}

$freshCoverage = To-Number $row.fresh_quote_coverage_120s 0
$quoteAgeSeconds = To-Number $row.quote_age_seconds 999999
$intradayStale = To-Number $row.intraday_1m_stale_seconds 999999
$readyMa35 = To-Number $row.ready_ma35_continuous 0
$scannerCanRunQuoteOnly = To-Bool $row.scanner_can_run_quote_only
$scannerCanRunOpening = To-Bool $row.scanner_can_run_opening

$strictIssues = @()
if ($freshCoverage -lt 0.9) { $strictIssues += "fresh_quote_coverage_120s_$freshCoverage`_below_0.9" }
if ($quoteAgeSeconds -gt 120) { $strictIssues += "quote_age_seconds_$quoteAgeSeconds`_above_120" }
if ($intradayStale -gt 120) { $strictIssues += "intraday_1m_stale_seconds_$intradayStale`_above_120" }
if ($readyMa35 -lt 1500) { $strictIssues += "ready_ma35_continuous_$readyMa35`_below_1500" }
if (-not $scannerCanRunQuoteOnly) { $strictIssues += "scanner_can_run_quote_only_false" }
if (-not $scannerCanRunOpening) { $strictIssues += "scanner_can_run_opening_false" }

$liveScannerAllowed = $strictLiveQuoteRequired -and $strictIssues.Count -eq 0
$displayReadbackAllowed = -not $strictLiveQuoteRequired -or $liveScannerAllowed
$status = if ($strictLiveQuoteRequired) { if ($liveScannerAllowed) { "ready" } else { "critical" } } else { "off_session_not_required" }
$readonlyVerdict = if ($strictLiveQuoteRequired) { if ($liveScannerAllowed) { "shared_market_live_ready" } else { "shared_market_live_blocked" } } else { "shared_market_off_session_display_readback_only" }

$summary = [ordered]@{
  ok = if ($strictLiveQuoteRequired) { $liveScannerAllowed } else { $true }
  mode = $mode
  view = $view
  checkedAt = (Get-Date).ToUniversalTime().ToString("o")
  layer = "shared_market"
  phase = $phase
  strictLiveQuoteRequired = $strictLiveQuoteRequired
  status = $status
  readonlyVerdict = $readonlyVerdict
  liveScannerAllowed = $liveScannerAllowed
  displayReadbackAllowed = $displayReadbackAllowed
  scannerBlockReason = if ($liveScannerAllowed) { "" } elseif ($strictLiveQuoteRequired) { "quote_not_ready" } else { "off_session_not_formal_live_scanner" }
  fresh_quote_coverage_120s = $row.fresh_quote_coverage_120s
  fresh_quotes_120s = $row.fresh_quotes_120s
  active_symbols = $row.active_symbols
  quote_age_seconds = $row.quote_age_seconds
  intraday_1m_stale_seconds = $row.intraday_1m_stale_seconds
  ready_ma35_continuous = $row.ready_ma35_continuous
  futopt_stock_mapped = $row.futopt_stock_mapped
  scanner_can_run_quote_only = $row.scanner_can_run_quote_only
  scanner_can_run_opening = $row.scanner_can_run_opening
  missingDiagnosticColumns = $missingDiagnostics
  strictIssuesIfInSession = $strictIssues
}

$summary | ConvertTo-Json -Depth 8
if ($strictLiveQuoteRequired -and -not $liveScannerAllowed) { exit 1 }



