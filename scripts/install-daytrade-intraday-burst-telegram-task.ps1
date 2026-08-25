param(
  [string]$Root = "C:\fuman-terminal",
  [string]$TaskName = "Fuman Mother Pool Telegram 0900-1230"
)
$ErrorActionPreference = "Stop"
$runner = Join-Path $Root "run-daytrade-intraday-burst-telegram.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "runner not found: $runner" }
$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $pwsh -Argument ('-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $runner) -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "09:00"
$trigger.Repetition.Interval = "PT1M"
$trigger.Repetition.Duration = "PT3H31M"
$trigger.Repetition.StopAtDurationEnd = $true
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Telegram-only Strategy2 Mother Pool burst notifier; consumes formal outbox only; never starts a strategy run." -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State
