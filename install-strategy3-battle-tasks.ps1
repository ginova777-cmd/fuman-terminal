$ErrorActionPreference = "Stop"
$root = "C:\fuman-terminal"
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"

function Register-FumanTask {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$Time,
    [Parameter(Mandatory=$true)][string]$Script
  )

  $taskRun = ('"{0}" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "{1}"' -f $pwsh, $Script)
  schtasks /Create /TN $Name /SC DAILY /ST $Time /TR $taskRun /F | Out-Host
}

Register-FumanTask -Name "Fuman Strategy3 Complete Scan 1300" -Time "13:00" -Script "$root\run-strategy3-complete-scan.ps1"
Register-FumanTask -Name "Fuman Strategy3 Battle Verify 1305" -Time "13:05" -Script "$root\run-strategy3-battle-verify.ps1"
