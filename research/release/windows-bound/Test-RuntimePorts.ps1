$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ProductionMaintenanceBinding.ps1')
. (Join-Path $PSScriptRoot 'ProductionRuntimePorts.ps1')
$inventoryBody=${function:Get-RuntimeInventory}
$root=Join-Path ([IO.Path]::GetTempPath()) ('runtime-port-tests-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $root|Out-Null
$results=[Collections.Generic.List[object]]::new()
function Case($Name,[scriptblock]$Body){try{& $Body;$results.Add(@{name=$Name;status='PASS'})}catch{$results.Add(@{name=$Name;status='FAIL';error=$_.Exception.Message});throw}}
function Reject([scriptblock]$Body,$Reason){try{& $Body}catch{if($_.Exception.Message -like ('*'+$Reason+'*')){return};throw};throw ('NO_REJECTION:'+ $Reason)}
$config=@{prod='C:\fixture-production';runtime=$root}
$script:rows=@();$script:cims=@()
function Get-RuntimeInventory($Config){return $script:rows}
function Get-CimInstance {param($ClassName);return $script:cims}
function Get-Process {param($Id);return @{StartTime=[DateTime]::UtcNow}}
try{
 Case 'failed-core-rollback-is-not-retried' {Set-Content (Join-Path $root 'rollback-receipt.json') '{"status":"FAILED"}';Reject {Assert-RollbackNotPreviouslyFailed $root} 'PRIOR_ROLLBACK_FAILED_NO_AUTOMATIC_RETRY'}
 Case 'native-inventory-normalizes-slashes' {$script:cims=@(@{Name='node.exe';ProcessId=123;ExecutablePath='node.exe';CommandLine='node C:/fixture-production/scripts/fugle-futopt-websocket-collector.js'});$actual=@(& $inventoryBody $config);if($actual.Count -ne 1 -or !$actual[0].entry_verified -or $actual[0].role -ne 'future'){throw 'ENTRY_MAPPING_FAILED'}}
 Case 'native-inventory-detects-other-production-user' {$script:cims=@(@{Name='node.exe';ProcessId=123;ExecutablePath='node.exe';CommandLine='node C:\fixture-production\scripts\other.js'});$actual=@(& $inventoryBody $config);if($actual.Count -ne 1 -or $actual[0].role -ne 'other-production'){throw 'USER_NOT_DETECTED'}}
 Case 'native-inventory-missing-command-blocked' {$script:cims=@(@{Name='node.exe';ProcessId=123;ExecutablePath='node.exe';CommandLine=$null});Reject {& $inventoryBody $config} 'INVENTORY_INCOMPLETE'}
 Case 'native-entry-prefix-is-not-exact-entry' {$script:cims=@(@{Name='node.exe';ProcessId=123;ExecutablePath='node.exe';CommandLine='node C:\fixture-production\scripts\fugle-futopt-websocket-collector.js.old'});$actual=@(& $inventoryBody $config);if($actual[0].entry_verified){throw 'PREFIX_ACCEPTED'}}
 Case 'zero-production-users' {Assert-OnlyBoundFuture $config $null}
 Case 'other-production-user-blocked' {$script:rows=@(@{role='other-production';pid=1});Reject {Assert-OnlyBoundFuture $config $null} 'OCCUPANCY'}
 $expected=@{pid=123;creation_ticks=123456;exe='node.exe'}
 Case 'one-exact-future-only' {$script:rows=@(@{role='future';pid=123;creation_ticks=123456;exe='node.exe';entry_verified=$true});Assert-OnlyBoundFuture $config $expected}
 Case 'recycled-pid-blocked' {$script:rows[0].creation_ticks=654321;Reject {Assert-OnlyBoundFuture $config $expected} 'OCCUPANCY';$script:rows[0].creation_ticks=123456}
 Case 'wrong-exe-blocked' {$script:rows[0].exe='other.exe';Reject {Assert-OnlyBoundFuture $config $expected} 'OCCUPANCY';$script:rows[0].exe='node.exe'}
 Case 'duplicate-future-blocked' {$script:rows+= $script:rows[0].Clone();Reject {Assert-OnlyBoundFuture $config $expected} 'NOT_UNIQUE'}
 Case 'absent-expected-future-blocked' {$script:rows=@();Reject {Assert-OnlyBoundFuture $config $expected} 'NOT_UNIQUE'}
 Case 'quality-health-remains-separate' {
  $s=@{pid=123;collector_release='futopt-daytrade-candles-v8';updatedAt=[DateTimeOffset]::UtcNow.ToString('o');transportHealth=@{last_transport_at=[DateTimeOffset]::UtcNow.ToString('o')};ok=$false;formalReady=$false;websocketConnected=$true;websocketAuthenticated=$true;error='TXF_CATALOGUE_MISSING'}
  $p=Assert-FutoptWriterHandback @{pid=123;unique=$true;creation_verified=$true;entry_verified=$true;alive=$true} $s 'futopt-daytrade-candles-v8'
  if(!$p.transport_identity_pass -or $p.quality_gate_pass){throw 'QUALITY_INCORRECT'}
 }
}finally{
 @{status=if(@($results|Where-Object status -eq 'FAIL').Count){'FAIL'}else{'PASS'};results=@($results.ToArray());cases=$results.Count;scope='NEW_RUNTIME_PORT_GUARDS_INTERCEPTED_INVENTORY';formal_mutations=$false}|ConvertTo-Json -Depth 6|Set-Content (Join-Path $PSScriptRoot 'runtime-port-tests.json') -Encoding utf8
}
Write-Output ('PASS '+$results.Count)
