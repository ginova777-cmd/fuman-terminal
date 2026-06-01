$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:INTRADAY_PATROL_INTERVAL_MS = "3000"
$env:STRATEGY2_REALTIME_BATCH_SIZE = "8"
$env:STRATEGY2_REALTIME_RETRY_BATCH_SIZE = "4"
$env:STRATEGY2_REALTIME_BATCH_CONCURRENCY = "2"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\strategy2-intraday-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"=== Strategy2 intraday patrol start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "C:\fuman-terminal\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy2 intraday patrol" -LogPath $log

& $nodeExe "scripts\patrol-intraday-signals.js" >> $log 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  "Strategy2 intraday patrol failed with exit code $exitCode" >> $log
  exit $exitCode
}

$syncAfterOutput = "C:\fuman-terminal\run-sync-after-output.ps1"
if (Test-Path -LiteralPath $syncAfterOutput) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncAfterOutput -Label "Strategy2 intraday cache" -LogPath $log >> $log 2>&1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  "Strategy2 intraday cache written; sync helper not found." >> $log
}

"=== Strategy2 intraday patrol end $(Get-Date) ===" >> $log
