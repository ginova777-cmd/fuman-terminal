param(
  [string]$Root = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$ProductionUrl = "https://fuman-terminal.vercel.app",
  [string]$ReleaseSha = "",
  [string]$ComputerLabel = $env:COMPUTERNAME,
  [string]$TaskName = "Fuman API Unattended Patrol",
  [string[]]$Times = @("08:55", "09:05", "09:30", "13:35", "16:10", "22:00")
)

$ErrorActionPreference = "Stop"

$runtimeOps = Join-Path $RuntimeDir "ops"
$runner = Join-Path $runtimeOps "run-api-unattended-patrol.ps1"
if (-not (Test-Path -LiteralPath $runner)) {
  throw "runner not found: $runner"
}

$pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
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
  ('"{0}"' -f $ComputerLabel),
  "-Checkpoint",
  "scheduled"
)

if (-not [string]::IsNullOrWhiteSpace($ReleaseSha)) {
  $argumentParts += @(
    "-ReleaseSha",
    ('"{0}"' -f $ReleaseSha)
  )
}

$actionParams = @{
  Execute = $pwsh.Source
  Argument = ($argumentParts -join " ")
}
try {
  $action = New-ScheduledTaskAction @actionParams -WorkingDirectory $Root
}
catch {
  $action = New-ScheduledTaskAction @actionParams
}

$triggers = foreach ($time in $Times) {
  New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($time, "HH:mm", $null))
}

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 25)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Description "Read-only Fuman production API unattended patrol with Gmail alert on failure." `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
