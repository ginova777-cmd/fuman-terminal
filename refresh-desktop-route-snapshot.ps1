param(
  [string]$Source = "scanner",
  [string]$LogPath = "",
  [switch]$AllowFailure
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $runtime "data" }
$env:FUMAN_CACHE_DIR = if ($env:FUMAN_CACHE_DIR) { $env:FUMAN_CACHE_DIR } else { Join-Path $runtime "cache" }
$env:FUMAN_STATE_DIR = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $runtime "state" }
$env:NODE_OPTIONS = "--use-system-ca"

$nodeExe = "C:\Program Files\nodejs\node.exe"
$receiptDir = Join-Path $runtime "data\scan-receipts"
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null

function Write-SnapshotLog($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  if ($LogPath) {
    Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
  } else {
    Write-Host $line
  }
}

$safeSource = ([string]$Source).Trim()
if (-not $safeSource) { $safeSource = "scanner" }

Write-SnapshotLog "Desktop route snapshot refresh start source=$safeSource"
Push-Location $PSScriptRoot
try {
  & $nodeExe "scripts\write-desktop-route-snapshot.js" "--fail-on-partial" "--source=$safeSource" 2>&1 | ForEach-Object {
    $text = [string]$_
    if ($LogPath) {
      Add-Content -LiteralPath $LogPath -Value $text -Encoding utf8
    } else {
      Write-Host $text
    }
  }
  $exitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($exitCode -ne 0) {
  Write-SnapshotLog "Desktop route snapshot refresh failed source=$safeSource exit=$exitCode"
  if (-not $AllowFailure) { exit $exitCode }
} else {
  Write-SnapshotLog "Desktop route snapshot refresh ok source=$safeSource"
}

exit 0
