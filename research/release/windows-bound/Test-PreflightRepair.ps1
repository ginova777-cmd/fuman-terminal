$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ProductionMaintenanceBinding.ps1')
$stock='Fuman Fugle Daytrade WebSocket Collector 0600-1330';$writer='Fuman Daytrade Source Writer 0600-1330'
$results=@()
function Get-TaskBinding($Name){$t=$script:actual[$Name];if(!$t){throw 'TASK_MISSING'};return $t.Clone()}
function Restore-BoundTask($Expected){
 Assert-HandbackDefinition $Expected
 if($Expected.name -eq $script:failRestore){throw 'TASK_RESTORE_READBACK_FAILED'}
 $script:actual[$Expected.name].enabled=$Expected.enabled;$script:restored.Add($Expected.name)
}
function Exit-BoundMutexes($Held){$script:released.Add($Held)}
function Write-OwnerState($Owner,$Stage){}
foreach($case in @('normal','wrong-role','unknown-role','missing-task','definition-drift','stock-restore-failure','writer-restore-failure')){
 $b=@{tasks=@()};$script:actual=@{};$script:restored=[Collections.Generic.List[string]]::new();$script:released=[Collections.Generic.List[string]]::new();$script:failRestore=''
 foreach($name in @('Closing',$writer,$stock)){$t=@{name=$name;path='\';enabled='true';definition_sha256=('a'*64)};$b.tasks+=@{binding=$t};$script:actual[$name]=$t.Clone();$script:actual[$name].enabled='false'}
 switch($case){
  'wrong-role' {$b.tasks[0].role='stock'}
  'unknown-role' {$b.tasks[2].role='UNKNOWN'}
  'missing-task' {$script:actual.Remove($stock)}
  'definition-drift' {$script:actual[$writer].definition_sha256=('b'*64)}
  'stock-restore-failure' {$script:failRestore=$stock}
  'writer-restore-failure' {$script:failRestore=$writer}
 }
 $db=[pscustomobject]@{disposed=$false};$db|Add-Member ScriptMethod Dispose {$this.disposed=$true}
 $o=@{binding=$b;stock='stock';writer='writer';db=$db;stock_handed_back=$false;writer_handed_back=$false}
 $errorCode=$null
 try{Release-StockBinding $o;if($restored.Count -ne 1 -or $restored[0] -ne $stock -or $db.disposed){throw 'WRONG_HANDBACK_ORDER'};Restore-WriterBinding $o @{transport_identity_pass=$true}}catch{$errorCode=$_.Exception.Message}
 if($case -eq 'normal'){if($errorCode -or !$o.writer_handed_back -or $restored.Count -ne 3){throw 'NORMAL_FAILED'}}
 else{
  if(!$errorCode -or $o.writer_handed_back){throw ('FAILURE_NOT_REJECTED:'+ $case)}
  if($case -in @('wrong-role','unknown-role','missing-task','definition-drift') -and ($released.Count -or $restored.Count)){throw 'MUTATED_BEFORE_IDENTITY_CHECK'}
  if($case -eq 'stock-restore-failure' -and ($o.stock_handed_back -or $db.disposed -or !$o.writer)){throw 'WRITER_RELEASED_AFTER_STOCK_FAILURE'}
 }
 $results+=@{case=$case;status='PASS';observed_error=$errorCode}
}
# Execute the real entrypoint against a local stub reader. No Apply ports loaded.
$tmp=Join-Path ([IO.Path]::GetTempPath()) ('owner-preflight-'+[guid]::NewGuid())
New-Item -ItemType Directory $tmp|Out-Null
Copy-Item (Join-Path $PSScriptRoot 'Invoke-ProductionMaintenanceOwner.ps1') $tmp
Set-Content (Join-Path $tmp 'Read-ProductionBinding.ps1') "'{`"mode`":`"READ_ONLY_PREFLIGHT`",`"locks_acquired`":false}'"
foreach($mode in @('WhatIf','Preflight')){
 $arg=@{};$arg[$mode]=$true;$r=(& (Join-Path $tmp 'Invoke-ProductionMaintenanceOwner.ps1') @arg)|ConvertFrom-Json
 if($r.mode -ne 'READ_ONLY_PREFLIGHT' -or $r.locks_acquired){throw 'READONLY_ROUTE_FAILED'}
 $blocked=$false;try{& (Join-Path $tmp 'Invoke-ProductionMaintenanceOwner.ps1') @arg -Apply}catch{$blocked=$_.Exception.Message -eq 'READONLY_APPLY_MODE_CONFLICT'}
 if(!$blocked){throw 'MODE_CONFLICT_NOT_BLOCKED'}
 $results+=@{case=$mode+'-route-and-Apply-conflict';status='PASS'}
}
@{status='PASS';cases=$results;formal_mutations=$false}|ConvertTo-Json -Depth 6
