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

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\scorecard-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"=== Scorecard start $(Get-Date) ===" | Out-File $log -Encoding utf8
"REPORT_SLOT=$env:REPORT_SLOT" | Add-Content -LiteralPath $log -Encoding utf8
"Scorecard notifications disabled; Google Sheet upload only." | Add-Content -LiteralPath $log -Encoding utf8
. "C:\fuman-terminal\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Scorecard $env:REPORT_SLOT" -LogPath $log

function Invoke-Utf8LoggedCommand([scriptblock]$Command) {
  & $Command *>&1 | ForEach-Object {
    [string]$_ | Add-Content -LiteralPath $log -Encoding utf8
  }
  return $LASTEXITCODE
}

$exitCode = Invoke-Utf8LoggedCommand { & $nodeExe "scripts\send-intraday-report.js" }
if ($exitCode -ne 0) {
  "Scorecard failed with exit code $exitCode" | Add-Content -LiteralPath $log -Encoding utf8
  exit $exitCode
}

"=== Google Sheet upload start $(Get-Date) ===" | Add-Content -LiteralPath $log -Encoding utf8
$sheetExitCode = Invoke-Utf8LoggedCommand { & "C:\fuman-terminal\run-upload-backtest-google-sheet.ps1" $(Get-Date -Format yyyyMMdd) }
if ($sheetExitCode -ne 0) {
  "Google Sheet upload failed with exit code $sheetExitCode" | Add-Content -LiteralPath $log -Encoding utf8
  exit $sheetExitCode
}
"=== Google Sheet upload end $(Get-Date) ===" | Add-Content -LiteralPath $log -Encoding utf8

$syncAfterOutput = "C:\fuman-terminal\run-sync-after-output.ps1"
if (Test-Path -LiteralPath $syncAfterOutput) {
  $syncExitCode = Invoke-Utf8LoggedCommand { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncAfterOutput -Label "Scorecard output" -LogPath $log }
  if ($syncExitCode -ne 0) { exit $syncExitCode }
} else {
  "Scorecard output written; sync helper not found." | Add-Content -LiteralPath $log -Encoding utf8
}

"=== Scorecard end $(Get-Date) ===" | Add-Content -LiteralPath $log -Encoding utf8
