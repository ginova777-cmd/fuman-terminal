param(
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
$gateInstaller = Join-Path $FumanRoot "ops\public-slot\install-daytrade-source-gate-tasks.ps1"
$watchdogInstaller = Join-Path $FumanRoot "ops\public-slot\install-daytrade-unattended-watchdog-task.ps1"
$preflight = Join-Path $RuntimeDir "ops\Run-DaytradePreflight0830.ps1"
$finalVerdict = Join-Path $RuntimeDir "ops\Run-DaytradeFinalVerdict.ps1"
foreach ($path in @($pwsh, $gateInstaller, $watchdogInstaller, $preflight, $finalVerdict)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing source-control dependency: $path" }
}

# Gate phases and watchdog have their own installers; keep all source-control tasks on the same S4U principal.
& $gateInstaller -FumanRoot $FumanRoot -RuntimeDir $RuntimeDir
& $watchdogInstaller -FumanRoot $FumanRoot -RuntimeDir $RuntimeDir

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
$tasks = @(
  @{ Name = "Fuman Daytrade Source Preflight 0830"; Time = "08:30"; Script = $preflight; Description = "Fuman Fugle source preflight. Fail closed before source publication." },
  @{ Name = "Fuman Daytrade Source Final Verdict 0912"; Time = "09:12"; Script = $finalVerdict; Description = "Fuman Fugle source final verdict. Preserves previous good when source evidence is incomplete." }
)
foreach ($task in $tasks) {
  $action = New-ScheduledTaskAction `
    -Execute $pwsh `
    -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$($task.Script)`"" `
    -WorkingDirectory $FumanRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $task.Time
  Register-ScheduledTask `
    -TaskName $task.Name `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description $task.Description `
    -Force | Out-Null
}

Get-ScheduledTask -TaskName 'Fuman Daytrade Source Gate *','Fuman Daytrade Source Preflight 0830','Fuman Daytrade Source Final Verdict 0912','Fuman Fugle Daytrade Watchdog Every Minute' |
  Select-Object TaskName, State, @{ N = 'UserId'; E = { $_.Principal.UserId } }, @{ N = 'LogonType'; E = { $_.Principal.LogonType } }, @{ N = 'RunLevel'; E = { $_.Principal.RunLevel } }