param(
  [string]$TaskName = "Fuman Strategy4 Cache 1600",
  [string]$StartTime = "16:00"
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
$script = Join-Path $root "run-strategy4.ps1"

if (-not (Test-Path -LiteralPath $script)) {
  throw "Strategy4 script missing: $script"
}

$taskRun = "`"$pwsh`" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$script`""

schtasks /Create /F /SC DAILY /ST $StartTime /TN $TaskName /TR $taskRun | Out-Host

Write-Host "排程名稱：$TaskName"
Write-Host "時間：每日 $StartTime"
Write-Host "執行：$taskRun"
Write-Host "工作目錄：$root"
