param(
  [string]$TradeDate = "",
  [int]$Limit = 1600
)

$ErrorActionPreference = "Stop"
$runtimeDir = $env:FUMAN_RUNTIME_DIR
if (-not $runtimeDir) { $runtimeDir = "C:\fuman-runtime" }
$dataDir = Join-Path $runtimeDir "data\opening-limit-order"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

if (-not $TradeDate) {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  $TradeDate = [System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz).ToString("yyyy-MM-dd")
}
$compact = ($TradeDate -replace "\D", "").Substring(0, 8)
if ($Limit -lt 1600) {
  Write-Host ("[0831] ignore user Limit={0}; use full opening watchlist limit=1600" -f $Limit)
  $Limit = 1600
}

$preflightScript = Join-Path $PSScriptRoot "Run-OpeningLimitOrder0850PreflightReadonly.ps1"
$preflightPath = Join-Path $dataDir ("opening-limit-order-0850-preflight-{0}.json" -f $compact)
$receiptPath = Join-Path $dataDir ("opening-limit-order-0831-opening-report-prewarm-{0}.json" -f $compact)

Write-Host ("[0831] opening report prewarm trade_date={0} limit={1}" -f $TradeDate, $Limit)
& "C:\Program Files\PowerShell\7\pwsh.exe" -ExecutionPolicy Bypass -File $preflightScript -TradeDate $TradeDate -Limit $Limit
$exit = $LASTEXITCODE

$preflight = $null
if (Test-Path -LiteralPath $preflightPath) {
  $preflight = Get-Content -LiteralPath $preflightPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

$preflightValid = $null -ne $preflight -and $preflight.ok -eq $true -and $preflight.trade_date -eq $TradeDate
$static = if ($preflightValid) { $preflight.static_prefilter } else { $null }
$receipt = [ordered]@{
  # A valid same-day preflight receipt is authoritative. The child exit code
  # remains diagnostic because PowerShell/native stderr can set it despite a
  # complete JSON receipt being produced.
  ok = $preflightValid
  contract = "opening_limit_order_0831_opening_report_prewarm_readonly_v1"
  trade_date = $TradeDate
  checked_at = (Get-Date).ToUniversalTime().ToString("o")
  phase = "0831_opening_report_auto_prewarm"
  source = "opening_report_0830_industry_bias_json"
  allowed_action = "warmup_and_scan_priority_only"
  creates_order = $false
  creates_formal_candidate = $false
  publish_allowed = $false
  preflight_path = $preflightPath
  opening_report_files_accepted = $static.opening_report_files_accepted
  opening_report_mapped_symbol_count = $static.opening_report_mapped_symbol_count
  opening_report_priority_observation = $true
  strong_sector_return_readback = $true
  us_sector_up_1d_2d_trend_readback = $true
  watchlist_symbol_count = $preflight.watchlist_symbol_count
  watchlist_full_symbol_count = $preflight.watchlist_full_symbol_count
  preflight_exit_code = $exit
  preflight_exit_advisory = ($exit -ne 0)
  first_blocker = $(if ($null -eq $preflight) { "preflight_receipt_missing" } elseif ($preflight.trade_date -ne $TradeDate) { "preflight_trade_date_mismatch" } elseif ($preflight.ok -ne $true) { $preflight.first_blocker ?? "preflight_not_ok" } else { $null })
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
Write-Host ("[0831] receipt={0}" -f $receiptPath)
if (-not $receipt.ok) { exit 1 }
