param(
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$RuntimeRoot = "C:\fuman-runtime",
  [string]$ProductionUrl = "https://fuman-terminal.vercel.app",
  [int]$MaxRepairAttempts = 1
)

$ErrorActionPreference = "Stop"

function Get-TaipeiParts() {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  $now = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
  return [pscustomobject]@{
    Date = $now.ToString("yyyy-MM-dd")
    Stamp = $now.ToString("yyyyMMdd-HHmmss")
    Time = $now.ToString("HH:mm:ss")
    DayOfWeek = [string]$now.DayOfWeek
  }
}

function Write-JsonFile($Path, $Payload) {
  $dir = Split-Path -Parent $Path
  if ($dir) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $Payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Write-Log($Message) {
  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $script:LogFile -Value $line -Encoding utf8
}

function Get-TradingDayStatus($Root) {
  $checker = Join-Path $Root "scripts\twse-trading-day.js"
  if (-not (Test-Path -LiteralPath $checker)) {
    $parts = Get-TaipeiParts
    return [pscustomobject]@{ isTradingDay = $true; date = $parts.Date; reason = "checker_missing"; source = "watchdog" }
  }
  $script = @"
const { isTwseTradingDay } = require(process.argv[1]);
const compact = (result) => ({
  isTradingDay: !!result.isTradingDay,
  date: String(result.date || ''),
  reason: String(result.reason || result.closedReason || ''),
  source: String(result.source || ''),
  override: !!result.override,
  lockedBy: String(result.lockedBy || ''),
  overrideFile: String(result.overrideFile || '')
});
isTwseTradingDay(new Date(), { stateDir: process.env.FUMAN_STATE_DIR || 'C:/fuman-runtime/state' })
  .then((result) => console.log(Buffer.from(JSON.stringify(compact(result)), 'utf8').toString('base64')))
  .catch((error) => {
    console.log(Buffer.from(JSON.stringify({
      isTradingDay: true,
      date: '',
      reason: 'trading_day_check_failed',
      source: 'scorecard-watchdog',
      error: error && error.message ? error.message : String(error)
    }), 'utf8').toString('base64'));
  });
"@
  $output = & node -e $script $checker
  if ($LASTEXITCODE -ne 0) {
    $parts = Get-TaipeiParts
    return [pscustomobject]@{ isTradingDay = $true; date = $parts.Date; reason = "checker_exit_$LASTEXITCODE"; source = "watchdog" }
  }
  $encoded = ($output | Out-String).Trim()
  $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($encoded))
  return ($json | ConvertFrom-Json)
}

function Read-ScorecardApi($BaseUrl) {
  $script = @"
const base = process.argv[1].replace(/\/+$/, '');
const url = base + '/api/scorecard?live=1&watchdog=' + Date.now();
(async () => {
  const response = await fetch(url, { headers: { 'cache-control': 'no-cache', accept: 'application/json' } });
  const payload = await response.json();
  const summary = {
    status: response.status,
    ok: payload && payload.ok === true,
    latestDate: String((payload && payload.latestDate) || ''),
    marketDate: String((payload && payload.marketDate) || ''),
    runId: String((payload && payload.runId) || ''),
    qualityStatus: String((payload && payload.qualityStatus) || ''),
    cacheSource: String((payload && payload.cacheSource) || ''),
    records: Array.isArray(payload && payload.records) ? payload.records.length : 0
  };
  console.log(Buffer.from(JSON.stringify(summary), 'utf8').toString('base64'));
})().catch((error) => {
  const summary = { status: 0, ok: false, latestDate: '', marketDate: '', runId: '', qualityStatus: '', cacheSource: '', records: 0, error: error && error.message ? error.message : String(error) };
  console.log(Buffer.from(JSON.stringify(summary), 'utf8').toString('base64'));
  process.exit(1);
});
"@
  $output = & node --use-system-ca -e $script $BaseUrl
  if ($LASTEXITCODE -ne 0) {
    throw "scorecard api read failed"
  }
  $encoded = ($output | Out-String).Trim()
  $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($encoded))
  return ($json | ConvertFrom-Json)
}

