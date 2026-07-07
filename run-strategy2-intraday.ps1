$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-strategy2-intraday.ps1"

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:INTRADAY_PATROL_INTERVAL_MS = "3000"
$env:STRATEGY2_SCAN_START_MINUTES = "525"
$env:STRATEGY2_ENTRY_START_MINUTES = "525"
$env:STRATEGY2_ENTRY_END_MINUTES = "810"
$env:STRATEGY2_SCAN_END_MINUTES = "810"
$env:STRATEGY2_PUBLISH_INTERVAL_MS = "0"
$env:STRATEGY2_RETAIN_LAST_GOOD_ON_SOURCE_UNHEALTHY_SECONDS = "14400"
$env:STRATEGY2_REALTIME_FUGLE_ONLY = "1"
$env:STRATEGY2_REALTIME_FALLBACK_CANDIDATE_LIMIT = "450"
$env:STRATEGY2_1M_WARMUP_LIMIT = "120"
$env:STRATEGY2_REALTIME_BATCH_SIZE = "12"
$env:STRATEGY2_REALTIME_RETRY_BATCH_SIZE = "4"
$env:STRATEGY2_REALTIME_BATCH_CONCURRENCY = "1"
$env:STRATEGY2_MIN_REALTIME_COVERAGE = "0.95"
$env:STRATEGY2_REALTIME_RESCUE_COVERAGE = "0.70"
$env:STRATEGY2_REALTIME_RESCUE_LIMIT = "300"
$env:STRATEGY2_REALTIME_RESCUE_COOLDOWN_MS = "30000"
$env:STRATEGY2_ENABLE_FINMIND_REALTIME = "0"
$env:STRATEGY2_ENABLE_FINMIND_RESCUE = "0"
$env:STRATEGY2_SUPABASE_SOURCE_NAME = "fugle_daytrade_source"
$env:STRATEGY2_SUPABASE_QUOTES_TABLE = "fugle_daytrade_quotes_live"
$env:STRATEGY2_SUPABASE_QUOTES_HEALTH_VIEW = "v_fugle_daytrade_source_contract_health"
$env:STRATEGY2_SUPABASE_READY_VIEW = "v_fugle_daytrade_priority_readiness"
$env:STRATEGY2_MIN_ENTRY_SOURCE_COVERAGE = "0.95"
$env:STRATEGY2_SUPABASE_SOURCE_MIN_QUOTES = "40"
$env:STRATEGY2_SUPABASE_SOURCE_MIN_ACTIVE_SYMBOLS = "40"
$env:STRATEGY2_SUPABASE_SOURCE_MAX_QUOTE_AGE_SECONDS = "90"
$env:STRATEGY2_MAX_QUOTE_AGE_SECONDS = "90"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\strategy2-intraday-$(Get-Date -Format yyyyMMdd-HHmmss).log"
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
$scanStartedAt = (Get-Date).ToString("o")

function Write-Strategy2Receipt($Status, $ExitCode, $Complete, $Matches, $RunId, $Warnings = @(), $BlockingReason = "", $PreservedLatest = $false, $PublishBlocked = $false) {
  $receipt = [ordered]@{
    strategy = "strategy2"
    label = "strategy2 intraday patrol"
    tier = "critical"
    startedAt = $scanStartedAt
    finishedAt = (Get-Date).ToString("o")
    status = $Status
    exitCode = $ExitCode
    scanned = 0
    total = 0
    matches = $Matches
    complete = $Complete
    qualityStatus = if ($PreservedLatest) { "preserved_latest" } elseif ($Complete) { "complete" } else { "" }
    fallback = [bool]$PreservedLatest
    preservedLatest = [bool]$PreservedLatest
    publishBlocked = [bool]$PublishBlocked
    runId = $RunId
    payloadPath = "supabase:strategy2_latest"
    warnings = @($Warnings)
    blockingReason = $BlockingReason
    log = $log
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptDir "strategy2.json") -Encoding utf8
}

function Assert-Strategy2ApiPreserve {
  $url = "https://fuman-terminal.vercel.app/api/strategy2-latest?top=1&compact=1&limit=50&live=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45
  $payload = $response.Content | ConvertFrom-Json
  if ($response.StatusCode -ne 200 -or [string]::IsNullOrWhiteSpace([string]$payload.runId)) {
    throw "Strategy2 preserve API verification failed status=$($response.StatusCode) ok=$($payload.ok) runId=$($payload.runId)"
  }
  $count = if ($null -ne $payload.count) { [int]$payload.count } else { @($payload.rows).Count }
  "Strategy2 preserve API verified runId=$($payload.runId) count=$count cache=$($payload.cacheSource)" >> $log
  return [pscustomobject]@{
    runId = [string]$payload.runId
    count = $count
  }
}

function Get-TaipeiMinuteOfDay {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  $now = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
  return ($now.Hour * 60) + $now.Minute
}

function Test-Strategy2ScanWindow {
  $minute = Get-TaipeiMinuteOfDay
  return $minute -ge [int]$env:STRATEGY2_SCAN_START_MINUTES -and $minute -le [int]$env:STRATEGY2_SCAN_END_MINUTES
}

"=== Strategy2 intraday patrol start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy2 intraday patrol" -LogPath $log
if (-not (Test-Strategy2ScanWindow)) {
  $reason = "outside Strategy2 scan window; preserve latest and do not publish"
  "Strategy2 off-session skip: $reason" >> $log
  $verifiedPayload = Assert-Strategy2ApiPreserve
  Write-Strategy2Receipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId) @($reason) $reason $true $true
  "=== Strategy2 intraday patrol end $(Get-Date) ===" >> $log
  exit 0
}
. "${PSScriptRoot}\scanner-resource-health.ps1"
$resourceGate = Invoke-ScannerResourceHealthGate -Strategy "strategy2" -LogPath $log
if ($resourceGate.PreserveLatest) {
  $reason = "resource health $($resourceGate.Status): $($resourceGate.Reason)"
  "Strategy2 source gate blocked new publish; preserving latest complete/live run. $reason" >> $log
  $verifiedPayload = Assert-Strategy2ApiPreserve
  Write-Strategy2Receipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId) @($reason) $reason $true $true
  if ((Get-TaipeiMinuteOfDay) -lt [int]$env:STRATEGY2_SCAN_START_MINUTES) {
    "Strategy2 source gate is not ready before scan window; keep unattended runner alive and retry at 08:45." >> $log
  } else {
    "=== Strategy2 intraday patrol end $(Get-Date) ===" >> $log
    exit 0
  }
}

& $nodeExe "scripts\patrol-intraday-signals.js" >> $log 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  "Strategy2 intraday patrol failed with exit code $exitCode" >> $log
  Write-Strategy2Receipt "failed" $exitCode $false 0 "" @("scanner exit code $exitCode") "critical scan failed with exit code $exitCode"
  exit $exitCode
}

# Strategy2 is an intraday fast-path ledger: 08:45-13:30 Asia/Taipei, every 3 seconds.
# Each scan writes runtime/latest JSON and a Supabase complete run for frontend polling.
# Do not redirect to cache sync, freshness:gate, deploy, bump, or GitHub push during runtime refreshes.
"Strategy2 intraday cache written; fast-path sync-after-output skipped." >> $log
$verifiedPayload = Assert-Strategy2ApiPreserve
Write-Strategy2Receipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId)

"=== Strategy2 intraday patrol end $(Get-Date) ===" >> $log






