param(
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$TaskName = "Fuman Fugle Daytrade Watchdog Every Minute"
)

$ErrorActionPreference = "Stop"
$script = Join-Path $RuntimeDir "ops\Run-DaytradeUnattendedGate.ps1"
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $script)) { throw "Daytrade watchdog wrapper missing: $script" }
if (-not (Test-Path -LiteralPath $pwsh)) { throw "PowerShell 7 missing: $pwsh" }

$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$script`" -Phase watchdog -RuntimeDir `"$RuntimeDir`"" `
  -WorkingDirectory $FumanRoot
$trigger = New-ScheduledTaskTrigger -Daily -At "07:00"
$trigger.Repetition = New-CimInstance `
  -ClientOnly `
  -Namespace root/Microsoft/Windows/TaskScheduler `
  -ClassName MSFT_TaskRepetitionPattern `
  -Property @{ Interval = "PT1M"; Duration = "PT6H35M"; StopAtDurationEnd = $false }
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Daytrade watchdog every minute from 07:00 to 13:35; fails closed and never publishes a failed source as current." `
  -Force | Out-Null

Write-Host "[daytrade-watchdog] installed task=$TaskName window=07:00-13:35 interval=1m script=$script"