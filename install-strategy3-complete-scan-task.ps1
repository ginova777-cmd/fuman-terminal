param(
  [string]$TaskName = "Fuman Strategy3 Complete Scan 1300",
  [string]$StartTime = "13:00"
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $pwsh)) { $pwsh = "powershell.exe" }
$runner = Join-Path $root "run-strategy3-complete-scan.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "runner missing: $runner" }
$taskRun = '"{0}" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "{1}"' -f $pwsh, $runner
schtasks /Create /F /SC DAILY /ST $StartTime /TN $TaskName /TR $taskRun /RL LIMITED | Out-Host
schtasks /Query /TN $TaskName /FO LIST /V | Out-Host
