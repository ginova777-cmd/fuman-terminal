param(
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$TaskName = "Fuman Daytrade Source Writer 0600-1330"
)

$ErrorActionPreference = "Stop"
$script = Join-Path $RuntimeDir "ops\Run-DaytradeSourceWriter.ps1"
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $script)) { throw "Daytrade writer wrapper missing: $script" }
if (-not (Test-Path -LiteralPath $pwsh)) { throw "PowerShell 7 missing: $pwsh" }

$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$script`" -FumanRoot `"$FumanRoot`" -RuntimeDir `"$RuntimeDir`" -Apply -Once" `
  -WorkingDirectory $FumanRoot
$trigger = New-ScheduledTaskTrigger -Daily -At "06:00"
$trigger.Repetition = New-CimInstance `
  -ClientOnly `
  -Namespace root/Microsoft/Windows/TaskScheduler `
  -ClassName MSFT_TaskRepetitionPattern `
  -Property @{ Interval = "PT1M"; Duration = "PT7H30M"; StopAtDurationEnd = $false }
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
  -Description "Approved Fugle daytrade source writer every minute from 06:00 to 13:30; writes only on the designated writer host." `
  -Force | Out-Null

Write-Host "[daytrade-source-writer] installed task=$TaskName window=06:00-13:30 interval=1m script=$script"