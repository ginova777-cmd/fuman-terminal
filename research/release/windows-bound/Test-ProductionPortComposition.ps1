$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ProductionMaintenanceBinding.ps1')
. (Join-Path $PSScriptRoot 'ProductionRuntimePorts.ps1')
. (Join-Path $PSScriptRoot 'CutoverSequence.ps1')
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Invoke-ProductionMaintenanceOwner.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'ENTRY_PARSE_ERROR'}
$assignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$ports'},$true)
if(!$assignment){throw 'FORMAL_PORT_TABLE_MISSING'}
$portScript=[scriptblock]::Create($assignment.Extent.Text)
$results=@()
# The exact formal port table is executed; scheduler/process/release commands are
# intercepted. Local mutex, DB-round file fencing, archive and receipts are real.
function Get-TaskBinding($Name){$script:tasks[$Name].Clone()}
function Suspend-BoundTask($Expected){if($tasks[$Expected.name].enabled -ne $Expected.enabled){throw 'FIXTURE_TASK_DRIFT'};$tasks[$Expected.name].enabled='false'}
function Restore-BoundTask($Expected){$tasks[$Expected.name].enabled=$Expected.enabled}
function Get-RuntimeInventory($Config){if($script:future){return $script:future}}
function Invoke-PairedVerifier($Config,$Sha){if($script:sha -ne $Sha){throw 'FIXTURE_AUTHORITY_MISMATCH'};return @{ok=$true}}
function Test-EvidenceOff($Config){}
function AssertOutsideStockSession {}
function CheckRequester {return ($scenario -eq 'requester-exit-after-deploy' -and $script:sha -eq $config.target)}
function WriteGate {Write-CutoverReceipt $ctx.owner_gate $identity}
function Stop-LegacyBoundProcess($Expected,$ArchiveReceipt,$ReceiptPath,[switch]$OwnerStopAuthorized){
 if(!$OwnerStopAuthorized -or $Expected.pid -ne $script:future.pid){throw 'STOP_IDENTITY'}
 $r=Get-Content $ArchiveReceipt -Raw|ConvertFrom-Json
 if($r.status -ne 'COPIED_BYTES_VERIFIED'){throw 'ARCHIVE_UNVERIFIED'}
 $script:future=$null;Write-CutoverReceipt $ReceiptPath @{status='FIXTURE_EXIT';tail='UNKNOWN'}
}
function ReleaseOperation($Action){if($script:future){throw 'CHECKOUT_WITH_LIVE_USER'};if($Action -eq 'apply'){$script:sha=$config.target}else{$script:sha=$config.expected};New-Item -ItemType Directory $ctx.release -Force|Out-Null;Write-CutoverReceipt (Join-Path $ctx.release 'rollback-receipt.json') @{status='NOT_NEEDED'}}
function Start-BoundFuture($Config,$LogDir){if($script:future){throw 'DUPLICATE_START'};$script:nextPid++;$script:future=@{pid=$script:nextPid;creation_ticks=$script:nextPid;exe='fixture.exe';role='future';entry_verified=$true;entry=(Join-Path $Config.prod 'scripts/fugle-futopt-websocket-collector.js')};return $script:future}
function Wait-BoundFuture($Config,$Identity){if(!$script:future -or $script:future.pid -ne $Identity.pid){throw 'FUTURE_NOT_FOUND'};return @{transport_identity_pass=$true;quality_gate_pass=$false}}
function Stop-NewBoundFuture($Config,$Identity){if($Identity.pid -ne $script:future.pid){throw 'WRONG_NEW_PID'};$script:future=$null}
function git {param($C,$Root,$Rev,$Head);$script:sha}
foreach($scenario in @('normal','requester-exit-after-deploy')){
 $out=Join-Path ([IO.Path]::GetTempPath()) ('production-ports-test-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory (Join-Path $out 'runtime/cache/intraday') -Force|Out-Null
 Set-Content (Join-Path $out 'runtime/cache/intraday/fugle-futopt-ws-quotes.json') '{"fixture":true}'
 Set-Content (Join-Path $out 'runtime/cache/intraday/fugle-futopt-ws-candles.json') '{"fixture":true}'
 $id=[guid]::NewGuid().ToString('N');$script:tasks=@{}
 $binding=@{files=@();tasks=@();locks=@{database_round=(Join-Path $out 'database-round.lock');stock=('Local\PboTest-'+$id+'-Stock');writer=('Local\PboTest-'+$id+'-Writer')}}
 foreach($name in @('fixture-stock','fixture-writer','fixture-0835','fixture-1333')){$task=@{name=$name;path='\';enabled='true';state='Ready';definition_sha256=$name};$binding.tasks+=@{binding=$task};$script:tasks[$name]=$task.Clone()}
 $config=@{prod=(Join-Path $out 'prod');runtime=(Join-Path $out 'runtime');target='new';expected='old';release_approved=$true;remote_main_verified=$true;binding_sha256='fixture';package_sha256='fixture'}
 $approval=@{action='CONTROLLED_CUTOVER_APPLY';target='new';binding_sha256='fixture';package_sha256='fixture';not_before=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o');expires_at=[DateTimeOffset]::UtcNow.AddMinutes(5).ToString('o')}
 $ctx=@{legacy=$null;future=$null;proof=$null;archive=$null;release=(Join-Path $out 'release');owner_gate=(Join-Path $out 'owner-gate.json');keep=$false;current_sha='old'}
 $owner=New-ProductionOwner $binding (Join-Path $out 'owner.json');$identity=@{maintenance_verified=$false}
 $script:sha='old';$script:nextPid=100;$script:future=@{pid=99;creation_ticks=99;exe='fixture.exe';role='future';entry_verified=$true}
 . $portScript
 $ports.formal=$false
 try{
  $r=Invoke-CutoverSequence $ports
  $expected=if($scenario -eq 'normal'){'CUTOVER_CONTROL_FLOW_VERIFIED_RUNTIME_ACCEPTANCE_PENDING'}else{'RECOVERED_OLD_RELEASE'}
  if($r.status -ne $expected){throw ('COMPOSITION_FAILED:'+ $r.error+':'+$r.recovery_error)}
  if($owner.db -or $owner.stock -or $owner.writer){throw 'FENCE_NOT_RELEASED'}
  if(@($tasks.Values|Where-Object enabled -ne 'true').Count){throw 'TASK_NOT_RESTORED'}
  if($ctx.proof.quality_gate_pass){throw 'QUALITY_FABRICATED'}
  $results+=@{scenario=$scenario;status='PASS';root=$out;result=$r;final_sha=$script:sha;formal_port_table_sha256=(Get-FileHash (Join-Path $PSScriptRoot 'Invoke-ProductionMaintenanceOwner.ps1')).Hash}
 }finally{if($owner.db -or $owner.stock -or $owner.writer){$owner.manual_recovery_required=$false;Restore-ProductionFence $owner}}
}
@{status='PASS';cases=$results.Count;results=$results;scope='EXACT_FORMAL_PORT_TABLE_WITH_INTERCEPTED_RUNTIME_AND_REAL_ISOLATED_LOCKS_ARCHIVE_RECEIPTS';formal_mutations=$false}|ConvertTo-Json -Depth 12|Set-Content (Join-Path $PSScriptRoot 'port-composition-tests.json') -Encoding utf8
Write-Output ('PASS '+$results.Count)
