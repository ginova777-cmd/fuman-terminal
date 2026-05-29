$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\open-buy-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"=== Open buy full scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "C:\fuman-terminal\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Open buy full scan" -LogPath $log

$env:FULL_SCAN = "1"
$env:OPEN_BUY_BATCH_SIZE = "9999"
$env:OPEN_BUY_BATCHES_PER_RUN = "999"
$env:OPEN_BUY_USE_MIS = "0"

& $nodeExe "scripts\scan-open-buy-cache.js" >> $log 2>&1
$exitCode = $LASTEXITCODE

Remove-Item Env:FULL_SCAN -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_BATCH_SIZE -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_BATCHES_PER_RUN -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_USE_MIS -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
  "Open buy scan failed with exit code $exitCode" >> $log
  exit $exitCode
}

$syncScript = "C:\fuman-terminal\run-cache-sync.ps1"
if (Test-Path -LiteralPath $syncScript) {
  "Open buy cache files written locally; starting isolated openBuy Git sync" >> $log
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Scope openBuy >> $log 2>&1
  $syncExitCode = $LASTEXITCODE
  if ($syncExitCode -ne 0) {
    "Open buy isolated Git sync failed with exit code $syncExitCode" >> $log
    exit $syncExitCode
  }
} else {
  "Open buy isolated Git sync skipped; missing $syncScript" >> $log
}
"=== Open buy full scan end $(Get-Date) ===" >> $log

