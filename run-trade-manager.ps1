Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:NOTIFY_FAST_MODE = "1"
$env:NOTIFY_PUSH_TIMEOUT_MS = "1500"
$env:NOTIFY_PUSH_RETRIES = "1"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\trade-manager-$(Get-Date -Format yyyyMMdd-HHmmss).log"

"=== Trade manager start $(Get-Date) ===" | Out-File $log -Encoding utf8

node scripts\trade-manager.js >> $log 2>&1
$tradeExit = $LASTEXITCODE

if ($tradeExit -ne 0) {
  "Trade manager failed with exit code $tradeExit" >> $log
  exit $tradeExit
}

"=== Trade manager end $(Get-Date) ===" >> $log

