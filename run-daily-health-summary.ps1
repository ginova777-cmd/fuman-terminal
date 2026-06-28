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
$log = "C:\fuman-runtime\logs\daily-health-summary-$(Get-Date -Format yyyyMMdd-HHmmss).log"

function Add-LogLine($message) {
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Invoke-HealthStep($scriptPath, $stepArgs = @()) {
  Add-LogLine "--- run $scriptPath ---"
  & $nodeExe $scriptPath @stepArgs *>&1 | ForEach-Object { Add-LogLine ([string]$_) }
  $stepExit = $LASTEXITCODE
  Add-LogLine "--- $scriptPath exit=$stepExit ---"
  return $stepExit
}

Add-LogLine "=== Daily health summary start $(Get-Date) ==="
$reportedExitCodes = @()
$reportedExitCodes += Invoke-HealthStep "scripts\refresh-intraday-latest-dates.js"
$reportedExitCodes += Invoke-HealthStep "scripts\generate-health-summary.js"
$reportedExitCodes += Invoke-HealthStep "scripts\repair-health.js"
$reportedExitCodes += Invoke-HealthStep "scripts\send-daily-health-summary.js" $args
$reportedExit = (@($reportedExitCodes | Where-Object { $_ -ne 0 }) | Select-Object -First 1)
if ($null -eq $reportedExit) { $reportedExit = 0 }
Add-LogLine "=== Daily health summary end $(Get-Date) reportedExit=$reportedExit schedulerExit=0 ==="
exit 0
