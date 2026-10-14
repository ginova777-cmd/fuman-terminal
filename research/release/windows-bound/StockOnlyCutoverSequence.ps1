Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Stock-only sequence. The production adapter must supply sealed, independently
# verified ports; this file never constructs an OS/process/deployment adapter.
function Invoke-StockOnlyCutoverSequence($Ports) {
 $required=@('preflight','requesterExited','fence','archive','assertPreservedFuture','deploy','verifyDeployment','handbackStock','handbackWriter','restore','assertStockWriterIdle','rollback','verifyRollback','retain','receipt')
 foreach($name in $required){if(!$Ports.ContainsKey($name) -or $Ports[$name] -isnot [scriptblock]){throw ('STOCK_PORT_REQUIRED:'+ $name)}}
 foreach($name in @('stopLegacy','startFuture','stopNewSafe','restoreOldFuture')){if($Ports.ContainsKey($name)){throw 'FUTURES_CONTROL_PORT_FORBIDDEN'}}
 $result=[ordered]@{status='BLOCKED';scope='STOCK_ONLY';formal_execution=$Ports.formal;stages=@();rollback_count=0;error=$null;recovery_error=$null;natural_acceptance='NOT_OBSERVED'}
 $fenced=$false;$deployAttempted=$false;$handbackAttempted=$false
 function SaveStage($name){$result.stages+=@{name=$name;at=[DateTimeOffset]::UtcNow.ToString('o')}; & $Ports.receipt $result}
 function CheckContinue {if(& $Ports.requesterExited){throw 'REQUESTER_EXITED'};& $Ports.assertPreservedFuture}
 try {
  & $Ports.preflight;CheckContinue;SaveStage 'PREFLIGHT_VERIFIED'
  $fenced=$true;& $Ports.fence;CheckContinue;SaveStage 'FENCED'
  & $Ports.archive;CheckContinue;SaveStage 'ARCHIVE_VERIFIED'
  & $Ports.assertStockWriterIdle
  $deployAttempted=$true;& $Ports.deploy;& $Ports.verifyDeployment;CheckContinue;SaveStage 'STOCK_DEPLOYMENT_VERIFIED'
  # A restored schedule might start a process. Never checkout after this boundary.
  $handbackAttempted=$true;& $Ports.handbackStock;CheckContinue;SaveStage 'STOCK_HANDBACK_VERIFIED'
  & $Ports.handbackWriter;CheckContinue;SaveStage 'WRITER_HANDBACK_VERIFIED'
  & $Ports.restore;$fenced=$false;SaveStage 'FENCE_RESTORED'
  $result.status='STOCK_CUTOVER_CONTROL_VERIFIED_NATURAL_PENDING'
 } catch {
  $result.error=$_.Exception.Message
  if($fenced){try {
   # Preservation drift, unknown users or partial handback require retained control.
   & $Ports.assertPreservedFuture
   if($handbackAttempted){throw 'HANDBACK_STARTED_NO_AUTOMATIC_CHECKOUT'}
   & $Ports.assertStockWriterIdle
   if($deployAttempted){$result.rollback_count++;& $Ports.rollback;& $Ports.verifyRollback;& $Ports.assertPreservedFuture;SaveStage 'STOCK_ROLLBACK_VERIFIED'}
   & $Ports.restore;$fenced=$false
   $result.status=if($deployAttempted){'STOCK_RELEASE_RECOVERED'}else{'ABORTED_ORIGINAL_TASKS_RESTORED'}
  }catch{$result.recovery_error=$_.Exception.Message;$result.status='MANUAL_RECOVERY_REQUIRED';& $Ports.retain}}
 } finally {& $Ports.receipt $result}
 return $result
}
