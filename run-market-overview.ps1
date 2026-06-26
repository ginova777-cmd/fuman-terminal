$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-market-overview.ps1"

Set-Location "${PSScriptRoot}"
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
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Market overview patrol" -LogPath $log

& $nodeExe "scripts\patrol-market-overview.js" >> $log 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  "Market overview patrol failed with exit code $exitCode" >> $log
  exit $exitCode
}

$summaryAttempts = if ($env:MARKET_OVERVIEW_SUMMARY_ATTEMPTS -match '^\d+$') { [int]$env:MARKET_OVERVIEW_SUMMARY_ATTEMPTS } else { 8 }
$summaryDelaySeconds = if ($env:MARKET_OVERVIEW_SUMMARY_RETRY_SECONDS -match '^\d+$') { [int]$env:MARKET_OVERVIEW_SUMMARY_RETRY_SECONDS } else { 300 }
$summaryExit = 1
for ($summaryAttempt = 1; $summaryAttempt -le $summaryAttempts; $summaryAttempt++) {
  "=== Market overview summary attempt $summaryAttempt/$summaryAttempts $(Get-Date) ===" >> $log
  & $nodeExe "scripts\generate-market-summary.js" >> $log 2>&1
  $summaryExit = $LASTEXITCODE
  if ($summaryExit -eq 0) { break }
  "Market overview summary failed with exit code $summaryExit on attempt $summaryAttempt/$summaryAttempts" >> $log
  if ($summaryAttempt -lt $summaryAttempts) { Start-Sleep -Seconds $summaryDelaySeconds }
}
if ($summaryExit -ne 0) {
  "Market overview summary failed after $summaryAttempts attempts with exit code $summaryExit" >> $log
  exit $summaryExit
}

$syncAfterOutput = "${PSScriptRoot}\run-sync-after-output.ps1"
if (Test-Path -LiteralPath $syncAfterOutput) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncAfterOutput -Label "Market overview patrol" -LogPath $log >> $log 2>&1
  if ($LASTEXITCODE -ne 0) {
    "Market overview sync-after-output warning: exit code $LASTEXITCODE; market surfaces chain remains authoritative." >> $log
  }
} else {
  "Market overview patrol finished; sync helper not found." >> $log
}

"=== Market overview patrol end $(Get-Date) ===" >> $log
