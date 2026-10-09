param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$Harness)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ProductionMaintenanceBinding.ps1')
# Only the task cmdlets are intercepted; binding/fence/restore functions are real.
$script:taskStates=@{}
function Get-ScheduledTask {param($TaskName,$ErrorAction) [pscustomobject]@{TaskPath='\';Settings=@{Enabled=$script:taskStates[$TaskName]};State='Ready'}}
function Export-ScheduledTask {param($TaskName,$TaskPath) "<Task><Settings><Enabled>$($script:taskStates[$TaskName])</Enabled></Settings><Actions><Exec><Command>isolated-$TaskName</Command></Exec></Actions></Task>"}
function Disable-ScheduledTask {param($TaskName,$TaskPath) $script:taskStates[$TaskName]=$false}
function Enable-ScheduledTask {param($TaskName,$TaskPath) $script:taskStates[$TaskName]=$true}
$root=Join-Path ([IO.Path]::GetTempPath()) ('mp-r3-owner-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$id=[guid]::NewGuid().ToString('N')
$binding=@{files=@();tasks=@();locks=@{database_round=(Join-Path $root 'database-round.lock');stock=('Local\R3-'+$id+'-stock');writer=('Local\R3-'+$id+'-writer')}}
foreach($name in @('stock','writer')){$script:taskStates[$name]=$true;$binding.tasks+=@{binding=(Get-TaskBinding $name)}}
$config=@{target='ISOLATED';binding_sha256=$id;package_sha256=$id;release_approved=$true;remote_main_verified=$true}
$approval=@{action='CONTROLLED_CUTOVER_APPLY';target='ISOLATED';binding_sha256=$id;package_sha256=$id;not_before=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o');expires_at=[DateTimeOffset]::UtcNow.AddMinutes(5).ToString('o')}
$owner=New-ProductionOwner $binding (Join-Path $root 'owner.json')
$proofPath=Join-Path $root 'fence-proof.json'
$runtimeAttempted=$false
$runtimePassed=$false
try{
 Enter-ProductionFence $owner $config $approval
 if(!$owner.db -or !$owner.stock -or !$owner.writer){throw 'FENCE_INCOMPLETE'}
 @{scope='ISOLATED_REVIEW';owner_pid=$PID;owner_creation_date=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o');token=$owner.token;stage=$owner.stage;locks=$binding.locks;tasks_disabled=(@($script:taskStates.Values|Where-Object {$_ -eq $true}).Count -eq 0);checked_at=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $proofPath
 $scriptPath=Join-Path $PSScriptRoot '../test-r3-runtime-e2e.cjs'
 $runtimeAttempted=$true
 & node --max-old-space-size=128 $scriptPath $Source $Harness $proofPath | Tee-Object -FilePath (Join-Path $root 'runtime-output.txt')
 if($LASTEXITCODE -ne 0){throw 'RUNTIME_E2E_FAILED'}
 $runtimePassed=$true
 # This test restores registration only; it never starts a Windows task.
 Release-StockBinding $owner
 Restore-WriterBinding $owner @{transport_identity_pass=$true;scope='ISOLATED_AFTER_ALL_TEST_PROCESSES_EXITED'}
 if($owner.db -or $owner.stock -or $owner.writer){throw 'LOCK_REMAINS'}
 if(@($script:taskStates.Values|Where-Object {$_ -ne $true}).Count){throw 'TASK_HANDBACK_FAILED'}
 # Failure before any runtime mutation must restore exact task state and all locks.
 $failure=New-ProductionOwner $binding (Join-Path $root 'failure-owner.json')
 Enter-ProductionFence $failure $config $approval
 Restore-ProductionFence $failure
 if($failure.db -or $failure.stock -or $failure.writer){throw 'FAILURE_LOCK_REMAINS'}
 @{status='ISOLATED_OWNER_COMPOSITION_PASS';root=$root;runtime=(Get-Content (Join-Path $root 'runtime-output.txt') -Raw|ConvertFrom-Json);task_transport='CMDLET_FIXTURE';mutex_transport='REAL_WINDOWS_LOCAL_MUTEX';database_round='REAL_EXCLUSIVE_FILE';handback='REGISTRATION_RESTORED_NO_FORMAL_TASK_START';failure_restore='PASS';formal_mutations=0}|ConvertTo-Json -Depth 8|Set-Content (Join-Path $root 'receipt.json')
 Write-Output ('OWNER_PASS '+$root)
}finally{
 if($owner.db -or $owner.stock -or $owner.writer){
  if(!$runtimeAttempted -or $runtimePassed){Restore-ProductionFence $owner}
  else {
   @{status='MANUAL_RECOVERY_REQUIRED';reason='ISOLATED_RUNTIME_EXIT_NOT_PROVEN';tasks_restored=$false;lock_lifetime='PROCESS_BOUND_NOT_DURABLE';formal_mutations=0}|ConvertTo-Json|Set-Content (Join-Path $root 'failure.json')
   # No automatic handback when children may remain. OS locks end with this test owner.
  }
 }
}
