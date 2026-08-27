param(
  [switch]$Remove,
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$TaskName = "Fuman Opening Report 0830 Telegram",
  [string]$UserId = "$env:USERDOMAIN\$env:USERNAME"
)
$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $ProjectRoot "run-opening-report-0830-production-wrapper.ps1"
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwsh) { $pwsh = "powershell.exe" }
$legacyTasks = @("Fuman Opening Report 0830 LINE", "Fuman Opening Report 0830 Line", "Fuman Opening Report 0830 LINE Bridge")
if ($Remove) {
  foreach ($name in @($TaskName) + $legacyTasks) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  }
  return
}
if (-not (Test-Path -LiteralPath $scriptPath)) { throw "Missing wrapper script: $scriptPath" }
$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "08:30"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 25)
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType S4U -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Single opening-report chain: 08:30 report, 08:35 required Mother Pool bridge, 08:36 Telegram personal/group delivery and terminal receipt closure. LINE fallback and second run forbidden." -Force | Out-Null
foreach ($legacy in $legacyTasks) {
  Unregister-ScheduledTask -TaskName $legacy -Confirm:$false -ErrorAction SilentlyContinue
}
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State,@{n="StartBoundary";e={$_.Triggers[0].StartBoundary}},@{n="LogonType";e={$_.Principal.LogonType}},@{n="MultipleInstances";e={$_.Settings.MultipleInstances}}