$parts = Get-TaipeiParts
$logDir = Join-Path $RuntimeRoot "logs"
$receiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir | Out-Null
$script:LogFile = Join-Path $logDir ("scorecard-daily-watchdog-{0}.log" -f $parts.Stamp)
$receiptFile = Join-Path $receiptDir "scorecard-daily-watchdog-latest.json"
$datedReceiptFile = Join-Path $receiptDir ("scorecard-daily-watchdog-{0}.json" -f $parts.Stamp)
$wrapper = Join-Path $ProjectRoot "run-scorecard-daily-automation-wrapper.ps1"
$startedAt = (Get-Date).ToString("o")
$status = "running"
$errorText = ""
$before = $null
$after = $null
$repairAttempted = $false
$repairExitCode = $null

try {
  Write-Log "START scorecard daily watchdog"
  $trading = Get-TradingDayStatus $ProjectRoot
  $expectedDate = if ($trading.date) { [string]$trading.date } else { $parts.Date }
  Write-Log ("trading day status date={0} isTradingDay={1} reason={2}" -f $expectedDate, $trading.isTradingDay, $trading.reason)

  $before = Read-ScorecardApi $ProductionUrl
  Write-Log ("before latestDate={0} marketDate={1} runId={2} quality={3}" -f $before.latestDate, $before.marketDate, $before.runId, $before.qualityStatus)

  if (-not [bool]$trading.isTradingDay) {
    $status = "skipped_non_trading_day"
  } elseif ($before.latestDate -eq $expectedDate -or $before.marketDate -eq $expectedDate) {
    $status = "ok"
  } else {
    if (-not (Test-Path -LiteralPath $wrapper)) {
      throw "wrapper missing: $wrapper"
    }
    for ($attempt = 1; $attempt -le [Math]::Max(1, $MaxRepairAttempts); $attempt++) {
      $repairAttempted = $true
      Write-Log ("repair attempt {0}/{1}: running wrapper" -f $attempt, $MaxRepairAttempts)
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $wrapper -ProjectRoot $ProjectRoot -RuntimeRoot $RuntimeRoot -ExpectedDate $expectedDate -AllowPreviousTradeDate
      $repairExitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
      if ($repairExitCode -eq 0) {
        break
      }
      Write-Log ("repair attempt failed exitCode={0}" -f $repairExitCode)
    }
    Start-Sleep -Seconds 10
    $after = Read-ScorecardApi $ProductionUrl
    Write-Log ("after latestDate={0} marketDate={1} runId={2} quality={3}" -f $after.latestDate, $after.marketDate, $after.runId, $after.qualityStatus)
    if ($after.latestDate -eq $expectedDate -or $after.marketDate -eq $expectedDate) {
      $status = "repaired"
    } elseif ($after.ok -and $after.runId -and $after.qualityStatus -eq "complete" -and [int]$after.records -gt 0) {
      $status = "preserved_previous_trade_date"
      Write-Log ("preserve previous complete scorecard latest; expectedDate={0} latestDate={1} marketDate={2} runId={3} records={4}" -f $expectedDate, $after.latestDate, $after.marketDate, $after.runId, $after.records)
    } else {
      throw "scorecard still stale after watchdog repair; expectedDate=$expectedDate latestDate=$($after.latestDate) marketDate=$($after.marketDate)"
    }
  }
  Write-Log ("SUCCESS watchdog status={0}" -f $status)
} catch {
  $status = "failed"
  $errorText = $_.Exception.Message
  Write-Log ("FAILED watchdog: {0}" -f $errorText)
} finally {
  $receipt = [ordered]@{
    ok = ($status -eq "ok" -or $status -eq "repaired" -or $status -eq "preserved_previous_trade_date" -or $status -eq "skipped_non_trading_day")
    status = $status
    source = "scorecard-daily-watchdog"
    startedAt = $startedAt
    finishedAt = (Get-Date).ToString("o")
    projectRoot = $ProjectRoot
    runtimeRoot = $RuntimeRoot
    productionUrl = $ProductionUrl
    log = $script:LogFile
    tradingDay = $trading
    repairAttempted = $repairAttempted
    repairExitCode = $repairExitCode
    before = $before
    after = $after
    error = $errorText
  }
  Write-JsonFile $receiptFile $receipt
  Write-JsonFile $datedReceiptFile $receipt
}

if ($status -eq "failed") {
  exit 1
}
