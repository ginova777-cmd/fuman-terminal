param(
  [string]$Root = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$ProductionUrl = "https://fuman-terminal.vercel.app",
  [string]$ComputerLabel = $env:COMPUTERNAME,
  [string]$TaskName = "Fuman API Unattended Scorecard",
  [string[]]$Times = @("21:35"),
  [switch]$SkipVerifiers,
  [switch]$NoFail
)

$ErrorActionPreference = "Stop"

$runner = Join-Path $Root "run-api-unattended-scorecard.ps1"
if (-not (Test-Path -LiteralPath $runner)) {
  throw "runner not found: $runner"
}

$pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue)
if (-not $pwsh) {
  $pwsh = Get-Command powershell.exe -ErrorAction Stop
}

$argumentParts = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  ('"{0}"' -f $runner),
  "-Root",
  ('"{0}"' -f $Root),
  "-RuntimeDir",
  ('"{0}"' -f $RuntimeDir),
  "-ProductionUrl",
  ('"{0}"' -f $ProductionUrl),
  "-ComputerLabel",
  ('"{0}"' -f $ComputerLabel)
)

if ($SkipVerifiers) {
  $argumentParts += "-SkipVerifiers"
}
if ($NoFail) {
  $argumentParts += "-NoFail"
}

$action = New-ScheduledTaskAction -Execute $pwsh.Source -Argument ($argumentParts -join " ")
$triggers = foreach ($time in $Times) {
  New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($time, "HH:mm", $null))
}
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Description "Runs the Fuman all-strategy API unattended scorecard from the local production mirror." `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
