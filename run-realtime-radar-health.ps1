$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:NODE_OPTIONS = "--use-system-ca"
$env:NOTIFY_FAST_MODE = "1"
$env:NOTIFY_PUSH_TIMEOUT_MS = "1500"
$env:NOTIFY_PUSH_RETRIES = "1"

$nodeExe = "C:\Program Files\nodejs\node.exe"
New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\realtime-radar-health-$(Get-Date -Format yyyyMMdd-HHmmss).log"

function Add-LogLine($message) {
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

Add-LogLine "=== Realtime radar health start $(Get-Date) ==="
& $nodeExe "scripts\check-realtime-radar-health.js" @args *>&1 | ForEach-Object { Add-LogLine ([string]$_) }
$reportedExit = $LASTEXITCODE
Add-LogLine "=== Realtime radar health end $(Get-Date) reportedExit=$reportedExit schedulerExit=0 ==="
exit 0
