param(
  [string]$TaskName = "Fuman Chip Source Sync 2005",
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$At = "20:05",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task: $TaskName"
  exit 0
}

$pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $pwsh) {
  $pwsh = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
}

$runner = Join-Path $ProjectRoot "run-chip-source-sync.ps1"
if (-not (Test-Path -LiteralPath $runner)) {
  throw "Chip source sync runner not found: $runner"
}

$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$runner`""

$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At, "HH:mm", $null))
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Runs FinMind chip sync first, then TWSE/TPEx official gap fill, before daily institution/Strategy5 scanners." `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName at $At"
