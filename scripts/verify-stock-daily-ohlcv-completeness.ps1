param(
  [string]$ProjectUrl = 'https://cpmpfhbzutkiecccekfr.supabase.co',
  [string]$RuntimeDir = 'C:\fuman-runtime',
  [string]$Resource = 'v_stock_daily_ohlcv',
  [int]$MinValidSymbols = 1500,
  [int]$RequiredTradingDays = 20,
  [int]$PageSize = 1000
)

$ErrorActionPreference = 'Stop'

function Read-Text([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  return (Get-Content -LiteralPath $Path -Raw).Trim()
}

function Get-Rows {
  param([string]$PathAndQuery, [string]$Key)
  $headers = @{ apikey = $Key; Authorization = "Bearer $Key"; Accept = 'application/json' }
  $rows = @()
  for ($offset = 0; $offset -lt 100000; $offset += $PageSize) {
    $separator = if ($PathAndQuery.Contains('?')) { '&' } else { '?' }
    $uri = "$($ProjectUrl.TrimEnd('/'))/rest/v1/$PathAndQuery${separator}offset=$offset&limit=$PageSize"
    $response = Invoke-WebRequest -Uri $uri -Headers $headers -Method Get -TimeoutSec 60
    $page = @($response.Content | ConvertFrom-Json)
    if ($page.Count -eq 0) { break }
    $rows += $page
    if ($page.Count -lt $PageSize) { break }
  }
  return $rows
}

function NumberOrNull($Value) {
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
  $number = 0.0
  if (-not [double]::TryParse(([string]$Value).Replace(',', ''), [ref]$number)) { return $null }
  if ($number -le 0) { return $null }
  return $number
}

$key = Read-Text (Join-Path $RuntimeDir 'secrets\supabase-anon-key.txt')
if ([string]::IsNullOrWhiteSpace($key)) { throw 'missing Supabase anon key' }

$select = 'symbol,market,trade_date,open,high,low,close,volume,updated_at'
$resourceQuery = "$Resource`?select=$select&order=trade_date.desc,symbol.asc"

try {
  $rows = @(Get-Rows -PathAndQuery $resourceQuery -Key $key)
} catch {
  [ordered]@{
    ok = $false
    resource = $Resource
    reasonCode = 'DAILY_OHLC_SOURCE_UNREADABLE'
    error = $_.Exception.Message
  } | ConvertTo-Json -Depth 8
  exit 1
}

$groups = @($rows | Group-Object -Property trade_date | Sort-Object Name -Descending)
$coverage = @()
foreach ($group in $groups) {
  $valid = @($group.Group | Where-Object {
    $null -ne (NumberOrNull $_.open) -and
    $null -ne (NumberOrNull $_.high) -and
    $null -ne (NumberOrNull $_.low) -and
    $null -ne (NumberOrNull $_.close)
  })
  $coverage += [ordered]@{
    tradeDate = [string]$group.Name
    rows = $group.Count
    ohlcRows = $valid.Count
    ohlcSymbols = @($valid | ForEach-Object { $_.symbol } | Sort-Object -Unique).Count
  }
}

$latest = if ($coverage.Count) { $coverage[0] } else { $null }
$tradingDays = @($coverage | Where-Object { $_.ohlcSymbols -gt 0 })
$recent = @($tradingDays | Select-Object -First $RequiredTradingDays)
$failedDays = @($recent | Where-Object { $_.ohlcSymbols -lt $MinValidSymbols })
$failures = @()
if ($null -eq $latest) { $failures += 'DAILY_OHLC_NO_ROWS' }
elseif ([int]$latest.ohlcSymbols -lt $MinValidSymbols) { $failures += 'DAILY_OHLC_LATEST_COVERAGE_LOW' }
if ($recent.Count -lt $RequiredTradingDays) { $failures += 'DAILY_OHLC_HISTORY_LESS_THAN_20_TRADING_DAYS' }
if ($failedDays.Count) { $failures += 'DAILY_OHLC_RECENT_DAY_COVERAGE_LOW' }

$result = [ordered]@{
  ok = ($failures.Count -eq 0)
  contract = 'stock-daily-ohlcv-completeness-v1'
  resource = $Resource
  latestTradeDate = if ($latest) { $latest.tradeDate } else { '' }
  latestValidOhlcSymbols = if ($latest) { $latest.ohlcSymbols } else { 0 }
  requiredMinValidSymbols = $MinValidSymbols
  recentTradingDaysChecked = $recent.Count
  requiredTradingDays = $RequiredTradingDays
  backfilledRecent20TradingDays = ($recent.Count -ge $RequiredTradingDays -and $failedDays.Count -eq 0)
  failures = $failures
  coverage = $coverage | Select-Object -First ([Math]::Max($RequiredTradingDays, 1))
  publishAllowed = ($failures.Count -eq 0)
  reasonCode = if ($failures.Count) { 'DAILY_OHLC_INCOMPLETE' } else { '' }
}
$result | ConvertTo-Json -Depth 20
if (-not $result.ok) { exit 1 }

