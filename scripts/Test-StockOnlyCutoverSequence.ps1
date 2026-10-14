. (Join-Path $PSScriptRoot '../research/release/windows-bound/StockOnlyCutoverSequence.ps1')
$passed=0
foreach($case in @('normal','archive','deploy','verifyDeployment','handbackStock','handbackWriter','futureDrift','occupied','rollbackFailure')){
 $ctx=@{calls=[Collections.Generic.List[string]]::new();deployed=$false;drift=$false;fault=$case}
 $ports=@{formal=$false;requesterExited={return $false};receipt={param($r)};retain={$ctx.calls.Add('retain')};preflight={};fence={$ctx.calls.Add('fence')};restore={$ctx.calls.Add('restore')};archive={if($ctx.fault -eq 'archive'){throw 'ARCHIVE_FAILED'}};assertPreservedFuture={if($ctx.drift){throw 'FUTURE_IDENTITY_DRIFT'}};assertStockWriterIdle={if($ctx.fault -eq 'occupied'){throw 'STOCK_OCCUPIED'}};deploy={$ctx.calls.Add('deploy');$ctx.deployed=$true;if($ctx.fault -eq 'futureDrift'){$ctx.drift=$true};if($ctx.fault -in @('deploy','rollbackFailure')){throw 'DEPLOY_FAILED'}};verifyDeployment={if($ctx.fault -eq 'verifyDeployment'){throw 'VERIFY_FAILED'}};handbackStock={$ctx.calls.Add('handbackStock');if($ctx.fault -eq 'handbackStock'){throw 'STOCK_HANDBACK_FAILED'}};handbackWriter={$ctx.calls.Add('handbackWriter');if($ctx.fault -eq 'handbackWriter'){throw 'WRITER_HANDBACK_FAILED'}};rollback={$ctx.calls.Add('rollback');if($ctx.fault -eq 'rollbackFailure'){throw 'ROLLBACK_FAILED'}};verifyRollback={}}
 $r=Invoke-StockOnlyCutoverSequence $ports
 $expected=switch($case){normal{'STOCK_CUTOVER_CONTROL_VERIFIED_NATURAL_PENDING'} archive{'ABORTED_ORIGINAL_TASKS_RESTORED'} {$_ -in @('deploy','verifyDeployment')}{'STOCK_RELEASE_RECOVERED'} default{'MANUAL_RECOVERY_REQUIRED'}}
 if($r.status -ne $expected){throw "CASE_FAILED:$case $($r|ConvertTo-Json -Compress -Depth 5)"}
 if($case -in @('handbackStock','handbackWriter','futureDrift','occupied') -and $ctx.calls.Contains('rollback')){throw 'UNSAFE_ROLLBACK'}
 if($case -eq 'normal' -and $r.natural_acceptance -ne 'NOT_OBSERVED'){throw 'FALSE_NATURAL_PASS'}
 if($case -eq 'rollbackFailure' -and $r.rollback_count -ne 1){throw 'ROLLBACK_RETRIED'}
 $passed++
}
$ports.stopLegacy={throw 'MUST_NOT_RUN'}
try{Invoke-StockOnlyCutoverSequence $ports;throw 'FORBIDDEN_PORT_ACCEPTED'}catch{if($_.Exception.Message -ne 'FUTURES_CONTROL_PORT_FORBIDDEN'){throw}}
$passed++
@{status='ISOLATED_STOCK_SEQUENCE_PASS';passed=$passed;formal_execution=$false;scope='State machine fault ports only; native production ports not yet integrated'}|ConvertTo-Json
