$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-strategy2-intraday.ps1"

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:INTRADAY_PATROL_INTERVAL_MS = "3000"
$env:STRATEGY2_SCAN_START_MINUTES = "540"
$env:STRATEGY2_ENTRY_START_MINUTES = "540"
$env:STRATEGY2_ENTRY_END_MINUTES = "720"
$env:STRATEGY2_SCAN_END_MINUTES = "720"
$env:STRATEGY2_PUBLISH_INTERVAL_MS = "0"
$env:STRATEGY2_RETAIN_LAST_GOOD_ON_SOURCE_UNHEALTHY_SECONDS = "14400"
$env:STRATEGY2_REALTIME_FUGLE_ONLY = "1"
$env:STRATEGY2_FORMAL_DAYTRADE_POOL_ONLY = "1"
$env:STRATEGY2_FORMAL_DAYTRADE_PRIORITY_LIMIT = "40"
$env:STRATEGY2_REALTIME_FALLBACK_CANDIDATE_LIMIT = "40"
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

function Assert-Strategy2SupabaseLatest {
  $js = 'const m=require("./lib/server-supabase-key");(async()=>{const root=process.cwd();const runtimeDir=process.env.FUMAN_RUNTIME_DIR||"C:/fuman-runtime";const base=m.terminalSupabaseUrl({root,runtimeDir}).replace(/\/+$/,"");const key=m.terminalSupabaseKey({root,runtimeDir});const response=await fetch(base+"/rest/v1/v_strategy2_latest_complete_run?select=run_id,result_count,record_count&limit=1",{headers:{apikey:key,Authorization:"Bearer "+key,Accept:"application/json"}});const text=await response.text();if(!response.ok)throw new Error("v_strategy2_latest_complete_run HTTP "+response.status+": "+text.slice(0,200));const rows=JSON.parse(text||"[]");const row=Array.isArray(rows)?rows[0]:null;if(!row||!row.run_id)throw new Error("Strategy2 Supabase latest pointer missing run_id");console.log(JSON.stringify({runId:row.run_id,count:Number(row.result_count||row.record_count||0)}));})().catch(e=>{console.error(e.message||String(e));process.exit(1);});'
  $text = & $nodeExe -e $js
  if ($LASTEXITCODE -ne 0) { throw "Strategy2 Supabase latest pointer verification failed" }
  $payload = ($text | Select-Object -Last 1) | ConvertFrom-Json
  "Strategy2 Supabase latest pointer verified runId=$($payload.runId) count=$($payload.count)" >> $log
  return [pscustomobject]@{
    runId = [string]$payload.runId
    count = [int]$payload.count
  }
}

