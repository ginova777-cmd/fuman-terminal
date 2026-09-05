param(
  [string]$Root = (Join-Path $PSScriptRoot ".."),
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $pwsh)) { $pwsh = "powershell.exe" }
$definitions = @(
  @{ Name = "Fuman Strategy3 V2 First Attempt 1255"; Time = "12:55"; Kind = "file"; Target = "run-strategy3-v2-1255-first-attempt.ps1" },
  @{ Name = "Fuman Strategy3 V2 Complete Scan 1300"; Time = "13:00"; Kind = "file"; Target = "run-strategy3-v2-complete-scan.ps1"; Extra = " -PushLine" },
  @{ Name = "Fuman Strategy3 V2 Daily Closure Verify 1310"; Time = "13:10"; Kind = "node"; Target = "scripts\verify-strategy3-v2-daily-unattended-closure.js" }
)

if ($Remove) {
  foreach ($definition in $definitions) { Unregister-ScheduledTask -TaskName $definition.Name -Confirm:$false -ErrorAction SilentlyContinue }
  return
}

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
foreach ($definition in $definitions) {
  $target = Join-Path $rootPath $definition.Target
  if (-not (Test-Path -LiteralPath $target)) { throw "Missing Strategy3 V2 target: $target" }
  $arguments = if ($definition.Kind -eq "node") {
    "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command `"& node --use-system-ca '$target'`""
  } else {
    "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$target`"$($definition.Extra)"
  }
  $action = New-ScheduledTaskAction -Execute $pwsh -Argument $arguments -WorkingDirectory $rootPath
  $trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $definition.Time
  Register-ScheduledTask -TaskName $definition.Name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Strategy3 V2 canonical formal chain; market-calendar guarded and fail-closed." -Force | Out-Null
}

Get-ScheduledTask -TaskName "Fuman Strategy3 V2 First Attempt 1255", "Fuman Strategy3 V2 Complete Scan 1300", "Fuman Strategy3 V2 Daily Closure Verify 1310" | Select-Object TaskName, State
