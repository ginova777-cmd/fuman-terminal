param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [string]$TaskName = "Fuman Terminal Autonomous Root Monitor",
  [string[]]$At = @("06:05", "07:08", "08:20", "08:30", "08:35", "08:36", "09:00", "12:10", "12:20", "12:55", "13:00", "13:15", "15:35", "16:00", "16:10", "17:00", "21:00", "21:10", "21:15", "21:30", "21:40", "22:00", "23:10"),
  [switch]$RequireProtectedReadback,
  [switch]$InteractiveFallback
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
if ($RequireProtectedReadback) { $argumentParts += "-RequireProtectedReadback" }

$action = New-ScheduledTaskAction -Execute $Pwsh -Argument ($argumentParts -join " ") -WorkingDirectory $ProjectRoot
function New-FumanPrincipal {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  if ($InteractiveFallback) {
    return New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  }
  return New-ScheduledTaskPrincipal -UserId $identity -LogonType S4U -RunLevel Highest
}

$triggers = @()
foreach ($time in $At) {
  $triggers += New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact($time, "HH:mm", $null))
}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-FumanPrincipal
$description = "Autonomous root monitor: predictive preflight, water root, daily manifest, state machine, job queue roll-forward, runId closure, production readback. Membership gates display only."

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description $description -Force | Out-Null
Write-Host ("[terminal-autonomous-root-task] installed task={0} root={1} triggers={2} readOnlyController={3} requireProtectedReadback={4} interactiveFallback={5}" -f $TaskName, $ProjectRoot, ($At -join ","), $true, [bool]$RequireProtectedReadback, [bool]$InteractiveFallback)
