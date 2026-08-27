$ErrorActionPreference = "Stop"
$taskName = "Fuman Opening Limit Order Morning Readonly 0840"
$terminalRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $terminalRoot "ops\Run-OpeningLimitOrderMorningReadonly.ps1"
if (!(Test-Path -LiteralPath $runner)) { throw "opening_limit_order_0840_runner_missing:$runner" }
$action = New-ScheduledTaskAction -Execute "C:\Program Files\PowerShell\7\pwsh.exe" -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Limit 1600 -TerminalDir `"$terminalRoot`" -RuntimeDir `"C:\fuman-runtime`"" -WorkingDirectory $terminalRoot
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "08:40"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Single read-only opening-entry chain: 08:40 static pre-candidates, 08:45-08:50 futopt/trial, 08:55 ranked watchlist, 09:00 closure. No order, formal candidate, publish, or second runner." -Force | Out-Null
foreach ($legacy in @("Fuman Opening Limit Order Morning Readonly 0845", "Fuman Opening Limit Order 0900 Readonly Verify")) {
  Unregister-ScheduledTask -TaskName $legacy -Confirm:$false -ErrorAction SilentlyContinue
}
schtasks /Query /TN $taskName /FO LIST /V