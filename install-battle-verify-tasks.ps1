$ErrorActionPreference = "Stop"

$root = "C:\fuman-terminal"

function Register-FumanVerifyTask {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Time,
    [Parameter(Mandatory = $true)][string]$Script
  )

  if (!(Test-Path -LiteralPath $Script)) {
    throw "Missing verify script: $Script"
  }

  $action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Script`""
  schtasks /Create /TN $Name /SC DAILY /ST $Time /TR $action /F | Out-Host
}

Register-FumanVerifyTask -Name "Fuman Institution Battle Verify 2110" -Time "21:10" -Script "$root\run-institution-battle-verify.ps1"
Register-FumanVerifyTask -Name "Fuman Warrant Battle Verify 2055" -Time "20:55" -Script "$root\run-warrant-battle-verify.ps1"
Register-FumanVerifyTask -Name "Fuman CB Battle Verify 2150" -Time "21:50" -Script "$root\run-cb-battle-verify.ps1"
Register-FumanVerifyTask -Name "Fuman Daily Battle Verify 2155" -Time "21:55" -Script "$root\run-daily-battle-verify.ps1"

Write-Host "Installed battle verify tasks."
