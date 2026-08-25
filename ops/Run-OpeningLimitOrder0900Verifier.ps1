param(
  [string]$TradeDate = "",
  [string]$TerminalDir = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$NodeExe = "C:\Program Files\nodejs\node.exe"
)

$ErrorActionPreference = 'Stop'

function Resolve-NodeExe {
  param([string]$Preferred)
  if ($Preferred -and (Test-Path -LiteralPath $Preferred)) { return $Preferred }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  throw 'node_exe_missing'
}

$terminalDir = $TerminalDir
$runtimeDir = $RuntimeDir
$node = Resolve-NodeExe -Preferred $NodeExe
$verifier = Join-Path $terminalDir 'scripts\verify-opening-limit-order-0855-readonly.js'
$tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('Taipei Standard Time')
if (!$TradeDate) { $TradeDate = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz).ToString('yyyy-MM-dd') }
$tradeDate = $TradeDate
$compact = $tradeDate.Replace('-', '')
$outDir = Join-Path $runtimeDir 'data\opening-limit-order'
$receiptPath = Join-Path $outDir "opening-limit-order-0900-verifier-$compact.json"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath $verifier)) { throw 'opening_limit_order_0900_verifier_dependency_missing' }
$calendarScript = Join-Path $terminalDir 'scripts\check-market-calendar-action.js'
if (!(Test-Path -LiteralPath $calendarScript)) { throw 'opening_limit_order_0900_market_calendar_missing' }
$calendarOutput = (& $node $calendarScript "--date=$tradeDate" "--label=OpeningLimitOrder0900Verifier" "--receipt=1" 2>&1 | Out-String).Trim()
try { $calendar = $calendarOutput | ConvertFrom-Json } catch { $calendar = $null }
if (!$calendar -or $calendar.marketOpen -ne $true -or $calendar.marketDate -ne $tradeDate) {
  $payload = [pscustomobject]@{
    ok = $true
    contract = 'opening_limit_order_0900_readonly_verifier_skip_v1'
    trade_date = $tradeDate
    first_blocker = 'market_calendar_non_trading_day'
    market_calendar = $calendar
    raw = $calendarOutput
    scheduled_runner = 'opening_limit_order_0900_verifier_v1'
    scheduled_at = [DateTimeOffset]::UtcNow.ToString('o')
  }
  $payload | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $receiptPath -Encoding utf8
  $payload | ConvertTo-Json -Depth 20
  exit 0
}
$output = (& $node --use-system-ca $verifier "--trade-date=$tradeDate" 2>&1 | Out-String).Trim()
$exitCode = $LASTEXITCODE
try { $payload = $output | ConvertFrom-Json } catch { $payload = [pscustomobject]@{ ok = $false; trade_date = $tradeDate; first_blocker = 'opening_limit_order_0900_verifier_output_invalid_json'; raw = $output } }
$payload | Add-Member -NotePropertyName scheduled_runner -NotePropertyValue 'opening_limit_order_0900_verifier_v1' -Force
$payload | Add-Member -NotePropertyName scheduled_at -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString('o')) -Force
$payload | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $receiptPath -Encoding utf8
$payload | ConvertTo-Json -Depth 20
if ($exitCode -ne 0 -or $payload.ok -ne $true) { exit 1 }
exit 0
