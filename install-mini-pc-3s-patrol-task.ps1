$ErrorActionPreference = "Stop"

$taskName = "Fuman Mini PC 3s Patrol"
$scriptPath = "C:\fuman-terminal\run-mini-pc-3s-patrol.ps1"
$pwsh = "C:\Users\ginov\AppData\Local\Microsoft\WindowsApps\pwsh.exe"
if (-not (Test-Path $pwsh)) {
  $pwsh = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
}

$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" `
  -WorkingDirectory "C:\fuman-terminal"

$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 8) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Fuman Mini PC startup patrol: Strategy2 intraday and realtime radar cache every 3 seconds." `
  -Force | Out-Null

Write-Host "Installed scheduled task: $taskName"

