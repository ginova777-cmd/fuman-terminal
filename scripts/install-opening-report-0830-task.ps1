param(
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

$TaskName = "Fuman Opening Report 0830 Line"
$Root = "C:\fuman-terminal"
$ScriptPath = Join-Path $Root "run-opening-report-0830-production-wrapper.ps1"
$Pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $Pwsh)) {
  $Pwsh = "powershell.exe"
}

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  return
}

if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Missing wrapper script: $ScriptPath"
}

$Action = New-ScheduledTaskAction `
  -Execute $Pwsh `
  -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
  -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Daily -At "08:30"
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 25)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "Fuman 08:30 opening report. Success gate is delivery-chain: report + terminal briefing + LINE personal/group." `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
