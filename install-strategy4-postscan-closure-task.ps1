param(
  [string]$TaskName = "Fuman Strategy4 Postscan Closure 1605",
  [string]$StartTime = "16:05"
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
$script = Join-Path $root "run-strategy4-postscan-closure.ps1"

if (-not (Test-Path -LiteralPath $script)) {
  throw "Strategy4 postscan closure script missing: $script"
}

$taskRun = "`"$pwsh`" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$script`" -ProjectRoot `"$root`" -RuntimeRoot `"C:\fuman-runtime`" -ProductionUrl `"https://fuman-terminal.vercel.app`""

schtasks /Create /F /SC DAILY /ST $StartTime /TN $TaskName /TR $taskRun | Out-Host

Write-Host "排程名稱：$TaskName"
Write-Host "時間：每日 $StartTime"
Write-Host "執行：$taskRun"
Write-Host "工作目錄：$root"
