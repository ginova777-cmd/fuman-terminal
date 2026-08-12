param(
  [string]$TaskName = "Fuman Strategy3 Complete Scan 1300",
  [string]$StartTime = "13:00",
  [int]$ExecutionHours = 2
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
$runner = Join-Path $root "run-strategy3-complete-scan.ps1"
if (-not (Test-Path -LiteralPath $pwsh)) { throw "PowerShell 7 missing: $pwsh" }
if (-not (Test-Path -LiteralPath $runner)) { throw "Strategy3 runner missing: $runner" }

$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$runner`"" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours $ExecutionHours) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType S4U `
  -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Write-Host "[strategy3] installed task=$TaskName start=$StartTime executionLimit=${ExecutionHours}h script=$runner"