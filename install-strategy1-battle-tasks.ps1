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

Register-FumanTask -Name "Fuman Strategy1 Candidate Verify 2135" -Time "21:35" -Script "$root\run-strategy1-battle-verify.ps1"
Register-FumanTask -Name "Fuman Strategy1 Futopt Preopen Verify 0850" -Time "08:50" -Script "$root\run-strategy1-battle-verify.ps1"
Register-FumanTask -Name "Fuman Strategy1 Flame Gate Verify 0852" -Time "08:52" -Script "$root\run-strategy1-battle-verify.ps1"
