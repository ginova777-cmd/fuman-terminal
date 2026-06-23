param(
  [string]$TaskName = "Fuman API-Only Retired Artifact Cleanup 1535",
  [string]$At = "15:35",
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $pwsh)) { $pwsh = "powershell.exe" }

$script = Join-Path $root "run-api-only-retired-cleanup.ps1"
if (-not (Test-Path -LiteralPath $script)) {
  throw "cleanup wrapper missing: $script"
}

$actionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$action = New-ScheduledTaskAction -Execute $pwsh -Argument $actionArgs -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At, "HH:mm", $null))
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings | Out-Null
  Write-Host "[api-only-cleanup-task] updated $TaskName at $At"
} else {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Clean retired Fuman static/cache artifacts after API-only migration" -User $env:USERNAME | Out-Null
  Write-Host "[api-only-cleanup-task] installed $TaskName at $At"
}

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "[api-only-cleanup-task] started $TaskName"
}
