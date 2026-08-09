param(
  [string]$Root = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$TaskName = "Fuman Terminal Autonomous Ops 5m",
  [int]$EveryMinutes = 5,
  [int]$AuditDays = 9,
  [datetime]$AuditStartDate = (Get-Date).Date,
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
if ($EveryMinutes -lt 1 -or $EveryMinutes -gt 60) { throw "EveryMinutes must be between 1 and 60" }
if ($AuditDays -lt 1 -or $AuditDays -gt 31) { throw "AuditDays must be between 1 and 31" }
$runner = Join-Path $Root "scripts\run-terminal-autonomous-ops.js"
if (-not (Test-Path -LiteralPath $runner)) { throw "autonomous ops runner missing: $runner" }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$arguments = '--use-system-ca "{0}" --apply --apply-scanners --publish' -f $runner
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $Root
$now = Get-Date
$windowStart = $AuditStartDate.Date
$triggers = [System.Collections.Generic.List[object]]::new()
for ($offset = 0; $offset -lt $AuditDays; $offset++) {
  $day = $windowStart.AddDays($offset)
  $start = $day.AddHours(6)
  $end = $day.AddHours(22).AddMinutes(30)
  if ($day.Date -eq $now.Date -and $start -le $now) { $start = $now.AddMinutes(1) }
  if ($start -lt $now) { continue }
  $duration = $end - $start
  if ($duration.TotalMinutes -lt $EveryMinutes) { continue }
  [void]$triggers.Add((New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) -RepetitionDuration $duration))
}
if ($triggers.Count -eq 0) { throw "no future triggers remain in the audit window" }
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$settings.DisallowStartIfOnBatteries = $false
$settings.StopIfGoingOnBatteries = $false
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$plan = [pscustomobject]@{
  taskName = $TaskName
  runner = $runner
  node = $node
  arguments = $arguments
  cadenceMinutes = $EveryMinutes
  auditDays = $AuditDays
  auditStartDate = $windowStart.ToString("yyyy-MM-dd")
  auditHours = "06:00-22:30"
  configuredTriggerCount = $triggers.Count
  multipleInstances = "IgnoreNew"
  executionLimitMinutes = 15
  apply = $Apply.IsPresent
  note = "Run elevated on the orchestrator host. Nine-day audit window, 06:00-22:30 every 5 minutes. Source writer remains on the approved writer host; gate failures stay fail-closed."
}
if (-not $Apply) {
  $plan | ConvertTo-Json -Depth 5
  exit 0
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalIdentity = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principalIdentity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "install requires an elevated PowerShell window; run PowerShell as Administrator and retry -Apply"
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description "Gated Fuman Terminal autonomous recovery, scan, publish and closure controller." -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State,TaskPath
