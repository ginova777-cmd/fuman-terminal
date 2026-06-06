param(
  [string]$Label = "Fuman output",
  [string]$LogPath = "",
  [ValidateSet("all", "flow", "institution", "warrant", "openBuy", "strategy2", "strategy3", "strategy4", "strategy5")]
  [string]$Scope = "all"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$syncScript = "C:\fuman-terminal\run-cache-sync.ps1"

function Write-SyncLog($message) {
  $line = "[$(Get-Date)] $message"
  if ($LogPath) {
    try {
      Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8 -ErrorAction Stop
    } catch {
      Write-Host "$line (log write skipped: $($_.Exception.Message))"
    }
  } else {
    Write-Host $line
  }
}

if (-not (Test-Path -LiteralPath $syncScript)) {
  Write-SyncLog "$Label sync skipped; run-cache-sync.ps1 not found."
  exit 0
}

Write-SyncLog "$Label sync start."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Scope $Scope
$syncExit = $LASTEXITCODE
if ($syncExit -ne 0) {
  Write-SyncLog "$Label sync failed with exit code $syncExit."
  exit $syncExit
}
Write-SyncLog "$Label sync completed."
