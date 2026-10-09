$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'WindowsScheduleBinding.ps1')
# Only cmdlet boundaries are replaced. No Windows task is read or changed.
$script:enabled=$true
$script:state='Ready'
$script:command='fixture.exe'
$script:writes=0
function Get-ScheduledTask { param($TaskName,$ErrorAction) [pscustomobject]@{TaskPath='\';Settings=@{Enabled=$script:enabled};State=$script:state} }
function Export-ScheduledTask { param($TaskName,$TaskPath) "<Task><Settings><Enabled>$script:enabled</Enabled></Settings><Actions><Exec><Command>$script:command</Command></Exec></Actions></Task>" }
function Disable-ScheduledTask {param($TaskName,$TaskPath) $script:writes++;$script:enabled=$false}
function Enable-ScheduledTask {param($TaskName,$TaskPath) $script:writes++;$script:enabled=$true}
$results=@()
$original=Get-TaskBinding 'fixture'
$null=Suspend-BoundTask $original
if($script:enabled){throw 'SUSPEND_FAILED'}
$null=Restore-BoundTask $original
if(!$script:enabled){throw 'RESTORE_FAILED'}
$results+='suspend_restore_readback'
$script:command='changed.exe'
try {$null=Suspend-BoundTask $original;throw 'ACCEPTED_DRIFT'} catch {if($_.Exception.Message -ne 'TASK_BINDING_DRIFT'){throw}}
$results+='definition_drift_rejected'
$script:command='fixture.exe';$script:state='Running'
try {$null=Suspend-BoundTask $original;throw 'ACCEPTED_RUNNING'} catch {if($_.Exception.Message -ne 'TASK_STILL_RUNNING'){throw}}
$results+='running_task_rejected'
if($script:writes -ne 2){throw 'UNEXPECTED_MUTATION'}
$held=Enter-BoundMutexes @('Local\MP-Isolated-'+[guid]::NewGuid().ToString('N'))
Exit-BoundMutexes $held
$results+='real_local_mutex_acquire_release'
@{status='PASS';cases=$results;formal_mutations=0;scope='ACTUAL_BINDING_FUNCTIONS_INTERCEPTED_SCHEDULER_CMDLETS'}|ConvertTo-Json -Depth 5
