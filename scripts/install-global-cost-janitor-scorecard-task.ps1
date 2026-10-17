param([string]$TaskName='Fuman Global Cost Janitor Scorecard 1555',[string]$At='18:10',[switch]$RunNow)
$ErrorActionPreference='Stop'
if ($RunNow) { throw 'Installer does not authorize a cleanup run' }
if ($TaskName -ne 'Fuman Global Cost Janitor Scorecard 1555' -or $At -ne '18:10') { throw 'Cleanup schedule drift' }
& (Join-Path $PSScriptRoot 'install-five-stage-cleanup-task.ps1') -OnlyTask $TaskName
