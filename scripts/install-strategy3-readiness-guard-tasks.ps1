param(
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

$Root = "C:\fuman-terminal"
$ScriptPath = Join-Path $Root "run-strategy3-readiness-guard.ps1"
$Pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $Pwsh)) {
  $Pwsh = "powershell.exe"
}

$Tasks = @(
  @{ Name = "Fuman Strategy3 Readiness Guard 1230"; Time = "12:30" },
  @{ Name = "Fuman Strategy3 Readiness Guard 1250"; Time = "12:50" }
)

if ($Remove) {
  foreach ($task in $Tasks) {
    Unregister-ScheduledTask -TaskName $task.Name -Confirm:$false -ErrorAction SilentlyContinue
  }
  return
}

if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Missing wrapper script: $ScriptPath"
}

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

$Principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType S4U `
  -RunLevel Highest

foreach ($task in $Tasks) {
  $Action = New-ScheduledTaskAction `
    -Execute $Pwsh `
    -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Apply" `
    -WorkingDirectory $Root
  $Trigger = New-ScheduledTaskTrigger -Daily -At $task.Time
  Register-ScheduledTask `
    -TaskName $task.Name `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Fuman Strategy3 readiness guard. Self-heal then fail-closed if formal 1m readiness is below gate." `
    -Force | Out-Null
}

Get-ScheduledTask -TaskName "Fuman Strategy3 Readiness Guard *" | Select-Object TaskName, State
