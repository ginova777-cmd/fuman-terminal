param([string]$TaskName='Fuman Supabase Vercel History Cleanup 1545',[string]$At='17:40',[switch]$RunNow)
$ErrorActionPreference='Stop'
if ($RunNow) { throw 'Installer does not authorize a cleanup run' }
if ($TaskName -ne 'Fuman Supabase Vercel History Cleanup 1545' -or $At -ne '17:40') { throw 'Cleanup schedule drift' }
& (Join-Path $PSScriptRoot 'scripts\install-five-stage-cleanup-task.ps1') -OnlyTask $TaskName
