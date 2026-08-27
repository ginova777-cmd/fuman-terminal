param(
  [string]$FumanRoot = "C:\fuman-release-owner\fuman-terminal",
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

$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -FumanRoot `"$FumanRoot`" -RuntimeDir `"$RuntimeDir`"" `
  -WorkingDirectory $FumanRoot
$trigger = New-ScheduledTaskTrigger -Daily -At "06:00"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances Ignore -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 9) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force:$Force.IsPresent | Out-Null

$installed = Get-ScheduledTask -TaskName $taskName
$installedAction = $installed.Actions | Select-Object -First 1
if ($installedAction.WorkingDirectory -ne $FumanRoot) {
  throw "Collector task working directory readback mismatch: expected=$FumanRoot actual=$($installedAction.WorkingDirectory)"
}
Write-Output "installed: $taskName"
if ($RunNow) { Start-ScheduledTask -TaskName $taskName; Write-Output "started: $taskName" }
