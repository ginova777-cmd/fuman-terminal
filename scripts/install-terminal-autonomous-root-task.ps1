param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [string]$TaskName = "Fuman Terminal Autonomous Root Monitor",
  [string[]]$At = @(
    "06:00", "06:05", "07:00", "07:08", "08:20", "08:29", "08:30", "08:35", "08:36", "08:40", "08:45", "08:50", "08:55", "09:00",
    "12:30", "12:40", "12:50", "12:55", "13:00", "13:15", "13:30", "15:35", "16:00", "17:00",
    "17:10", "17:40", "18:10", "18:40", "19:10", "20:05", "21:00", "21:10", "21:15", "21:40", "22:00", "23:10"
  ),
  [switch]$RequireProtectedReadback,
  [switch]$InteractiveFallback
)

$ErrorActionPreference = "Stop"
$Runner = Join-Path $ProjectRoot "run-terminal-master-control.ps1"
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
  $triggers += New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At ([DateTime]::ParseExact($time, "HH:mm", $null))
}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -WakeToRun -MultipleInstances Queue
$principal = New-FumanPrincipal
$description = "Single sequenced weekday master control: verifies each formal checkpoint and performs only bounded infrastructure self-heal. Never starts or reruns a strategy or creates a second canonical run."

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description $description -Force -ErrorAction Stop | Out-Null
Write-Host ("[terminal-autonomous-root-task] installed task={0} root={1} weekdayTriggers={2} boundedSelfHeal={3} requireProtectedReadback={4} interactiveFallback={5}" -f $TaskName, $ProjectRoot, ($At -join ","), $true, [bool]$RequireProtectedReadback, [bool]$InteractiveFallback)
