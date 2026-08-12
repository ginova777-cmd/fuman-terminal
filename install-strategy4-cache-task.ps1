param(
  [string]$TaskName = "Fuman Strategy4 Cache 1600",
  [string]$StartTime = "16:00"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$cmd = Join-Path $root "run-strategy4-task-wrapper.cmd"
if (-not (Test-Path -LiteralPath $cmd)) { throw "Strategy4 task wrapper cmd missing: $cmd" }

$action = New-ScheduledTaskAction -Execute "C:\Windows\System32\cmd.exe" -Argument ("/d /c call `"{0}`"" -f $cmd) -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($StartTime, "HH:mm", $null))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$settings.DisallowStartIfOnBatteries = $false
$settings.StopIfGoingOnBatteries = $false
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Strategy4 formal scan with cmd-hosted unattended startup/timeout receipt guard." -Force | Out-Null

Write-Host "排程名稱：$TaskName"
Write-Host "時間：每日 $StartTime"
Write-Host "執行：cmd.exe /d /c call $cmd"
Write-Host "工作目錄：$root"