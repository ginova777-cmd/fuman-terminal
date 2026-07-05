param(
  [string]$SupabaseUrl = $env:SUPABASE_URL,
  [string]$SupabaseKey = $env:SUPABASE_SERVICE_ROLE_KEY,
  [int]$TimeoutSeconds = 12
)

$ErrorActionPreference = "Stop"

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

$required = @(
  "mode",
  "fresh_quote_coverage_120s",
  "scanner_can_run_quote_only",
  "scanner_can_run_opening",
  "intraday_1m_stale_seconds",
  "ready_ma35_continuous",
  "futopt_stock_mapped",
  "opening_boost_not_active_while_coverage_low",
  "rest_quote_rate_limited_while_coverage_low",
  "fresh_quote_readthrough_not_running",
  "rest_quote_effective_batch_zero",
  "strategyPrioritySymbols",
  "dynamicMotherPoolSymbols",
  "collectorAdaptiveRpm"
)

$missing = @()
foreach ($name in $required) {
  if (-not ($row.PSObject.Properties.Name -contains $name)) {
    $missing += $name
  }
}
if ($missing.Count -gt 0) {
  throw "$view missing required column(s): $($missing -join ', ')"
}

if ([string]$row.mode -ne "read-only") {
  throw "$view mode must be `"read-only`"; current=$($row.mode)"
}

$summary = [ordered]@{
  ok = $true
  mode = "read-only"
  view = $view
  checkedAt = (Get-Date).ToUniversalTime().ToString("o")
  fresh_quote_coverage_120s = $row.fresh_quote_coverage_120s
  intraday_1m_stale_seconds = $row.intraday_1m_stale_seconds
  ready_ma35_continuous = $row.ready_ma35_continuous
  futopt_stock_mapped = $row.futopt_stock_mapped
}

$summary | ConvertTo-Json -Depth 6
