$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:REALTIME_RADAR_PATROL_INTERVAL_MS = "3000"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\realtime-radar-$(Get-Date -Format yyyyMMdd-HHmmss).log"
function Add-LogLine($message) {
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Invoke-LoggedCommand([scriptblock]$Command) {
  & $Command *>&1 | ForEach-Object { Add-LogLine ([string]$_) }
  return $LASTEXITCODE
}

Add-LogLine "=== Realtime radar cache start $(Get-Date) ==="

$exitCode = Invoke-LoggedCommand { & $nodeExe "scripts\patrol-realtime-radar-cache.js" }
if ($exitCode -ne 0) {
  Add-LogLine "Realtime radar cache failed with exit code $exitCode"
  exit $exitCode
}

$syncAfterOutput = "C:\fuman-terminal\run-sync-after-output.ps1"
if (Test-Path -LiteralPath $syncAfterOutput) {
  $syncExit = Invoke-LoggedCommand { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncAfterOutput -Label "Realtime radar cache" -LogPath $log }
  if ($syncExit -ne 0) { exit $syncExit }
} else {
  Add-LogLine "Realtime radar cache written; sync helper not found."
}

Add-LogLine "=== Realtime radar cache end $(Get-Date) ==="

