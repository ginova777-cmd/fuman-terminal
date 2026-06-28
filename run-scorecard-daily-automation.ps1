param(
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$RuntimeRoot = "C:\fuman-runtime",
  [string]$ExpectedDate = "",
  [switch]$AllowPreviousTradeDate,
  [switch]$NoLiveVerify
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ("[scorecard-daily] {0}" -f $Message)
}

function Invoke-Step($FilePath, $ArgumentList) {
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw ("command failed with exit code {0}: {1} {2}" -f $LASTEXITCODE, $FilePath, ($ArgumentList -join " "))
  }
}

function Get-TaipeiDate() {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  return [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz).ToString("yyyy-MM-dd")
}

function Get-TradingDayStatus($ProjectRoot) {
  $checker = Join-Path $ProjectRoot "scripts\twse-trading-day.js"
  if (-not (Test-Path -LiteralPath $checker)) {
    return [pscustomobject]@{
      isTradingDay = $true
      date = Get-TaipeiDate
      reason = "checker_missing"
      source = "scorecard-daily"
    }
  }

  $script = @"
const { isTwseTradingDay } = require(process.argv[1]);
isTwseTradingDay(new Date(), { stateDir: process.env.FUMAN_STATE_DIR || 'C:/fuman-runtime/state' })
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.log(JSON.stringify({
      isTradingDay: true,
      date: '',
      reason: 'trading_day_check_failed',
      source: 'scorecard-daily',
      error: error && error.message ? error.message : String(error)
    }));
  });
"@

  $output = & node -e $script $checker
  if ($LASTEXITCODE -ne 0) {
    return [pscustomobject]@{
      isTradingDay = $true
      date = Get-TaipeiDate
      reason = "checker_exit_$LASTEXITCODE"
      source = "scorecard-daily"
    }
  }
  return ($output | Out-String | ConvertFrom-Json)
}

function Read-JsonFile($Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "json file missing: $Path"
  }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Read-JsonSummary($Path, $Kind) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "json file missing: $Path"
  }

  $script = @"
const fs = require('fs');
const file = process.argv[1];
const kind = process.argv[2];
const payload = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
if (kind === 'source') {
  console.log(JSON.stringify({
    latestDate: String(payload.latestDate || ''),
    records: Array.isArray(payload.records) ? payload.records.length : 0
  }));
} else if (kind === 'health') {
  const h = payload.health || payload;
  console.log(JSON.stringify({
    status: String(h.status || h.source_status || ''),
    latestRecordDate: String(h.latest_record_date || ''),
    latestSummaryDate: String(h.latest_summary_date || '')
  }));
} else {
  throw new Error('unknown json summary kind: ' + kind);
}
"@

  $output = & node -e $script $Path $Kind
  if ($LASTEXITCODE -ne 0) {
    throw "failed to summarize json file: $Path"
  }
  return ($output | Out-String | ConvertFrom-Json)
}

if (-not (Test-Path -LiteralPath $ProjectRoot)) {
  throw "project root missing: $ProjectRoot"
}

if (-not $ExpectedDate) {
  $ExpectedDate = Get-TaipeiDate
}

$tradingDayStatus = Get-TradingDayStatus $ProjectRoot
$allowPreviousForRun = $AllowPreviousTradeDate -or (-not [bool]$tradingDayStatus.isTradingDay)
Write-Step ("trading day status date={0} isTradingDay={1} reason={2} source={3} allowPrevious={4}" -f $tradingDayStatus.date, $tradingDayStatus.isTradingDay, $tradingDayStatus.reason, $tradingDayStatus.source, $allowPreviousForRun)

$sourceFile = Join-Path $RuntimeRoot "data\scorecard-terminal-current.json"
$snapshotFile = Join-Path $ProjectRoot "data\scorecard-latest.json"
$healthFile = Join-Path $RuntimeRoot "data\scorecard-source-health-latest.json"

Set-Location -LiteralPath $ProjectRoot

