param(
  [string]$TaskName = "Fuman Strategy4 Cache 1600",
  [string]$StartTime = "16:00",
  [int]$ExecutionHours = 4
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
$script = Join-Path $root "run-strategy4.ps1"
if (-not (Test-Path -LiteralPath $script)) { throw "Strategy4 runner missing: $script" }
if (-not (Test-Path -LiteralPath $pwsh)) { throw "PowerShell 7 missing: $pwsh" }

$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -WakeToRun `
  -DontStopOnIdleEnd `
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

Write-Host "[strategy4] installed task=$TaskName start=$StartTime executionLimit=${ExecutionHours}h script=$script"
