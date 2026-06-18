$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-strategy2-intraday.ps1"

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:INTRADAY_PATROL_INTERVAL_MS = "3000"
$env:STRATEGY2_SCAN_START_MINUTES = "480"
$env:STRATEGY2_ENTRY_START_MINUTES = "525"
$env:STRATEGY2_ENTRY_END_MINUTES = "720"
$env:STRATEGY2_SCAN_END_MINUTES = "720"
$env:STRATEGY2_PUBLISH_INTERVAL_MS = "0"
$env:STRATEGY2_RETAIN_LAST_GOOD_ON_SOURCE_UNHEALTHY_SECONDS = "14400"
$env:STRATEGY2_REALTIME_FUGLE_ONLY = "0"
$env:STRATEGY2_REALTIME_FALLBACK_CANDIDATE_LIMIT = "1200"
$env:STRATEGY2_1M_WARMUP_LIMIT = "120"
$env:STRATEGY2_REALTIME_BATCH_SIZE = "12"
$env:STRATEGY2_REALTIME_RETRY_BATCH_SIZE = "4"
$env:STRATEGY2_REALTIME_BATCH_CONCURRENCY = "3"
$env:STRATEGY2_MIN_REALTIME_COVERAGE = "0.25"
$env:STRATEGY2_REALTIME_RESCUE_COVERAGE = "0.70"
$env:STRATEGY2_REALTIME_RESCUE_LIMIT = "300"
$env:STRATEGY2_REALTIME_RESCUE_COOLDOWN_MS = "30000"
$env:STRATEGY2_ENABLE_FINMIND_REALTIME = "1"
$env:STRATEGY2_ENABLE_FINMIND_RESCUE = "1"
$env:STRATEGY2_SUPABASE_QUOTES_TABLE = "v_market_quotes_unified"
$env:STRATEGY2_SUPABASE_QUOTES_HEALTH_VIEW = "v_market_quotes_unified_health"
$env:STRATEGY2_MIN_ENTRY_SOURCE_COVERAGE = "0.50"
$env:STRATEGY2_HISTORY_WRITE_INTERVAL_MS = "60000"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\strategy2-intraday-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"=== Strategy2 intraday patrol start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy2 intraday patrol" -LogPath $log

& $nodeExe "scripts\patrol-intraday-signals.js" >> $log 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  "Strategy2 intraday patrol failed with exit code $exitCode" >> $log
  exit $exitCode
}

# Strategy2 is an intraday fast-path ledger: 08:45-12:00 Asia/Taipei, every 3 seconds.
# Each scan writes runtime/latest JSON and a Supabase complete run for frontend polling.
# Do not redirect to cache sync, freshness:gate, deploy, bump, or GitHub push during runtime refreshes.
"Strategy2 intraday cache written; fast-path sync-after-output skipped." >> $log

"=== Strategy2 intraday patrol end $(Get-Date) ===" >> $log






