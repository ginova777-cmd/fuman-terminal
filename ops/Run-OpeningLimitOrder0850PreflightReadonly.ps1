param(
  [string]$TradeDate = "",
  [int]$Limit = 1600,
  [switch]$WaitUntil0850,
  [string]$TerminalDir = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"

function Resolve-NodeExe {
  $preferred = "C:\Program Files\nodejs\node.exe"
  if (Test-Path -LiteralPath $preferred) { return $preferred }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  throw "node_exe_missing"
}
function Get-TaipeiNow {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  return [System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz)
}

function Wait-Until0850 {
  while ($true) {
    $now = Get-TaipeiNow
    $target = Get-Date -Date ($now.ToString("yyyy-MM-dd") + " 08:50:00")
    if ($now -ge $target) { return }
    Start-Sleep -Seconds ([Math]::Min(60, [Math]::Max(1, [int]($target - $now).TotalSeconds)))
  }
}

function Write-Receipt {
  param([string]$Path, [object]$Receipt)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $Receipt | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $Path -Encoding UTF8
}

if (!$TradeDate) { $TradeDate = (Get-TaipeiNow).ToString("yyyy-MM-dd") }
$compactDate = $TradeDate -replace "[^\d]", ""
$preflightPath = Join-Path $RuntimeDir ("data\opening-limit-order\opening-limit-order-0850-preflight-{0}.json" -f $compactDate)
$engine = Join-Path $TerminalDir "ops\Run-OpeningLimitOrder0850PreflightReadonly.engine-v2.ps1"

if (!(Test-Path -LiteralPath $TerminalDir)) { throw "terminal_dir_missing:$TerminalDir" }
if (!(Test-Path -LiteralPath $engine)) { throw "opening_limit_order_preopen_engine_missing:$engine" }

Push-Location $TerminalDir
try {
  $nodeExe = Resolve-NodeExe
  # This runs before waiting or loading a market source, so non-trading days never warm or publish a list.
  $calendarText = ((& $nodeExe "scripts\check-market-calendar-action.js" "--date=$TradeDate" "--label=OpeningLimitOrder0850" 2>&1) | Out-String).Trim()
  $calendarExitCode = $LASTEXITCODE
  try { $calendar = $calendarText | ConvertFrom-Json } catch { $calendar = $null }
  if (!$calendar) {
    $receipt = [ordered]@{
      ok = $false; contract = "opening_limit_order_0850_preflight_v3"; trade_date = $TradeDate
      checked_at = (Get-Date).ToUniversalTime().ToString("o"); status = "BLOCKED_CALENDAR"
      first_blocker = "market_calendar_unreadable"; reason_code = "market_calendar_unreadable"
      calendar_exit_code = $calendarExitCode; calendar_raw = $calendarText
      action_guard = [ordered]@{ creates_order = $false; creates_formal_candidate = $false; publish_allowed = $false; requires_second_confirm_before_action = $true }
      formal_candidate_count = 0; formal_candidate_allowed = $false; publish_allowed = $false
    }
    Write-Receipt -Path $preflightPath -Receipt $receipt
    $receipt | ConvertTo-Json -Depth 40
    exit 1
  }
  if ($calendar.marketOpen -ne $true -or $calendar.marketDate -ne $TradeDate) {
    $receipt = [ordered]@{
      ok = $true; contract = "opening_limit_order_0850_preflight_v3"; trade_date = $TradeDate
      checked_at = (Get-Date).ToUniversalTime().ToString("o"); status = "SKIP_NON_TRADING_DAY"
      market_calendar = $calendar; first_blocker = "market_calendar_non_trading_day"; reason_code = "market_calendar_non_trading_day"
      action_guard = [ordered]@{ creates_order = $false; creates_formal_candidate = $false; publish_allowed = $false; requires_second_confirm_before_action = $true }
      formal_candidate_count = 0; formal_candidate_allowed = $false; publish_allowed = $false
    }
    Write-Receipt -Path $preflightPath -Receipt $receipt
    $receipt | ConvertTo-Json -Depth 40
    exit 0
  }
  if ($Limit -lt 1600) { Write-Host ("[0850] ignore user Limit={0}; use full opening watchlist limit=1600" -f $Limit); $Limit = 1600 }
if ($WaitUntil0850) { Wait-Until0850 }

  # The engine completes static warmup at 08:50 and freezes the one pre-open result at 08:55.
  & "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File $engine -TradeDate $TradeDate -Limit $Limit -TerminalDir $TerminalDir -RuntimeDir $RuntimeDir
  exit $LASTEXITCODE
} finally { Pop-Location }







