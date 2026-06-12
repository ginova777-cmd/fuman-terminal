param(
  [string]$Label = "Fuman output",
  [string]$LogPath = "",
  [ValidateSet("all", "flow", "institution", "warrant", "openBuy", "strategy2", "strategy3", "strategy4", "strategy5", "cb")]
  [string]$Scope = "all"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

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

$gateScript = if ($env:FUMAN_LEGACY_GATE_SCRIPT) { $env:FUMAN_LEGACY_GATE_SCRIPT } else { "freshness:gate:fast" }
Write-SyncLog "$Label sync redirected to npm run $gateScript. requestedScope=$Scope"
Set-Location -LiteralPath $PSScriptRoot
npm run $gateScript
exit $LASTEXITCODE
