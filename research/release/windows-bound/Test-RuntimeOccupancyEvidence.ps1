param([Parameter(Mandatory=$true)][string]$BaselineDirectory,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
function Load-Functions($Path,$Names){
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'PARSE_FAILED'}
 foreach($f in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){
  if($f.Name -in $Names){. ([scriptblock]::Create('function global:'+ $f.Name + $f.Extent.Text.Substring(('function '+$f.Name).Length)))}
 }
}
$base=Join-Path $BaselineDirectory 'ProductionRuntimePorts.ps1'
$candidate=Join-Path $PSScriptRoot 'ProductionRuntimePorts.ps1'
function global:Get-RuntimeInventory($Config){return $script:inventory}
$expected=@{role='future';pid=39736;creation_ticks=[long]'639272406870046923';exe='node.exe';entry_verified=$true}
$cases=@(@{name='normal';rows=@($expected.Clone());expected=$expected;code=$null},@{name='empty_allowed';rows=@();expected=$null;code=$null},@{name='missing_bound';rows=@();expected=$expected;code='BOUND_FUTURE_NOT_UNIQUE'})
foreach($field in @('role','pid','creation_ticks','exe','entry_verified')){
 $p=$expected.Clone();$p[$field]=switch($field){role{'writer'} pid{99} creation_ticks{[long]'639272406870046924'} exe{'other.exe'} entry_verified{$false}}
 $cases+=@{name='mismatch_'+$field;rows=@($p);expected=$expected;code='RUNTIME_OCCUPANCY_NOT_EXCLUSIVELY_BOUND';field=$field}
}
$extra=$expected.Clone();$extra.pid=99;$extra.role='stock'
$cases+=@{name='extra_process';rows=@($expected.Clone(),$extra);expected=$expected;code='RUNTIME_OCCUPANCY_NOT_EXCLUSIVELY_BOUND'}
$cases+=@{name='unexpected_occupant';rows=@($expected.Clone());expected=$null;code='RUNTIME_OCCUPANCY_NOT_EXCLUSIVELY_BOUND'}
$cases+=@{name='duplicate_bound';rows=@($expected.Clone(),$expected.Clone());expected=$expected;code='BOUND_FUTURE_NOT_UNIQUE'}
$results=@()
foreach($case in $cases){
 $script:inventory=$case.rows;$before=$case.rows|ConvertTo-Json -Depth 12 -Compress
 $codes=@();$evidence=$null
 foreach($version in @('base','candidate')){
  Load-Functions ($(if($version -eq 'base'){$base}else{$candidate})) @('Assert-OnlyBoundFuture','Throw-RuntimeOccupancyFailure')
  $code=$null
  try{Assert-OnlyBoundFuture @{} $case.expected}catch{$code=$_.Exception.Message;if($version -eq 'candidate'){$evidence=$_.Exception.Data['RuntimeOccupancyEvidence']}}
  $codes+=,$code
 }
 if($codes[0] -ne $case.code -or $codes[1] -ne $case.code){throw ('DECISION_CHANGED:'+$case.name)}
 if($case.code){
  if(!$evidence -or $evidence.inventory.Count -ne $case.rows.Count){throw 'MISSING_EVIDENCE'}
  if($case.ContainsKey('field') -and $evidence.differences[0].field -ne $case.field){throw 'WRONG_FIELD'}
  if($case.name -eq 'extra_process' -and $evidence.first_mismatch_pid -ne 99){throw 'WRONG_PID'}
 }
 if(($case.rows|ConvertTo-Json -Depth 12 -Compress) -cne $before){throw 'INPUT_MUTATED'}
 $results+=@{case=$case.name;pass=$true;code=$codes[1];evidence=$evidence}
}
# Execute the actual sequence with inert ports; persist and independently reread JSON.
. (Join-Path $PSScriptRoot 'CutoverSequence.ps1')
$script:inventory=@($expected.Clone(),$extra)
$script:restored=0;$script:forbidden=0
$out=Join-Path $OutputDirectory 'composition-receipt.json'
$ports=@{formal=$false;preflight={};requesterExited={$false};fence={Assert-OnlyBoundFuture @{} $expected};restore={$script:restored++};receipt={param($r) $r|ConvertTo-Json -Depth 30|Set-Content -LiteralPath $out};retain={};stopLegacy={$script:forbidden++};deploy={$script:forbidden++}}
$r=Invoke-CutoverSequence $ports
$read=Get-Content -LiteralPath $out -Raw|ConvertFrom-Json
if($read.status -ne 'BLOCKED' -or $read.runtime_occupancy_evidence.first_mismatch_pid -ne 99 -or $script:restored -ne 1 -or $script:forbidden -ne 0 -or $read.runtime_occupancy_evidence.inventory[0].creation_ticks -cne '639272406870046923'){throw 'COMPOSITION_FAILED'}
$results+=@{case='sequence_restore_and_persist';pass=$true}
@{status='OFFLINE_PASS_REVIEW_REQUIRED';passed=$results.Count;failed=0;formal_execution=$false;tests=$results}|ConvertTo-Json -Depth 30|Set-Content (Join-Path $OutputDirectory 'test-receipt.json')
@{status='OFFLINE_PASS_REVIEW_REQUIRED';passed=$results.Count;failed=0}|ConvertTo-Json
