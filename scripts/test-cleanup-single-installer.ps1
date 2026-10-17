$ErrorActionPreference='Stop'
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('cleanup-installer-fixture-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path $fixture | Out-Null
foreach($file in @('run-api-only-retired-cleanup.ps1','run-history-retention-cleanup.ps1','run-global-cost-janitor-scorecard.ps1','run-daytrade-intraday-retention.ps1','run-daily-retention-maintenance.ps1')){Set-Content -LiteralPath (Join-Path $fixture $file) -Value '# fixture only'}
$script:registrations=@()
function New-ScheduledTaskPrincipal { param($UserId,$LogonType,$RunLevel);[pscustomobject]@{LogonType=$LogonType;RunLevel=$RunLevel} }
function New-ScheduledTaskSettingsSet { param([switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries,[switch]$StartWhenAvailable,$ExecutionTimeLimit,$MultipleInstances);[pscustomobject]@{Enabled=$true;ExecutionTimeLimit=$ExecutionTimeLimit;MultipleInstances=$MultipleInstances} }
function New-ScheduledTaskAction { param($Execute,$Argument,$WorkingDirectory);[pscustomobject]@{Execute=$Execute;Arguments=$Argument;WorkingDirectory=$WorkingDirectory} }
function New-ScheduledTaskTrigger { param([switch]$Weekly,$WeeksInterval,$DaysOfWeek,$At);[pscustomobject]@{At=$At} }
function Get-ScheduledTask { param($TaskName,$ErrorAction);[pscustomobject]@{Settings=[pscustomobject]@{Enabled=$true;MultipleInstances='IgnoreNew';ExecutionTimeLimit='PT20M'};State='Ready';Principal=[pscustomobject]@{LogonType='S4U';RunLevel='Highest'}} }
function Register-ScheduledTask { param($TaskName,$Action,$Trigger,$Principal,$Settings,$Description,[switch]$Force);$script:registrations+= [pscustomobject]@{name=$TaskName;enabled=[bool]$Settings.Enabled;at=$Trigger.At;root=$Action.WorkingDirectory} }
function Get-ScheduledTaskInfo { param($TaskName);[pscustomobject]@{NextRunTime=(Get-Date)} }
$source=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-five-stage-cleanup-task.ps1') -Raw
$source=$source.Replace(". (Join-Path `$PSScriptRoot 'cleanup-execution-root.ps1')",'# isolated guard is covered separately')
$source=$source.Replace('Assert-FumanCleanupExecutionRoot -ExecutionRoot $ProjectRoot','# isolated fixture root')
$source=$source.Replace("`$statusDir = 'C:\fuman-runtime\status'",("`$statusDir = '"+(Join-Path $fixture 'status')+"'"))
& ([scriptblock]::Create($source)) -ProjectRoot $fixture -EnableSingleStart | Out-Null
if($registrations.Count -ne 5){throw 'registration count'}
if(@($registrations|Where-Object enabled).Count -ne 1){throw 'not a single enabled task'}
if($registrations[-1].name -ne 'Fuman API-Only Retired Artifact Cleanup 1535' -or !$registrations[-1].enabled -or $registrations[-1].at -ne '17:10'){throw 'single entry must be registered last'}
if(@($registrations|Where-Object {$_.root -ne $fixture}).Count){throw 'escaped fixture'}
[ordered]@{ok=$true;scope='isolated mocked Task Scheduler; no real Task changed';registrations=$registrations;fixture=$fixture}|ConvertTo-Json -Depth 5
