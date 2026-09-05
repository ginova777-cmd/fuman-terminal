param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [string]$TaskName = "Fuman Daytrade Near-One Natural Source",
  [string]$UserId = "$env:USERDOMAIN\$env:USERNAME"
)

$ErrorActionPreference = "Stop"
$runner = Join-Path $ProjectRoot "scripts\run-daytrade-near-one-source.js"
if (-not (Test-Path -LiteralPath $runner)) { throw "near-one source worker missing: $runner" }

$node = (Get-Command node.exe -ErrorAction SilentlyContinue)
if (-not $node) { throw "node.exe not found on the source host" }

$argument = ('--use-system-ca "{0}" --apply --once' -f $runner)
$action = New-ScheduledTaskAction -Execute $node.Source -Argument $argument -WorkingDirectory $ProjectRoot
$triggers = 45..59 | ForEach-Object {
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At ([DateTime]::ParseExact(("08:{0:D2}" -f $_), "HH:mm", $null))
}
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType S4U -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal `
  -Description "Daytrade source-only near-one and immutable natural preopen snapshots; no WebSocket is opened by this task." `
  -Force -ErrorAction Stop | Out-Null

$installed = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if ([string]$installed.Principal.LogonType -ne "S4U") { throw "near-one task postcondition failed: LogonType=$($installed.Principal.LogonType) expected=S4U" }
if ([string]$installed.Principal.RunLevel -ne "Highest") { throw "near-one task postcondition failed: RunLevel=$($installed.Principal.RunLevel) expected=Highest" }
$installed | Select-Object TaskName, State, @{n="LogonType";e={$_.Principal.LogonType}}, @{n="RunLevel";e={$_.Principal.RunLevel}}
Write-Host ("[daytrade-near-one-source-task] installed task={0} root={1} triggers=08:45-08:59 weekdays logon=S4U; runner still uses the TWSE calendar as authority" -f $TaskName, $ProjectRoot)
