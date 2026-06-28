param(
  [string]$TaskName = "Fuman Supabase Vercel History Cleanup 1545",
  [string]$At = "15:45",
  [switch]$DryRun,
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $pwsh)) { $pwsh = "powershell.exe" }

$script = Join-Path $root "run-history-retention-cleanup.ps1"
if (-not (Test-Path -LiteralPath $script)) {
  throw "history cleanup wrapper missing: $script"
}

$mode = if ($DryRun) { "" } else { " -Apply" }
$actionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$script`"$mode"
$action = New-ScheduledTaskAction -Execute $pwsh -Argument $actionArgs -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At, "HH:mm", $null))
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings | Out-Null
  Write-Host "[history-cleanup-task] updated $TaskName at $At dryRun=$DryRun"
} else {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Clean old Fuman Supabase history rows and optional Vercel deployments with retention guards" -User $env:USERNAME | Out-Null
  Write-Host "[history-cleanup-task] installed $TaskName at $At dryRun=$DryRun"
}

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "[history-cleanup-task] started $TaskName"
}
