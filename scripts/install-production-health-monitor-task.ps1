param(
  [string]$TaskName = "FumanTerminalProductionHealthMonitor",
  [string]$ProjectRoot = "C:\fuman-terminal",
  [int]$IntervalMinutes = 5,
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

$runner = Join-Path $ProjectRoot "run-production-health-monitor.ps1"
if (-not (Test-Path -LiteralPath $runner)) {
  throw "Monitor runner not found: $runner"
}

$action = New-ScheduledTaskAction `
  -Execute $pwsh `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -ProjectRoot `"$ProjectRoot`""

$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes ([math]::Max(1, $IntervalMinutes))) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

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
  -Description "Checks fuman-terminal production health, snapshot freshness, fast bundle, and live commit." `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName every $IntervalMinutes minute(s)"
