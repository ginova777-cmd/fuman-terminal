param(
  [string]$Label = "Fuman output",
  [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$syncScript = "C:\fuman-terminal\run-cache-sync.ps1"

function Write-SyncLog($message) {
  $line = "[$(Get-Date)] $message"
  if ($LogPath) {
    Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
  } else {
    Write-Host $line
  }
}

if (-not (Test-Path -LiteralPath $syncScript)) {
  Write-SyncLog "$Label sync skipped; run-cache-sync.ps1 not found."
  exit 0
}

Write-SyncLog "$Label sync start."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript
$syncExit = $LASTEXITCODE
if ($syncExit -ne 0) {
  Write-SyncLog "$Label sync failed with exit code $syncExit."
  exit $syncExit
}
Write-SyncLog "$Label sync completed."
