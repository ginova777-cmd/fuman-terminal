param(
  [string]$ProjectRoot = $PSScriptRoot + "\..",
  [string]$TaskName = "Fuman Terminal Surface Monitor",
  [int]$IntervalMinutes = 5
)
$ErrorActionPreference = "Stop"
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$runner = Join-Path $ProjectRoot "scripts\monitor-terminal-surfaces.js"
if (!(Test-Path -LiteralPath $runner)) { throw "monitor script missing: $runner" }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $node -Argument ('--use-system-ca "' + $runner + '" --production --scheduled') -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output "installed task=$TaskName intervalMinutes=$IntervalMinutes projectRoot=$ProjectRoot"