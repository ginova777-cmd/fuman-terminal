param(
  [string]$SourceRoot = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $SourceRoot).Path
$mirrorRoot = "C:\fuman-terminal"
if ($root.TrimEnd("\") -ieq $mirrorRoot.TrimEnd("\")) {
  throw "Refusing to install Strategy1 battle tasks from production mirror: $mirrorRoot"
}

$pwsh = if (Test-Path -LiteralPath "C:\Program Files\PowerShell\7\pwsh.exe") { "C:\Program Files\PowerShell\7\pwsh.exe" } else { "powershell.exe" }

function Register-FumanTask {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$Time,
    [Parameter(Mandatory=$true)][string]$Script
  )

  if (!(Test-Path -LiteralPath $Script)) {
    throw "Missing Strategy1 task script: $Script"
  }

  $taskRun = ('"{0}" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath ''{1}''; & ''{2}''"' -f $pwsh, $root, $Script)
  schtasks /Create /TN $Name /SC DAILY /ST $Time /TR $taskRun /F | Out-Host
}

Register-FumanTask -Name "Fuman Strategy1 Candidate Verify 2135" -Time "21:35" -Script "$root\run-strategy1-battle-verify.ps1"
Register-FumanTask -Name "Fuman Strategy1 Futopt Preopen Verify 0850" -Time "08:50" -Script "$root\run-strategy1-battle-verify.ps1"
Register-FumanTask -Name "Fuman Strategy1 Flame Gate Verify 0852" -Time "08:52" -Script "$root\run-strategy1-battle-verify.ps1"
