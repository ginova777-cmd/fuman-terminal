$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:NODE_OPTIONS = "--use-system-ca"

$nodeExe = "C:\Program Files\nodejs\node.exe"
New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\daily-health-summary-$(Get-Date -Format yyyyMMdd-HHmmss).log"

function Add-LogLine($message) {
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

Add-LogLine "=== Daily health summary start $(Get-Date) ==="
& $nodeExe "scripts\generate-health-summary.js" *>&1 | ForEach-Object { Add-LogLine ([string]$_) }
& $nodeExe "scripts\send-daily-health-summary.js" @args *>&1 | ForEach-Object { Add-LogLine ([string]$_) }
$exitCode = $LASTEXITCODE
Add-LogLine "=== Daily health summary end $(Get-Date) exit=$exitCode ==="
exit $exitCode
