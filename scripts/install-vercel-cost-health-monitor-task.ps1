param(
  [string]$TaskName = "Fuman Vercel Cost Health Monitor 2115",
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$At = "21:15",
  [switch]$RunNow,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "[vercel-cost-monitor-task] uninstalled $TaskName"
  exit 0
}

$runner = Join-Path $ProjectRoot "run-vercel-cost-health-monitor.ps1"
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
Write-Host "[vercel-cost-monitor-task] registered $TaskName at $At"

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "[vercel-cost-monitor-task] started $TaskName"
}
