param(
  [string]$SourceRoot = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $SourceRoot).Path
$mirrorRoot = "C:\fuman-terminal"
if ($root.TrimEnd("\") -ieq $mirrorRoot.TrimEnd("\")) {
  throw "Refusing to install Strategy3 battle tasks from production mirror: $mirrorRoot"
}

$pwsh = if (Test-Path -LiteralPath "C:\Program Files\PowerShell\7\pwsh.exe") { "C:\Program Files\PowerShell\7\pwsh.exe" } else { "powershell.exe" }

function Register-FumanTask {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$Time,
    [Parameter(Mandatory=$true)][string]$Script
  )

  if (!(Test-Path -LiteralPath $Script)) {
    throw "Missing Strategy3 task script: $Script"
  }

  $taskRun = ('"{0}" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath ''{1}''; & ''{2}''"' -f $pwsh, $root, $Script)
  schtasks /Create /TN $Name /SC DAILY /ST $Time /TR $taskRun /F | Out-Host
}

Register-FumanTask -Name "Fuman Strategy3 Complete Scan 1300" -Time "13:00" -Script "$root\run-strategy3-complete-scan.ps1"
Register-FumanTask -Name "Fuman Strategy3 Battle Verify 1305" -Time "13:05" -Script "$root\run-strategy3-battle-verify.ps1"
