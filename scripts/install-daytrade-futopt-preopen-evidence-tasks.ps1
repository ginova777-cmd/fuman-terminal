param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [string]$UserId = "$env:USERDOMAIN\$env:USERNAME"
)

$ErrorActionPreference = "Stop"
$runner = Join-Path $ProjectRoot "ops\Run-DaytradeFutoptPreopenEvidence.ps1"
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $runner)) { throw "canonical preopen wrapper missing: $runner" }
if (-not (Test-Path -LiteralPath $pwsh)) { throw "PowerShell 7 missing: $pwsh" }

$definitions = @(
  @{ Slot="0845"; At="08:45" },
  @{ Slot="0850"; At="08:50" },
  @{ Slot="0855"; At="08:55" },
  @{ Slot="0859"; At="08:59" }
)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType S4U -RunLevel Highest

foreach ($definition in $definitions) {
  # Copy the values into scalars before passing them to ScheduledTasks cmdlets.
  # Member expressions used directly as command arguments can be rebound by
  # PowerShell's argument-mode parser and previously made later slots inherit
  # the 08:45 trigger.
  [string]$slot = $definition["Slot"]
  [string]$at = $definition["At"]
  $taskName = "Fuman Daytrade Futopt Preopen Evidence $slot"
  $arguments = "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Slot $slot -RuntimeDir `"$RuntimeRoot`" -TerminalDir `"$ProjectRoot`""
  $action = New-ScheduledTaskAction -Execute $pwsh -Argument $arguments -WorkingDirectory $ProjectRoot
  $trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $at
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Canonical STAR natural slot ${at}: runner -> DB readback -> verifier -> receipt; no 09:00 data and no formal order." -Force -ErrorAction Stop | Out-Null
}

# New tasks registered by an elevated process can inherit an administrator-only
# task security descriptor. Copy the established 08:45 descriptor through the
# Task Scheduler API so ordinary canonical verifiers can enumerate every slot.
$scheduleService = New-Object -ComObject "Schedule.Service"
$scheduleService.Connect()
$scheduleFolder = $scheduleService.GetFolder("\")
$securityTemplate = $scheduleFolder.GetTask("Fuman Daytrade Futopt Preopen Evidence 0845").GetSecurityDescriptor(7)
foreach ($slot in @("0850", "0855", "0859")) {
  $registeredTask = $scheduleFolder.GetTask("Fuman Daytrade Futopt Preopen Evidence $slot")
  $registeredTask.SetSecurityDescriptor($securityTemplate, 0)
}

# This direct minute-by-minute runner overlaps the four receipt-owning wrappers
# and can create lock contention.  Preserve it disabled for rollback evidence.
$legacyTaskName = "Fuman Daytrade Near-One Natural Source"
if (Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue) {
  Disable-ScheduledTask -TaskName $legacyTaskName -ErrorAction Stop | Out-Null
}

$installed = foreach ($definition in $definitions) {
  [string]$slot = $definition["Slot"]
  [string]$at = $definition["At"]
  $taskName = "Fuman Daytrade Futopt Preopen Evidence $slot"
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $times = @($task.Triggers | ForEach-Object { ([datetime]$_.StartBoundary).ToString("HH:mm") })
  $actionText = "$($task.Actions[0].Execute) $($task.Actions[0].Arguments)"
  if ([string]$task.State -notin @("Ready", "Running", "Queued")) { throw "task not active: $taskName state=$($task.State)" }
  if ([string]$task.Principal.LogonType -ne "S4U") { throw "task LogonType drift: $taskName" }
  if ($times -notcontains $at) { throw "task trigger drift: $taskName expected=$at actual=$($times -join ',')" }
  if ($actionText -notmatch [regex]::Escape($runner)) { throw "task runner drift: $taskName" }
  [pscustomobject]@{ TaskName=$taskName; State=$task.State; At=$at; LogonType=$task.Principal.LogonType; Runner=$runner }
}

$installed
Write-Host "[daytrade-futopt-preopen-tasks] installed canonical slots=08:45,08:50,08:55,08:59; overlapping direct runner disabled"
