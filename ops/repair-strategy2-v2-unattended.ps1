[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$taskName = "Fuman Strategy2 V2 Unattended"
$runner = "C:\fuman-terminal\run-strategy2-live-v2.ps1"
$powerShell = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction -Execute $powerShell -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory "C:\fuman-terminal"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 8:45AM
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 5)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Disable-ScheduledTask -TaskName "Fuman Strategy2 V2 Guarded" -ErrorAction Stop | Out-Null
Disable-ScheduledTask -TaskName "Fuman Strategy2 LINE Start 0900" -ErrorAction Stop | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
[PSCustomObject]@{
  ok = $true
  taskName = $taskName
  userId = $userId
  logonType = [string]$task.Principal.LogonType
  disallowStartIfOnBatteries = [bool]$task.Settings.DisallowStartIfOnBatteries
  stopIfGoingOnBatteries = [bool]$task.Settings.StopIfGoingOnBatteries
  state = [string]$task.State
  lastTaskResult = $info.LastTaskResult
} | ConvertTo-Json -Compress
