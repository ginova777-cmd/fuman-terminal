param(
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $RuntimeDir "ops\Run-DaytradeUnattendedGate.ps1"
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $scriptPath)) { throw "Daytrade source gate wrapper missing: $scriptPath" }
if (-not (Test-Path -LiteralPath $pwsh)) { throw "PowerShell 7 missing: $pwsh" }

$tasks = @(
  @{ Name = "Fuman Daytrade Source Gate 0700"; Time = "07:00"; Phase = "0700" },
  @{ Name = "Fuman Daytrade Source Gate 0845"; Time = "08:45"; Phase = "0845" },
  @{ Name = "Fuman Daytrade Source Gate 0900"; Time = "09:00"; Phase = "0900" },
  @{ Name = "Fuman Daytrade Source Gate 0910"; Time = "09:10"; Phase = "0910" },
  @{ Name = "Fuman Daytrade Source Gate 0935"; Time = "09:35"; Phase = "0935" }
)

if ($Remove) {
  foreach ($task in $tasks) {
    Unregister-ScheduledTask -TaskName $task.Name -Confirm:$false -ErrorAction SilentlyContinue
  }
  return
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType S4U `
  -RunLevel Highest

foreach ($task in $tasks) {
  $action = New-ScheduledTaskAction `
    -Execute $pwsh `
    -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Phase $($task.Phase) -RuntimeDir `"$RuntimeDir`"" `
    -WorkingDirectory $FumanRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $task.Time
  Register-ScheduledTask `
    -TaskName $task.Name `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Fuman Fugle daytrade source gate phase $($task.Phase). Fail closed; never publish incomplete data as current." `
    -Force | Out-Null
}

Get-ScheduledTask -TaskName 'Fuman Daytrade Source Gate *' |
  Select-Object TaskName, State, @{ N = 'UserId'; E = { $_.Principal.UserId } }, @{ N = 'LogonType'; E = { $_.Principal.LogonType } }, @{ N = 'RunLevel'; E = { $_.Principal.RunLevel } }