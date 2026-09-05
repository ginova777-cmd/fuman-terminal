param(
  [string]$Root = (Join-Path $PSScriptRoot ".."),
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$runner = Join-Path $rootPath "run-strategy3-v2-readiness-guard.ps1"
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $pwsh)) { $pwsh = "powershell.exe" }

$tasks = @(
  @{ Name = "Fuman Strategy3 V2 Readiness Guard 1230"; Time = "12:30"; Phase = "1230" },
  @{ Name = "Fuman Strategy3 V2 Readiness Guard 1250"; Time = "12:50"; Phase = "1250" }
)

if ($Remove) {
  foreach ($task in $tasks) {
    Unregister-ScheduledTask -TaskName $task.Name -Confirm:$false -ErrorAction SilentlyContinue
  }
  return
}
if (-not (Test-Path -LiteralPath $runner)) { throw "Missing V2 readiness guard runner: $runner" }

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
foreach ($task in $tasks) {
  $action = New-ScheduledTaskAction -Execute $pwsh -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Phase $($task.Phase)" -WorkingDirectory $rootPath
  $trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $task.Time
  Register-ScheduledTask -TaskName $task.Name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Strategy3 V2 $($task.Phase) readiness-only guard. Writes receipt; cannot scan, publish, create a formal candidate, or send LINE." -Force | Out-Null
}

Get-ScheduledTask -TaskName "Fuman Strategy3 V2 Readiness Guard *" | Select-Object TaskName, State
