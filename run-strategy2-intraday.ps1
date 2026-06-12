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
$env:STRATEGY2_ENTRY_START_MINUTES = "545"
$env:STRATEGY2_ENTRY_END_MINUTES = "720"
$env:STRATEGY2_SCAN_END_MINUTES = "720"
$env:STRATEGY2_REALTIME_FUGLE_ONLY = "1"
$env:STRATEGY2_REALTIME_FALLBACK_CANDIDATE_LIMIT = "1200"
$env:STRATEGY2_1M_WARMUP_LIMIT = "120"
$env:STRATEGY2_REALTIME_BATCH_SIZE = "12"
$env:STRATEGY2_REALTIME_RETRY_BATCH_SIZE = "4"
$env:STRATEGY2_REALTIME_BATCH_CONCURRENCY = "3"
$env:STRATEGY2_MIN_REALTIME_COVERAGE = "0.25"
$env:STRATEGY2_REALTIME_RESCUE_COVERAGE = "0.70"
$env:STRATEGY2_REALTIME_RESCUE_LIMIT = "300"
$env:STRATEGY2_REALTIME_RESCUE_COOLDOWN_MS = "30000"
$env:STRATEGY2_ENABLE_FINMIND_REALTIME = "0"
$env:STRATEGY2_ENABLE_FINMIND_RESCUE = "0"
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

$syncAfterOutput = "${PSScriptRoot}\run-sync-after-output.ps1"
if (Test-Path -LiteralPath $syncAfterOutput) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncAfterOutput -Label "Strategy2 intraday cache" -LogPath $log >> $log 2>&1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  "Strategy2 intraday cache written; sync helper not found." >> $log
}

"=== Strategy2 intraday patrol end $(Get-Date) ===" >> $log
