$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:MARKET_OVERVIEW_PATROL_INTERVAL_MS = "10000"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"
foreach ($name in @("LINE_CHANNEL_ACCESS_TOKEN", "LINE_TO", "LINE_USER_ID")) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    if ($value) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
  }
}

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\market-overview-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"=== Market overview patrol start $(Get-Date) ===" | Out-File $log -Encoding utf8

& $nodeExe "scripts\patrol-market-overview.js" >> $log 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  "Market overview patrol failed with exit code $exitCode" >> $log
  exit $exitCode
}

$syncAfterOutput = "C:\fuman-terminal\run-sync-after-output.ps1"
if (Test-Path -LiteralPath $syncAfterOutput) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncAfterOutput -Label "Market overview patrol" -LogPath $log >> $log 2>&1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  "Market overview patrol finished; sync helper not found." >> $log
}

"=== Market overview patrol end $(Get-Date) ===" >> $log
