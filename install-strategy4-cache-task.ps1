param(
  [string]$TaskName = "Fuman Strategy4 Cache 1600",
  [string]$StartTime = "16:00"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
$script = Join-Path $root "run-strategy4-task-wrapper.ps1"

if (-not (Test-Path -LiteralPath $script)) { throw "Strategy4 task wrapper missing: $script" }
if (-not (Test-Path -LiteralPath $pwsh)) { throw "PowerShell 7 missing: $pwsh" }

$action = New-ScheduledTaskAction -Execute $pwsh -Argument ("-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`"" -f $script) -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($StartTime, "HH:mm", $null))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$settings.DisallowStartIfOnBatteries = $false
$settings.StopIfGoingOnBatteries = $false
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Strategy4 formal scan with unattended startup/timeout receipt guard." -Force | Out-Null

Write-Host "排程名稱：$TaskName"
Write-Host "時間：每日 $StartTime"
Write-Host "執行：$pwsh -NoLogo -NoProfile -NonInteractive -File $script"
Write-Host "工作目錄：$root"