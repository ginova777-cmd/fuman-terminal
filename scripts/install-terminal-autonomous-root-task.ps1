param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [string]$TaskName = "Fuman Terminal Autonomous Root Monitor",
  [string[]]$At = @("08:55", "09:10", "09:40", "13:35", "14:10", "16:10", "21:35", "22:00"),
  [switch]$ApplyScanners,
  [switch]$RequireProtectedReadback
)

$ErrorActionPreference = "Stop"
$Runner = Join-Path $ProjectRoot "run-terminal-autonomous-root.ps1"
if (!(Test-Path -LiteralPath $Runner)) {
  throw "missing autonomous root runner: $Runner"
}

$Pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $Pwsh) {
  $Pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
}
if (!(Test-Path -LiteralPath $Pwsh)) {
  $Pwsh = "powershell.exe"
}

$argumentParts = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", ('"{0}"' -f $Runner),
  "-ProjectRoot", ('"{0}"' -f $ProjectRoot),
  "-RuntimeRoot", ('"{0}"' -f $RuntimeRoot)
)
if ($ApplyScanners) { $argumentParts += "-ApplyScanners" }
if ($RequireProtectedReadback) { $argumentParts += "-RequireProtectedReadback" }

$action = New-ScheduledTaskAction -Execute $Pwsh -Argument ($argumentParts -join " ") -WorkingDirectory $ProjectRoot
$triggers = @()
foreach ($time in $At) {
  $triggers += New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact($time, "HH:mm", $null))
}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$description = "Autonomous root monitor: predictive preflight, water root, daily manifest, state machine, job queue roll-forward, runId closure, production readback. Membership gates display only."

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Description $description -Force | Out-Null
Write-Host ("[terminal-autonomous-root-task] installed task={0} root={1} triggers={2} applyScanners={3} requireProtectedReadback={4}" -f $TaskName, $ProjectRoot, ($At -join ","), [bool]$ApplyScanners, [bool]$RequireProtectedReadback)
