param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$TaskName = "Fuman Strategy2 Unified 0845-1210",
  [string]$UserId = "$env:USERDOMAIN\$env:USERNAME"
)
$ErrorActionPreference = "Stop"
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwsh) { $pwsh = (Get-Command powershell.exe -ErrorAction Stop).Source }
$runner = Join-Path $ProjectRoot "ops\run-strategy2-v3-unified.ps1"
$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$runner`" -FumanRoot `"$ProjectRoot`"" -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "08:45"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType S4U -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Unique Strategy2 V3 runner: one 08:45 water preflight, scan 09:00-12:10, finalize once at 12:10; one daily runId and fail-closed four-surface evidence." -Force | Out-Null
foreach ($legacy in @("Fuman Strategy2 Unified 0845-1230","Fuman Strategy2 V3 Water Gate 0845","Fuman Strategy2 V2 Unattended","Fuman Strategy2 V2 Recovery")) {
  if (Get-ScheduledTask -TaskName $legacy -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $legacy -Confirm:$false
  }
}
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State,@{n="LogonType";e={$_.Principal.LogonType}},@{n="MultipleInstances";e={$_.Settings.MultipleInstances}}
