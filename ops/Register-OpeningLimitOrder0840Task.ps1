$ErrorActionPreference = "Stop"
$taskName = "Fuman Opening Limit Order Morning Readonly 0845"
$action = New-ScheduledTaskAction -Execute "C:\Program Files\PowerShell\7\pwsh.exe" -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"C:\fuman-terminal\ops\Run-OpeningLimitOrderMorningReadonly.ps1`" -Limit 1600 -TerminalDir `"C:\fuman-terminal`" -RuntimeDir `"C:\fuman-runtime`"" -WorkingDirectory "C:\fuman-terminal"
$trigger = New-ScheduledTaskTrigger -Daily -At "08:40"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Fuman 08:40 opening-entry read-only progressive runner: 08:40 static pre-candidates, 08:45-08:50 futopt/trial readback, 08:55 weighted ranked watchlist. No order, formal candidate, or publish." -Force | Out-Null
schtasks /Query /TN $taskName /FO LIST /V