function Assert-Strategy2ApiPreserve {
  $url = "https://fuman-terminal.vercel.app/api/scorecard?live=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45
    $payload = $response.Content | ConvertFrom-Json -AsHashtable
    $report = @($payload["sourceReports"]) | Where-Object { $_["key"] -eq "strategy2" } | Select-Object -First 1
    if ($response.StatusCode -eq 200 -and $report -and -not [string]::IsNullOrWhiteSpace([string]$report["runId"])) {
      $count = if ($null -ne $report["count"]) { [int]$report["count"] } else { 0 }
      "Strategy2 preserve scorecard sourceReport verified runId=$($report["runId"]) count=$count" >> $log
      return [pscustomobject]@{
        runId = [string]$report["runId"]
        count = $count
      }
    }
    throw "sourceReport missing runId"
  } catch {
    "Strategy2 protected scorecard readback unavailable ($($_.Exception.Message)); falling back to service-role Supabase latest pointer readback." >> $log
    return Assert-Strategy2SupabaseLatest
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

function Get-Strategy2TaipeiDateKey {
  $override = [string]($env:STRATEGY2_REPAIR_DATE)
  if ([string]::IsNullOrWhiteSpace($override)) { $override = [string]($env:FUMAN_EXPECTED_DATE) }
  if ($override -match '^\d{8}$') { return $override }
  if ($override -match '^\d{4}-\d{2}-\d{2}$') { return ($override -replace '-', '') }
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  $now = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
  return $now.ToString("yyyyMMdd")
}

function Get-Strategy2RunIdDate($RunId) {
  $text = [string]$RunId
  if ($text -match 'strategy2-(\d{8})') { return $Matches[1] }
  return ""
}

function Invoke-Strategy2AfterWindowRepair($Reason) {
  $targetDate = Get-Strategy2TaipeiDateKey
  $latest = Assert-Strategy2SupabaseLatest
  $latestDate = Get-Strategy2RunIdDate $latest.runId
  if ($latestDate -eq $targetDate) {
    "Strategy2 after-window latest already matches target date $targetDate runId=$($latest.runId); preserving latest." >> $log
    Write-Strategy2Receipt "complete" 0 $true ([int]$latest.count) ([string]$latest.runId) @($Reason) $Reason $true $true
    return $true
  }

  "Strategy2 latest run date mismatch after window latest=$($latest.runId) latestDate=$latestDate targetDate=$targetDate; starting after-window 1m replay repair." >> $log
  $env:STRATEGY2_REPLAY_DATE = $targetDate
  & $nodeExe "scripts\replay-strategy2-full-window-from-1m.js" >> $log 2>&1
  $replayExit = $LASTEXITCODE
  if ($replayExit -ne 0) {
    Write-Strategy2Receipt "failed" $replayExit $false 0 ([string]$latest.runId) @("after-window 1m replay failed exit=$replayExit", $Reason) "after-window 1m replay failed"
    exit $replayExit
  }

  $env:STRATEGY2_COMPLETE_RUN_SOURCE_FILE = Join-Path $env:FUMAN_DATA_DIR "strategy2-intraday-latest.json"
  $env:STRATEGY2_AFTER_WINDOW_REPAIR_PUBLISH = "1"
  & $nodeExe "scripts\publish-strategy2-complete-run.js" >> $log 2>&1
  $publishExit = $LASTEXITCODE
  if ($publishExit -ne 0) {
    Write-Strategy2Receipt "failed" $publishExit $false 0 ([string]$latest.runId) @("after-window complete-run publish failed exit=$publishExit", $Reason) "after-window complete-run publish failed"
    exit $publishExit
  }

  $after = Assert-Strategy2SupabaseLatest
  $afterDate = Get-Strategy2RunIdDate $after.runId
  if ($afterDate -ne $targetDate) {
    Write-Strategy2Receipt "failed" 1 $false 0 ([string]$after.runId) @("after-window repair produced run date $afterDate, expected $targetDate", $Reason) "after-window repair did not produce target-date run"
    exit 1
  }
  Write-Strategy2Receipt "complete" 0 $true ([int]$after.count) ([string]$after.runId) @("after-window 1m replay repair complete", $Reason)
  return $true
}
"=== Strategy2 intraday patrol start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy2 intraday patrol" -LogPath $log
$currentMinute = Get-TaipeiMinuteOfDay
if ($env:STRATEGY2_FORCE_AFTER_WINDOW_REPAIR -eq "1") {
  $currentMinute = [int]$env:STRATEGY2_SCAN_END_MINUTES + 1
  "Strategy2 forcing after-window repair path by STRATEGY2_FORCE_AFTER_WINDOW_REPAIR=1" >> $log
}
if ($currentMinute -gt [int]$env:STRATEGY2_SCAN_END_MINUTES) {
  $reason = "after Strategy2 scan window; verify or repair latest run before preserving previous good"
  "Strategy2 off-session after-window check: $reason" >> $log
  Invoke-Strategy2AfterWindowRepair $reason | Out-Null
  "=== Strategy2 intraday patrol end $(Get-Date) ===" >> $log
  exit 0
}
if ($currentMinute -lt [int]$env:STRATEGY2_SCAN_START_MINUTES) {
  "Strategy2 before scan window; handing off to patrol wait loop until 09:00." >> $log
}
. "${PSScriptRoot}\scanner-resource-health.ps1"
$resourceGate = Invoke-ScannerResourceHealthGate -Strategy "strategy2" -LogPath $log
if ($resourceGate.PreserveLatest) {
  $reason = "resource health $($resourceGate.Status): $($resourceGate.Reason)"
  "Strategy2 source gate blocked new publish. $reason" >> $log
  if ((Get-TaipeiMinuteOfDay) -lt [int]$env:STRATEGY2_SCAN_START_MINUTES) {
    "Strategy2 source gate is not ready before scan window; keep unattended runner alive and retry at 09:00 without writing preserved-latest receipt." >> $log
  } else {
    $verifiedPayload = Assert-Strategy2ApiPreserve
    Write-Strategy2Receipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId) @($reason) $reason $true $true
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

# Strategy2 is an intraday fast-path ledger: 09:00-12:00 Asia/Taipei, every 3 seconds.
# Each scan writes runtime/latest JSON and a Supabase complete run for frontend polling.
# Do not redirect to cache sync, freshness:gate, deploy, bump, or GitHub push during runtime refreshes.
"Strategy2 intraday cache written; fast-path sync-after-output skipped." >> $log
$verifiedPayload = Assert-Strategy2ApiPreserve
Write-Strategy2Receipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId)

"=== Strategy2 intraday patrol end $(Get-Date) ===" >> $log
