$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:NODE_OPTIONS = "--use-system-ca"
foreach ($name in @(
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_TO",
  "LINE_USER_ID",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_TO",
  "TRADE_MANAGER_MAX_DAILY_AMOUNT",
  "TRADE_MANAGER_BUDGET_PER_TRADE",
  "TRADE_MANAGER_MAX_DAILY_TRADES",
  "TRADE_MANAGER_PROFIT_EXIT_MIN_PCT",
  "TRADE_MANAGER_STRATEGY5_PROFIT_EXIT_MIN_PCT",
  "TRADE_MANAGER_SELL_PRESSURE_VOLUME_DELTA_LOTS",
  "TRADE_MANAGER_STRATEGY5_SELL_PRESSURE_VOLUME_DELTA_LOTS",
  "TRADE_MANAGER_SELL_PRESSURE_DROP_PCT",
  "TRADE_MANAGER_SELL_PRESSURE_HIGH_GIVEBACK_PCT",
  "TRADE_MANAGER_STRATEGY5_MIN_ENTRY_TIME"
)) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    if ($value) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
  }
}
$nodeExe = "C:\Program Files\nodejs\node.exe"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\trade-manager-patrol-$(Get-Date -Format yyyyMMdd-HHmmss).log"

"=== Trade manager patrol start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "C:\fuman-terminal\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Trade manager patrol" -LogPath $log
& $nodeExe "scripts\patrol-trade-manager.js" >> $log 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  "Trade manager patrol failed with exit code $exitCode" >> $log
  exit $exitCode
}
"=== Trade manager patrol end $(Get-Date) ===" >> $log
