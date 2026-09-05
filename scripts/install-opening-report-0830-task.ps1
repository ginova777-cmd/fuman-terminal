param(
  [switch]$Remove,
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$TaskName = "Fuman Morning Report 0830 Complete",
  [string]$UserId = "$env:USERDOMAIN\$env:USERNAME"
)
$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $ProjectRoot "run-opening-report-0830-production-wrapper.ps1"
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwsh) { $pwsh = "powershell.exe" }
$legacyTasks = @("Fuman Opening Report 0830 Telegram", "Fuman Opening Report 0830 LINE", "Fuman Opening Report 0830 Line", "Fuman Opening Report 0830 LINE Bridge")
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
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Canonical morning chain: runner -> verifier -> receipt; complete requires 15/15, LINE personal/group, terminal and Mother Pool bridge." -Force -ErrorAction Stop | Out-Null
foreach ($legacy in $legacyTasks) {
  Unregister-ScheduledTask -TaskName $legacy -Confirm:$false -ErrorAction SilentlyContinue
}
$installed = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if ([string]$installed.Principal.LogonType -ne "S4U") { throw "morning task postcondition failed: LogonType=$($installed.Principal.LogonType) expected=S4U" }
$installed | Select-Object TaskName,State,@{n="StartBoundary";e={$_.Triggers[0].StartBoundary}},@{n="LogonType";e={$_.Principal.LogonType}},@{n="MultipleInstances";e={$_.Settings.MultipleInstances}}
