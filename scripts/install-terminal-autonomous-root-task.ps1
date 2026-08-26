param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [string]$TaskName = "Fuman Terminal Autonomous Root Monitor",
  [string[]]$At = @("06:05", "07:08", "08:00", "08:20", "08:36", "12:20", "13:15", "16:10", "17:00", "21:40", "22:00", "23:10"),
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
  $triggers += New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact($time, "HH:mm", $null))
}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-FumanPrincipal
$description = "Single sequenced master control: read-only checkpoints during the day; full read-only audit at 23:10. Never starts or reruns a strategy."

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description $description -Force | Out-Null
Write-Host ("[terminal-autonomous-root-task] installed task={0} root={1} triggers={2} readOnlyController={3} requireProtectedReadback={4} interactiveFallback={5}" -f $TaskName, $ProjectRoot, ($At -join ","), $true, [bool]$RequireProtectedReadback, [bool]$InteractiveFallback)
