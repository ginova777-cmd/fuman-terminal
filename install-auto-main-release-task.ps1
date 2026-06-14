param(
  [string]$TaskName = "Fuman Auto Main Release 1615",
  [string]$StartTime = "16:15"
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
$script = Join-Path $root "run-auto-main-release.ps1"

if (-not (Test-Path -LiteralPath $script)) {
  throw "Auto main release script missing: $script"
}

$taskRun = "`"$pwsh`" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$script`""

schtasks /Create /F /SC DAILY /ST $StartTime /TN $TaskName /TR $taskRun | Out-Host

Write-Host "排程名稱：$TaskName"
Write-Host "時間：每日 $StartTime"
Write-Host "執行：$taskRun"
Write-Host "工作目錄：$root"
