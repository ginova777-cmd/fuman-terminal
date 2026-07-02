param(
  [string]$Root = "C:\fuman-terminal",
  [string]$TaskName = "Fuman 即時雷達 Watchdog",
  [string]$StartTime = "08:59",
  [int]$IntervalMinutes = 1,
  [int]$RepeatDurationDays = 3650
)

$ErrorActionPreference = "Stop"

$watchdog = Join-Path $Root "run-realtime-radar-watchdog.ps1"
if (-not (Test-Path -LiteralPath $watchdog)) {
  throw "watchdog not found: $watchdog"
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
  -RepetitionInterval (New-TimeSpan -Minutes ([math]::Max(1, $IntervalMinutes))) `
  -RepetitionDuration (New-TimeSpan -Days $RepeatDurationDays)

$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdog`""

$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries:$false `
  -DontStopIfGoingOnBatteries:$false

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Fuman realtime radar watchdog. Checks the live API and restarts the realtime radar task if it stops during 09:00-13:30." `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
