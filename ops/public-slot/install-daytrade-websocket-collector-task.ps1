param(
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$Force,
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"
$taskName = "Fuman Fugle Daytrade WebSocket Collector 0600-1330"
$script = Join-Path $FumanRoot "ops\public-slot\Run-DaytradeWebSocketCollector.ps1"
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $script)) { throw "Missing supervisor: $script" }
if (-not (Test-Path -LiteralPath $pwsh)) { throw "Missing PowerShell 7: $pwsh" }

$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -FumanRoot `"$FumanRoot`" -RuntimeDir `"$RuntimeDir`""
$trigger = New-ScheduledTaskTrigger -Daily -At "06:00"
$settings = New-ScheduledTaskSettingsSet -MultipleInstances Ignore -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 9) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force:$Force.IsPresent | Out-Null
Write-Output "installed: $taskName"
if ($RunNow) { Start-ScheduledTask -TaskName $taskName; Write-Output "started: $taskName" }
