param(
  [string]$TaskName = "Fuman Global Cost Janitor Scorecard 1555",
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$At = "15:55",
  [switch]$RunNow,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "[global-cost-janitor-task] uninstalled $TaskName"
  exit 0
}

$runner = Join-Path $ProjectRoot "run-global-cost-janitor-scorecard.ps1"
if (!(Test-Path -LiteralPath $runner)) {
  throw "Missing runner: $runner"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -ProjectRoot `"$ProjectRoot`"" `
  -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "[global-cost-janitor-task] registered $TaskName at $At"

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "[global-cost-janitor-task] started $TaskName"
}
