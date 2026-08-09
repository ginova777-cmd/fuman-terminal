param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [string]$TaskName = "Fuman Terminal Full Unattended Final Audit",
  [string[]]$At = @("07:00", "09:00", "16:00", "22:30"),
  [switch]$InteractiveFallback
)

$ErrorActionPreference = "Stop"
$Runner = Join-Path $ProjectRoot "scripts\run-terminal-unattended-final-audit.js"
if (!(Test-Path -LiteralPath $Runner)) {
  throw "missing unattended final audit runner: $Runner"
}

$Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  throw "node.exe was not found in PATH"
}

$argumentParts = @(
  "`"$Runner`"",
  "--runtime-dir=`"$RuntimeRoot`""
)
$action = New-ScheduledTaskAction -Execute $Node -Argument ($argumentParts -join " ") -WorkingDirectory $ProjectRoot
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
$description = "Fail-closed Fuman Terminal full unattended final audit. Writes one daily final JSON with daily_run_id, first blocker, reason code, allowed action, receipts, manifest and recovery queue. Read-only verifiers only."

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description $description -Force | Out-Null
Write-Host ("[terminal-full-unattended-final-audit-task] installed task={0} root={1} triggers={2} interactiveFallback={3}" -f $TaskName, $ProjectRoot, ($At -join ","), [bool]$InteractiveFallback)



