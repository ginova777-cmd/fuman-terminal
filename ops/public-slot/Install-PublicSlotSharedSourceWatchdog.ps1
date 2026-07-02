param(
  [string]$TaskName = "Fuman Public Slot Shared Source Watchdog",
  [string]$StartTime = "06:00",
  [string]$WatchdogEveryMinutes = "1",
  [int]$RepeatDurationDays = 3650
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Watchdog = Join-Path $ScriptDir "Watchdog-PublicSlotSharedSource.ps1"

if (-not (Test-Path -LiteralPath $Watchdog)) {
  throw "找不到守護程式：$Watchdog"
}

$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $pwsh)) {
  $pwsh = "$env:LOCALAPPDATA\Microsoft\WindowsApps\pwsh.exe"
}
if (-not (Test-Path -LiteralPath $pwsh)) {
  $pwsh = "powershell.exe"
}

$taskAt = [datetime]::ParseExact($StartTime, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
$triggerAt = [datetime]::Today.AddHours($taskAt.Hour).AddMinutes($taskAt.Minute)
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At $triggerAt `
  -RepetitionInterval (New-TimeSpan -Minutes ([int]$WatchdogEveryMinutes)) `
  -RepetitionDuration (New-TimeSpan -Days $RepeatDurationDays)
$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Watchdog`""
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 72) `
  -AllowStartIfOnBatteries:$false `
  -DontStopIfGoingOnBatteries:$false

Write-Host ""
Write-Host "建立 Supabase 公共槽 shared source 守護排程..."
Write-Host "名稱：$TaskName"
Write-Host "頻率：每 $WatchdogEveryMinutes 分鐘檢查一次"
Write-Host "週期：$StartTime 起，持續 $RepeatDurationDays 天"
Write-Host "作用：shared source 停掉或 Supabase 資料過舊時，自動重新啟動 06:00 shared source。"
Write-Host ""

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Fuman public slot shared source watchdog. Runs every $WatchdogEveryMinutes minute(s)." `
  -Force |
  Out-Host

Write-Host ""
Write-Host "完成。現在會自動守護 Supabase 公共槽 shared source。"
Write-Host "手動測試可執行："
Write-Host "& `"$Watchdog`""
