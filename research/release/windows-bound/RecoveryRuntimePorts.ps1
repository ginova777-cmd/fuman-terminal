Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. "$PSScriptRoot/RecoveryPreflight.ps1"
. "$PSScriptRoot/RecoveryRelease.ps1"

function Enter-RecoveryKnownMutex($Name,[bool]$AllowKnownAbandoned){
 $mutex=[Threading.Mutex]::new($false,$Name)
 try{
  try{$acquired=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{
   if(!$AllowKnownAbandoned){$mutex.ReleaseMutex();throw 'RECOVERY_ABANDONED_LOCK_REQUIRES_DEAD_OWNER_PROOF'}
   $acquired=$true
  }
  if(!$acquired){throw 'RECOVERY_KNOWN_MUTEX_BUSY'}
  $held=[Collections.Generic.List[object]]::new();$held.Add($mutex);return ,$held
 }catch{$mutex.Dispose();throw}
}

function New-RecoveryRuntimePorts($Config,$Directory,$Identity,$OwnerLock){
 $working=@{future=$null;terminal=$null;pendingStop=$null;gate=$null;head=$null;needsRollback=$false}
 $ports=@{
  authorize={param($b,$q,$mode)
   Assert-RecoveryPackageContext $Config $b
   Assert-RecoveryNoReparse $PSScriptRoot $Directory
   if($mode -eq 'LIVE'){
    Assert-RecoveryOwnerIdentity $Identity $b.context.owner
    if($PID -ne $b.context.owner.owner_pid){throw 'RECOVERY_REQUIRES_ORIGINAL_OWNER_PROCESS'}
   }elseif($mode -eq 'DEAD'){
    if(Get-Process -Id $b.context.owner.owner_pid -ErrorAction SilentlyContinue){throw 'RECOVERY_ORIGINAL_OWNER_NOT_ABSENT'}
    Assert-RecoveryOwnerIdentity $Identity.recovery_parent $b.context.owner
    if($Identity.owner_pid -ne $PID -or [string](Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks -cne $Identity.creation_ticks){throw 'RECOVERY_SUCCESSOR_IDENTITY'}
   }else{throw 'RECOVERY_MODE_UNKNOWN'}
  }.GetNewClosure()
  precheck={param($b,$q,$owner)
   Assert-RecoveryOriginalTasks $b.context.binding
   Test-EvidenceOff $Config
   Assert-RecoveryWindow
   $head=(& git -C $Config.prod rev-parse HEAD).Trim();$working.head=$head
   if($head -notin @($Config.expected,$Config.target)){throw 'RECOVERY_PRODUCTION_UNKNOWN'}
   Invoke-PairedVerifier $Config $head|Out-Null
   $working.needsRollback=($head -eq $Config.target -or (Test-Path (Get-RecoveryReleaseLock)))
   if($working.needsRollback){$null=Assert-RecoveryReleaseJournal $Config $Directory $b $q}
   if(!$b.state.legacy){throw 'RECOVERY_ORIGINAL_RUNTIME_IDENTITY_MISSING'}
   if($working.pendingStop){
    $working.terminal=Read-RecoveryTerminalProof $Config $working.pendingStop
    $working.pendingStop=$null;$working.future=$null
   }
   if(!$working.future -and $b.state.future -and (Get-Process -Id $b.state.future.pid -ErrorAction SilentlyContinue)){$working.future=$b.state.future}
   if($b.state.stop_state -eq 'NOT_REQUESTED'){
    if($head -ne $Config.expected){throw 'RECOVERY_TARGET_WITHOUT_STOP_PROOF'}
    $working.future=$b.state.legacy
   }elseif($b.state['legacy_stop_receipt_hash']){
    $stopFile=Join-Path (Split-Path $Directory) 'graceful-stop.json'
    if((Get-RecoveryHash $stopFile) -cne $b.state.legacy_stop_receipt_hash){throw 'RECOVERY_FROZEN_STOP_PROOF_DRIFT'}
    $proof=Get-Content $stopFile -Raw|ConvertFrom-Json -AsHashtable
    if($proof.status -ne 'GRACEFUL_STOP_VERIFIED' -or $proof.pid -ne $b.state.legacy.pid -or $proof.pid_exited -isnot [bool] -or !$proof.pid_exited){throw 'RECOVERY_FROZEN_STOP_PROOF_INVALID'}
   }else{$working.terminal=Read-RecoveryTerminalProof $Config $b.state.stop_identity}
   Assert-OnlyBoundFuture $Config $working.future
  }.GetNewClosure()
  fence={param($b,$q,$owner)
   Assert-FenceOwnerIdentity $owner
   Assert-RecoveryOriginalTasks $b.context.binding
   if(!$owner.db){$owner.db=[IO.File]::Open($b.context.binding.locks.database_round,'OpenOrCreate','ReadWrite','None')}
   if(!$owner.stock){$owner.stock=Enter-RecoveryKnownMutex $b.context.binding.locks.stock ($q.mode -eq 'DEAD')}
   if(!$owner.writer){$owner.writer=Enter-RecoveryKnownMutex $b.context.binding.locks.writer ($q.mode -eq 'DEAD')}
   Assert-HeldFence $owner
   foreach($t in $b.context.binding.tasks){
    $a=Get-TaskBinding $t.binding.name
    Suspend-BoundTask $a|Out-Null
   }
   $owner.suspended.Clear()
   foreach($t in $b.context.binding.tasks){$owner.suspended.Add($t.binding)}
   Write-OwnerState $owner 'RECOVERY_FENCED'
  }.GetNewClosure()
  runtime={param($b,$q,$owner)
   Assert-HeldFence $owner
   $attempt=Join-Path "$Directory/attempts" $q.request_id
   $Identity.maintenance_verified=$true;$Identity.approval_not_before=$q.not_before;$Identity.approval_expires_at=$q.expires_at
   $working.gate="$attempt/owner-gate.json";Write-CutoverReceipt $working.gate $Identity
   if($working.needsRollback){
    if($working.future){
     if($q['allow_stop_bound_future'] -isnot [bool] -or !$q.allow_stop_bound_future){throw 'RECOVERY_BOUND_FUTURE_STOP_GO_REQUIRED'}
     Assert-OnlyBoundFuture $Config $working.future
     $working.pendingStop=Get-Content (Join-Path $Config.runtime 'state/futopt-shutdown/owner.json') -Raw|ConvertFrom-Json -AsHashtable -DateKind String
     if($working.pendingStop.pid -ne $working.future.pid){throw 'RECOVERY_NEW_STOP_IDENTITY_DRIFT'}
     Write-CutoverReceipt "$attempt/before-bound-stop.json" $working.pendingStop
     Invoke-BoundGracefulStop $Config $working.future $working.gate "$attempt/bound-stop.json"|Out-Null
     $working.pendingStop=$null;$working.future=$null
    }
    Invoke-RecoveryRollback $Config $Directory $b $q $working.gate
    $working.head=$Config.expected
   }
   Invoke-PairedVerifier $Config $Config.expected|Out-Null
   if(!$working.future){
    Assert-OnlyBoundFuture $Config $null
    if($q['allow_start_original_future'] -isnot [bool] -or !$q.allow_start_original_future){throw 'RECOVERY_FUTURE_START_GO_REQUIRED'}
    Write-CutoverReceipt "$attempt/future-start-intent.json" @{at=[DateTimeOffset]::UtcNow.ToString('o');sha=$Config.expected}
    $working.future=Start-BoundFuture $Config $attempt
    Write-CutoverReceipt "$attempt/future-start-identity.json" $working.future
   }
   $null=Wait-BoundFuture $Config $working.future
  }.GetNewClosure()
  restore={param($b,$q,$owner)
   Assert-HeldFence $owner
   Invoke-PairedVerifier $Config $Config.expected|Out-Null
   Assert-OnlyBoundFuture $Config $working.future
   $proof=Wait-BoundFuture $Config $working.future
   Write-CutoverReceipt "$Directory/attempts/$($q.request_id)/runtime-proof.json" $proof
   Assert-RecoveryOriginalTasks $b.context.binding
   $owner.manual_recovery_required=$false
   Restore-ProductionFence $owner
  }.GetNewClosure()
  verify={param($b,$q,$owner)
   Invoke-PairedVerifier $Config $Config.expected|Out-Null
   foreach($t in $b.context.binding.tasks){
    $a=Get-TaskBinding $t.binding.name
    if($a.path -cne $t.binding.path -or $a.definition_sha256 -cne $t.binding.definition_sha256 -or $a.enabled -cne $t.binding.enabled){throw 'RECOVERY_FINAL_TASK_READBACK'}
   }
   Test-EvidenceOff $Config
   if(Test-Path (Get-RecoveryReleaseLock)){throw 'RECOVERY_RELEASE_LOCK_REMAINS'}
   Assert-OnlyBoundFuture $Config $working.future
  }.GetNewClosure()
 }
 return $ports
}
