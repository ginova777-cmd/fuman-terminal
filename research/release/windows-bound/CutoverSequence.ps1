Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

# Same state machine for isolated port tests and the sealed production entry.
# Only the formal entry constructs the real ports; it exposes no fixture switches.
function Invoke-CutoverSequence($Ports) {
 $r=[ordered]@{status='BLOCKED';stages=@();rollback_count=0;formal_execution=$Ports.formal;error=$null;recovery_error=$null}
 $fenced=$false;$legacyStopAttempted=$false;$deployAttempted=$false;$futureStartAttempted=$false;$stockHandbackAttempted=$false
 function Stage($Name){$r.stages+=@{name=$Name;at=[DateTimeOffset]::UtcNow.ToString('o')}; & $Ports.receipt $r}
 function Assert-RequesterContinues {if(& $Ports.requesterExited){throw 'REQUESTER_EXITED'}}
 try{
  & $Ports.preflight;Stage 'PREFLIGHT_VERIFIED';Assert-RequesterContinues
  $fenced=$true;& $Ports.fence;Stage 'FENCED';Assert-RequesterContinues
  & $Ports.archive;Stage 'ARCHIVE_VERIFIED';Assert-RequesterContinues
  $legacyStopAttempted=$true;& $Ports.stopLegacy;Stage 'LEGACY_EXIT_VERIFIED';Assert-RequesterContinues
  $deployAttempted=$true;& $Ports.deploy;Stage 'PAIRED_DEPLOY_VERIFIED';Assert-RequesterContinues
  $futureStartAttempted=$true;& $Ports.startFuture;& $Ports.verifyFuture;Stage 'FUTURE_TRANSPORT_VERIFIED';Assert-RequesterContinues
  # Once a stock launcher may start, checkout is forbidden until an independently
  # authorized stock stop path exists. This release does not invent that path.
  $stockHandbackAttempted=$true;& $Ports.handbackStock;Stage 'STOCK_HANDBACK_VERIFIED';Assert-RequesterContinues
  & $Ports.handbackWriter;Stage 'WRITER_HANDBACK_VERIFIED'
  & $Ports.restore;$fenced=$false;$r.status='CUTOVER_CONTROL_FLOW_VERIFIED_RUNTIME_ACCEPTANCE_PENDING'
 }catch{
  $r.error=$_.Exception.Message
  if($legacyStopAttempted -and !$deployAttempted -and $_.Exception.Data['StopNotRequested'] -ceq $true){
   try{
    & $Ports.assertUnstoppedLegacy
    Stage 'NO_STOP_REQUEST_OLD_RUNTIME_REVERIFIED'
    & $Ports.restore;$fenced=$false;$r.status='ABORTED_BEFORE_STOP_ORIGINAL_TASKS_RESTORED'
   }catch{
    $r.recovery_error=$_.Exception.Message;$r.status='MANUAL_RECOVERY_REQUIRED'; & $Ports.retain
   }
  }elseif($legacyStopAttempted){
   try{
    if($stockHandbackAttempted){& $Ports.assertNoStockOrWriter}
    & $Ports.refence;Stage 'RECOVERY_FENCED'
    if($futureStartAttempted){& $Ports.stopNewSafe}
    & $Ports.assertNoUsers
    if($deployAttempted){$r.rollback_count++; & $Ports.rollback}
    & $Ports.restoreOldFuture;Stage 'OLD_FUTURE_VERIFIED'
    & $Ports.handbackStock;& $Ports.handbackWriter;& $Ports.restore;$fenced=$false;$r.status='RECOVERED_OLD_RELEASE'
   }catch{
    $r.recovery_error=$_.Exception.Message;$r.status='MANUAL_RECOVERY_REQUIRED'
    & $Ports.retain
   }
  }elseif($fenced){
   try{& $Ports.restore;$fenced=$false}catch{$r.recovery_error=$_.Exception.Message;$r.status='MANUAL_RECOVERY_REQUIRED';& $Ports.retain}
  }
 }finally{& $Ports.receipt $r}
 return $r
}
