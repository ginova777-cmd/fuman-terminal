param(
  [string]$ProjectRoot = 'C:\fuman-release-owner\fuman-terminal',
  [string]$RuntimeRoot = 'C:\fuman-runtime'
)
$ErrorActionPreference = 'Stop'
$pwsh = 'C:\Program Files\PowerShell\7\pwsh.exe'
$runner = Join-Path $ProjectRoot 'scripts\run-scorecard88-terminal-collector.ps1'
if (-not (Test-Path -LiteralPath $runner)) { throw "runner_missing:$runner" }
$definitions = @(
  @{ Name='Fuman Scorecard88 Collect Strategy2 1240'; At='12:40'; Slot='12:40' },
  @{ Name='Fuman Scorecard88 Collect Strategy3 1315'; At='13:15'; Slot='13:15' },
  @{ Name='Fuman Scorecard88 Collect Strategy4 1700'; At='17:00'; Slot='17:00' },
  @{ Name='Fuman Scorecard88 Collect Evening 2140'; At='21:40'; Slot='21:40' }
)
foreach ($definition in $definitions) {
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Slot `"$($definition.Slot)`" -ProjectRoot `"$ProjectRoot`" -RuntimeRoot `"$RuntimeRoot`""
  $action = New-ScheduledTaskAction -Execute $pwsh -Argument $args
  $trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $definition.At
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
  Register-ScheduledTask -TaskName $definition.Name -Action $action -Trigger $trigger -Settings $settings -User $env:USERNAME -Force -ErrorAction Stop | Out-Null
  Write-Output "[scorecard88] installed task=$($definition.Name) at=$($definition.At) slot=$($definition.Slot)"
}
