param(
  [string]$TaskName = "Fuman Strategy4 Source Prewarm 1535",
  [string]$StartTime = "15:35",
  [int]$ExecutionHours = 4,
  [string]$ProjectRoot = "C:\fuman-terminal"
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $ProjectRoot "run-strategy4-source-prewarm.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Script not found: $scriptPath"
}

$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $pwsh)) {
  $pwsh = "powershell.exe"
}

$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours $ExecutionHours)

$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Write-Host "[strategy4-source-prewarm] installed task=$TaskName start=$StartTime executionLimit=${ExecutionHours}h script=$scriptPath"
