param([string]$TaskName='Fuman API-Only Retired Artifact Cleanup 1535',[string]$At='17:10',[switch]$RunNow)
$ErrorActionPreference='Stop'
if ($RunNow) { throw 'Installer does not authorize a cleanup run' }
if ($TaskName -ne 'Fuman API-Only Retired Artifact Cleanup 1535' -or $At -ne '17:10') { throw 'Cleanup schedule drift' }
& (Join-Path $PSScriptRoot 'scripts\install-five-stage-cleanup-task.ps1') -OnlyTask $TaskName
