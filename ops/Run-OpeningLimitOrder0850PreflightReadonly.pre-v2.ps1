param(
  [string]$TradeDate = "",
  [int]$Limit = 160,
  [switch]$WaitUntil0850,
  [string]$TerminalDir = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"

function Get-TaipeiNow {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  [System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz)
}

function Wait-UntilTaipeiTime {
  param([string]$Time, [string]$Label)
  while ($true) {
    $now = Get-TaipeiNow
    $target = Get-Date -Date ("{0} {1}" -f $now.ToString("yyyy-MM-dd"), $Time)
    if ($now -ge $target) { return }
    $seconds = [Math]::Min(60, [Math]::Max(1, [int]($target - $now).TotalSeconds))
    Write-Host ("waiting_{0}_taipei now={1} target={2} sleep_seconds={3}" -f $Label, $now.ToString("HH:mm:ss"), $target.ToString("HH:mm:ss"), $seconds)
    Start-Sleep -Seconds $seconds
  }
}

function Write-JsonFile {
  param([string]$Path, [object]$Payload)
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $Payload | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $Path -Encoding UTF8
}

if (!$TradeDate) { $TradeDate = (Get-TaipeiNow).ToString("yyyy-MM-dd") }
if ($WaitUntil0850) { Wait-UntilTaipeiTime -Time "08:50:00" -Label "until_0850" }

$compactDate = $TradeDate -replace "[^\d]", ""
$outDir = Join-Path $RuntimeDir "data\opening-limit-order"
$watchlistPath = Join-Path $outDir ("opening-limit-order-0855-watchlist-{0}.json" -f $compactDate)
$preflightPath = Join-Path $outDir ("opening-limit-order-0850-preflight-{0}.json" -f $compactDate)
$legacyRunner = Join-Path $TerminalDir "ops\Run-OpeningLimitOrder0855Readonly.ps1"

if (!(Test-Path -LiteralPath $TerminalDir)) { throw "terminal_dir_missing:$TerminalDir" }
if (!(Test-Path -LiteralPath $legacyRunner)) { throw "opening_limit_order_0855_runner_missing:$legacyRunner" }

Push-Location $TerminalDir
try {
  # 08:50 only prepares the stock universe. It cannot create an order, a formal candidate, or a publish.
  Write-Host ("[0850] build opening-entry watchlist trade_date={0} limit={1}" -f $TradeDate, $Limit)
  $watchlistRaw = & node "scripts\build-opening-limit-order-watchlist.js" "--trade-date=$TradeDate" "--limit=$Limit" "--out=$watchlistPath"
  $watchlistText = ($watchlistRaw | Out-String).Trim()
  if (!$watchlistText) { throw "opening_limit_order_0850_watchlist_no_output" }
  $watchlist = $watchlistText | ConvertFrom-Json
  $preflight = [ordered]@{
    ok = ($LASTEXITCODE -eq 0 -and $watchlist.ok -eq $true)
    contract = "opening_limit_order_0850_preflight_v1"
    trade_date = $TradeDate
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
    phase = "0850_preopen_watchlist_warmup"
    candidate_deadline = "08:55:00 Asia/Taipei"
    watchlist_path = $watchlistPath
    watchlist_symbol_count = $watchlist.symbol_count
    opening_report_run_ids = $watchlist.sources.opening_report.run_ids
    action_guard = $watchlist.action_guard
    formal_candidate_count = 0
    formal_candidate_allowed = $false
    publish_allowed = $false
    first_blocker = if ($watchlist.first_blocker) { $watchlist.first_blocker } else { $null }
  }
  Write-JsonFile -Path $preflightPath -Payload $preflight
  if ($preflight.ok -ne $true) { $preflight | ConvertTo-Json -Depth 80; exit 1 }

  # The 08:55 result is the pre-open watchlist only. Formal decisions remain forbidden until 09:00 confirmation.
  Wait-UntilTaipeiTime -Time "08:55:00" -Label "until_0855"
  & "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File $legacyRunner -TradeDate $TradeDate -Limit $Limit -TerminalDir $TerminalDir -RuntimeDir $RuntimeDir
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
