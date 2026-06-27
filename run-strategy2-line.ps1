Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:NODE_OPTIONS = "--use-system-ca"
$env:STRATEGY2_LIVE_STARTED_AT = "08:45:00"
$env:STRATEGY2_LIVE_STOP_AT = "12:00:00"
$env:STRATEGY2_LIVE_DISABLE_ENHANCEMENTS = "1"
foreach ($name in @("LINE_CHANNEL_ACCESS_TOKEN", "LINE_TO", "LINE_USER_ID", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_TO")) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    if ($value) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
  }
}
New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\strategy2-line-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"=== Strategy2 LINE patrol start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy2 LINE patrol" -LogPath $log

& "C:\Program Files\nodejs\node.exe" "scripts\patrol-strategy2-live-alert.js" >> $log 2>&1


