param(
  [string]$TaskName = "Fuman FinMind Daily OHLCV Sync 2020",
  [string]$ProjectRoot = "C:\fuman-release-owner\fuman-terminal",
  [string]$At = "20:20",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task: $TaskName"
  exit 0
}

$pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $pwsh) { $pwsh = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" }
$runner = Join-Path $ProjectRoot "run-finmind-daily-ohlcv-sync.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "FinMind daily OHLCV runner not found: $runner" }

$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At, "HH:mm", $null))
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Synchronizes and verifies FinMind TaiwanStockPrice daily OHLCV before the 21:00 Strategy5 scan." `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName at $At"