Write-Step "generate terminal complete-run scorecard source"
Invoke-Step "node" @(
  "--use-system-ca",
  "scripts\generate-terminal-scorecard-source.js",
  "--out=$sourceFile"
)

$sourcePayload = Read-JsonSummary $sourceFile "source"
$sourceLatestDate = [string]$sourcePayload.latestDate
$sourceRows = [int]$sourcePayload.records
if (-not $sourceLatestDate) {
  throw "generated scorecard source has no latestDate"
}
if ($sourceRows -le 0) {
  throw "generated scorecard source has 0 records"
}
if (-not $allowPreviousForRun -and $sourceLatestDate -ne $ExpectedDate) {
  throw "generated latestDate=$sourceLatestDate does not match expectedDate=$ExpectedDate; refusing to publish"
}

Write-Step "backfill Supabase scorecard source tables"
Invoke-Step "node" @(
  "--use-system-ca",
  "scripts\scorecard-source-supabase-ops.js",
  "backfill",
  "--source-file=$sourceFile"
)

Write-Step "read Supabase scorecard source health"
& node --use-system-ca "scripts\scorecard-source-supabase-ops.js" "health" | Out-File -LiteralPath $healthFile -Encoding utf8
if ($LASTEXITCODE -ne 0) {
  throw "scorecard source health failed with exit code $LASTEXITCODE"
}

$healthPayload = Read-JsonSummary $healthFile "health"
$healthStatus = [string]$healthPayload.status
$latestRecordDate = [string]$healthPayload.latestRecordDate
$latestSummaryDate = [string]$healthPayload.latestSummaryDate

if ($healthStatus -ne "ready") {
  throw "v_scorecard_source_health.status=$healthStatus; refusing to publish scorecard_latest"
}
if ($latestRecordDate -ne $sourceLatestDate) {
  throw "health latest_record_date=$latestRecordDate does not match generated latestDate=$sourceLatestDate; refusing to publish"
}
if ($latestSummaryDate -and $latestSummaryDate -ne $sourceLatestDate) {
  throw "health latest_summary_date=$latestSummaryDate does not match generated latestDate=$sourceLatestDate; refusing to publish"
}
if (-not $allowPreviousForRun -and $latestRecordDate -ne $ExpectedDate) {
  throw "health latest_record_date=$latestRecordDate does not match expectedDate=$ExpectedDate; refusing to publish"
}

Write-Step "export Supabase scorecard source snapshot json"
Invoke-Step "node" @(
  "--use-system-ca",
  "scripts\export-scorecard-supabase-source.js",
  "--out=$snapshotFile"
)

Write-Step "verify scorecard no-rollback candidate snapshot"
Invoke-Step "node" @(
  "--use-system-ca",
  "scripts\verify-scorecard-no-rollback.js",
  "--no-live",
  "--snapshot-file=$snapshotFile"
)

Write-Step "publish scorecard_latest Supabase snapshot"
Invoke-Step "node" @(
  "--use-system-ca",
  "scripts\publish-scorecard-snapshot.js",
  "--file=$snapshotFile"
)

Write-Step "verify scorecard snapshot"
$verifyArgs = @("--use-system-ca", "scripts\verify-scorecard-snapshot.js")
if ($NoLiveVerify) {
  $verifyArgs += "--no-live"
}
Invoke-Step "node" $verifyArgs

Write-Step "verify scorecard resource chain"
$chainVerifyArgs = @(
  "--use-system-ca",
  "scripts\verify-scorecard-resource-chain.js"
)
if ($NoLiveVerify) {
  $chainVerifyArgs += "--no-live"
}
Invoke-Step "node" $chainVerifyArgs

Write-Step "verify scorecard no-rollback live state"
$noRollbackArgs = @("--use-system-ca", "scripts\verify-scorecard-no-rollback.js")
if ($NoLiveVerify) {
  $noRollbackArgs += "--no-live"
}
Invoke-Step "node" $noRollbackArgs

Write-Step ("ok latestDate={0} rows={1}" -f $sourceLatestDate, $sourceRows)
