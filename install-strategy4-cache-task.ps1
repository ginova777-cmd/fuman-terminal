param(
  [string]$TaskName = "Fuman Strategy4 Cache 1600",
  [string]$StartTime = "16:00"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
$script = Join-Path $root "run-strategy4.ps1"
if (-not (Test-Path -LiteralPath $script)) { throw "Strategy4 runner missing: $script" }
if (-not (Test-Path -LiteralPath $pwsh)) { throw "PowerShell 7 missing: $pwsh" }

$taskRun = "`"$pwsh`" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$script`""
schtasks.exe /Create /F /SC DAILY /ST $StartTime /TN $TaskName /TR $taskRun | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to register $TaskName (exit=$LASTEXITCODE)" }
Write-Host "排程名稱：$TaskName"
Write-Host "時間：每日 $StartTime"
Write-Host "執行：$taskRun"