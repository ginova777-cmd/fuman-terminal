$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-realtime-radar.ps1"

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:REALTIME_RADAR_PATROL_INTERVAL_MS = "3000"
$env:REALTIME_RADAR_NOTIFY = "0"
$env:REALTIME_RADAR_WORKFLOW_ALERT_NOTIFY = "1"
$env:REALTIME_RADAR_SKIP_SYNC_AFTER_OUTPUT = "1"
$env:REALTIME_RADAR_USE_LOCAL_API = "1"
$env:REALTIME_QUOTE_SOURCE_ORDER = "fugle,finmind,twse-mis,yahoo-chart"
$env:REALTIME_RADAR_EXCLUDED_CODES = "1475,1538,2254,2321,2901,5906,7732,8101,8488"
$env:REALTIME_RADAR_BATCH_SIZE = "80"
$env:REALTIME_RADAR_BATCH_CONCURRENCY = "3"
$env:REALTIME_RADAR_BATCH_TIMEOUT_MS = "18000"
$env:REALTIME_RADAR_BATCH_RETRIES = "2"
$env:REALTIME_RADAR_BATCH_RETRY_DELAY_MS = "350"
$env:REALTIME_RADAR_STALE_RESCAN_LIMIT = "240"
$env:REALTIME_RADAR_RESCAN_BATCH_SIZE = "60"
$env:REALTIME_RADAR_WRITE_BUDGET_PER_SCAN = "3"
$env:REALTIME_FUGLE_PRIMARY_CONCURRENCY = "10"
$env:REALTIME_FUGLE_PRIMARY_TIMEOUT_MS = "4500"
$env:REALTIME_FUGLE_PRIMARY_BUDGET_MS = "14000"
$env:REALTIME_FINMIND_FALLBACK_CONCURRENCY = "8"
$env:REALTIME_FINMIND_FALLBACK_TIMEOUT_MS = "6000"
$env:REALTIME_FINMIND_FALLBACK_BUDGET_MS = "12000"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"
$env:NOTIFY_FAST_MODE = "1"
$env:NOTIFY_PUSH_TIMEOUT_MS = "1500"
$env:NOTIFY_PUSH_RETRIES = "1"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\realtime-radar-$(Get-Date -Format yyyyMMdd-HHmmss).log"
$env:REALTIME_RADAR_LOG_PATH = $log
function Add-LogLine($message) {
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Invoke-LoggedCommand([scriptblock]$Command) {
  & $Command *>&1 | ForEach-Object { Add-LogLine ([string]$_) }
  return $LASTEXITCODE
}

Add-LogLine "=== Realtime radar cache start $(Get-Date) ==="
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Realtime radar cache" -LogPath $log

$exitCode = Invoke-LoggedCommand { & $nodeExe "scripts\patrol-realtime-radar-cache.js" }
if ($exitCode -ne 0) {
  Add-LogLine "Realtime radar cache failed with exit code $exitCode"
  exit $exitCode
}

$syncAfterOutput = "${PSScriptRoot}\run-sync-after-output.ps1"
if ($env:REALTIME_RADAR_SKIP_SYNC_AFTER_OUTPUT -eq "1") {
  Add-LogLine "Realtime radar sync-after-output skipped; Supabase radar cache is the source of truth."
} elseif (Test-Path -LiteralPath $syncAfterOutput) {
  $syncExit = Invoke-LoggedCommand { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncAfterOutput -Label "Realtime radar cache" -LogPath $log }
  if ($syncExit -ne 0) { exit $syncExit }
} else {
  Add-LogLine "Realtime radar cache written; sync helper not found."
}

Add-LogLine "=== Realtime radar cache end $(Get-Date) ==="

