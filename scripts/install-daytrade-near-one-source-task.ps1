param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [string]$TaskName = "Fuman Daytrade Near-One Natural Source"
)

$ErrorActionPreference = "Stop"
$runner = Join-Path $ProjectRoot "scripts\run-daytrade-near-one-source.js"
if (-not (Test-Path -LiteralPath $runner)) { throw "near-one source worker missing: $runner" }

$node = (Get-Command node.exe -ErrorAction SilentlyContinue)
if (-not $node) { throw "node.exe not found on the source host" }

$argument = ('--use-system-ca "{0}" --apply --once' -f $runner)
$action = New-ScheduledTaskAction -Execute $node.Source -Argument $argument -WorkingDirectory $ProjectRoot
$triggers = @(New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact("08:45", "HH:mm", $null)))
$triggers[0].Repetition.Interval = "PT1M"
$triggers[0].Repetition.Duration = "PT15M"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Description "Daytrade source-only near-one and immutable natural preopen snapshots; no WebSocket is opened by this task." `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
Write-Host ("[daytrade-near-one-source-task] installed task={0} root={1} window=08:45-08:59 interval=1m" -f $TaskName, $ProjectRoot)
