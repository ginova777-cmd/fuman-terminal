$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:NODE_OPTIONS = "--use-system-ca"
$env:TRADE_MANAGER_REPORT_NOTIFY = "0"
$env:DISABLE_SCORECARD_NOTIFY = "1"
foreach ($name in @("LINE_CHANNEL_ACCESS_TOKEN", "LINE_TO", "LINE_USER_ID")) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    if ($value) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
  }
}
$nodeExe = "C:\Program Files\nodejs\node.exe"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\trade-manager-report-$(Get-Date -Format yyyyMMdd-HHmmss).log"

"=== Trade manager settlement report start $(Get-Date) ===" | Out-File $log -Encoding utf8
"Trade manager notifications disabled; Google Sheet upload only." >> $log
. "C:\fuman-terminal\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Trade manager settlement report" -LogPath $log
& $nodeExe "scripts\send-trade-manager-report.js" >> $log 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  "Trade manager settlement report failed with exit code $exitCode" >> $log
  exit $exitCode
}
"=== Trade manager settlement report end $(Get-Date) ===" >> $log
$recordDir = Join-Path ([Environment]::GetFolderPath("Desktop")) "管家紀錄"
$backupDir = Join-Path $recordDir "每日備份"
New-Item -ItemType Directory -Force -Path $recordDir, $backupDir | Out-Null
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$stateFile = "C:\fuman-runtime\state\trade-manager-state.json"
if (Test-Path $stateFile) {
  Copy-Item -LiteralPath $stateFile -Destination (Join-Path $recordDir "今日管家狀態.json") -Force
  Copy-Item -LiteralPath $stateFile -Destination (Join-Path $backupDir "trade-manager-state-$stamp.json") -Force
}
if (Test-Path $log) {
  Copy-Item -LiteralPath $log -Destination (Join-Path $recordDir "最新管家結算.log") -Force
  Copy-Item -LiteralPath $log -Destination (Join-Path $backupDir "trade-manager-report-$stamp.log") -Force
}

$sheetScript = Join-Path $PWD "run-upload-trade-manager-google-sheet.ps1"
if (Test-Path -LiteralPath $sheetScript) {
  "=== Trade manager Google Sheet upload start $(Get-Date) ===" >> $log
  & $sheetScript >> $log 2>&1
  $sheetExitCode = $LASTEXITCODE
  if ($sheetExitCode -ne 0) {
    "Trade manager Google Sheet upload failed with exit code $sheetExitCode" >> $log
    exit $sheetExitCode
  }
  "=== Trade manager Google Sheet upload end $(Get-Date) ===" >> $log
}

$syncAfterOutput = "C:\fuman-terminal\run-sync-after-output.ps1"
if (Test-Path -LiteralPath $syncAfterOutput) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncAfterOutput -Label "Trade manager settlement" -LogPath $log >> $log 2>&1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  "Trade manager settlement written; sync helper not found." >> $log
}
