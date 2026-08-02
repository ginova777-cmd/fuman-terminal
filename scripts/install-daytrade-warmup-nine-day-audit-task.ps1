param(
  [string]$Root = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$TaskName = "Fuman Daytrade Warmup Nine-Day Audit 0915",
  [string]$At = "09:15"
)

$ErrorActionPreference = "Stop"
$runner = Join-Path $Root "scripts\run-daytrade-warmup-nine-day-audit.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "audit runner missing: $runner" }
$pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue)
if (-not $pwsh) { $pwsh = Get-Command powershell.exe -ErrorAction Stop }
$action = New-ScheduledTaskAction -Execute $pwsh.Source -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`" -Root `"{1}`" -RuntimeDir `"{2}`"" -f $runner,$Root,$RuntimeDir) -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At,"HH:mm",$null))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$settings.DisallowStartIfOnBatteries = $false
$settings.StopIfGoingOnBatteries = $false
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Read-only nine-day daytrade warmup evidence audit; does not publish or self-heal." -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State
