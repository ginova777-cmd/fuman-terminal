$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"
$env:SCORECARD_NOTIFY = "0"
$env:DISABLE_SCORECARD_NOTIFY = "1"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\scorecard-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"=== Scorecard start $(Get-Date) ===" | Out-File $log -Encoding utf8
"REPORT_SLOT=$env:REPORT_SLOT" >> $log
"Scorecard notifications disabled; Google Sheet upload only." >> $log
. "C:\fuman-terminal\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Scorecard $env:REPORT_SLOT" -LogPath $log

& $nodeExe "scripts\send-intraday-report.js" >> $log 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  "Scorecard failed with exit code $exitCode" >> $log
  exit $exitCode
}

"=== Google Sheet upload start $(Get-Date) ===" >> $log
& "C:\fuman-terminal\run-upload-backtest-google-sheet.ps1" $(Get-Date -Format yyyyMMdd) >> $log 2>&1
$sheetExitCode = $LASTEXITCODE
if ($sheetExitCode -ne 0) {
  "Google Sheet upload failed with exit code $sheetExitCode" >> $log
  exit $sheetExitCode
}
"=== Google Sheet upload end $(Get-Date) ===" >> $log

$syncAfterOutput = "C:\fuman-terminal\run-sync-after-output.ps1"
if (Test-Path -LiteralPath $syncAfterOutput) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncAfterOutput -Label "Scorecard output" -LogPath $log >> $log 2>&1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  "Scorecard output written; sync helper not found." >> $log
}

"=== Scorecard end $(Get-Date) ===" >> $log



