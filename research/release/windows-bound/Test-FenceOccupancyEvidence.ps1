param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Import-IsolatedFunction($File,$Names){
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $File),[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'PARSE_ERROR'}
 foreach($f in $ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){
  if($f.Name -in $Names){. ([scriptblock]::Create('function global:'+$f.Name+$f.Extent.Text.Substring(('function '+$f.Name).Length)))}
 }
}
Import-IsolatedFunction 'ProductionMaintenanceBinding.ps1' @('Enter-ProductionFence')
Import-IsolatedFunction 'ProductionRuntimePorts.ps1' @('Assert-OnlyBoundFuture','Throw-RuntimeOccupancyFailure')
. (Join-Path $PSScriptRoot 'CutoverSequence.ps1')
function Assert-FenceOwnerIdentity {}
function Assert-OwnerApproval {}
function Assert-ProductionBinding {}
function Assert-HeldFence {}
function Write-OwnerState($Owner,$Stage){$script:states.Add($Stage)}
function Enter-BoundMutexes {return 'ISOLATED_NO_MUTEX'}
function Get-RuntimeInventory {return @(@{pid=99;role='writer';creation_ticks=[long]'639272406870046923';exe='node.exe';entry_verified=$false})}
function Restore-ProductionFence($Owner){
 $script:restoreCalls++
 if($Owner.db){$Owner.db.Dispose();$Owner.db=$null}
 if($script:restoreFails){throw 'ISOLATED_RESTORE_FAILURE'}
}
$lab=Join-Path ([IO.Path]::GetTempPath()) ('fence-evidence-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $lab
$results=@()
foreach($restoreFails in @($false,$true)){
 foreach($occupancy in @($true,$false)){
  $script:restoreFails=$restoreFails;$script:restoreCalls=0;$script:checks=0;$script:forbidden=0;$script:retained=0
  $script:states=[Collections.Generic.List[string]]::new()
  $owner=@{db=$null;stock=$null;writer=$null;manual_recovery_required=$false;binding=@{locks=@{database_round=(Join-Path $lab ([guid]::NewGuid().ToString('N')+'.lock'));stock='fixture';writer='fixture'};tasks=@()}}
  $expected=@{pid=1;role='future';creation_ticks=[long]'639272406870046922';exe='node.exe';entry_verified=$true}
  $case='restore_'+$restoreFails+'_occupancy_'+$occupancy
  $path=Join-Path $OutputDirectory ($case+'.json')
  $ports=@{formal=$false;preflight={};requesterExited={$false};fence={Enter-ProductionFence $owner @{} @{} {
   $script:checks++;if($script:checks -eq 2){if($occupancy){Assert-OnlyBoundFuture @{} $expected}else{throw 'UNRELATED_FAILURE'}}
  }};restore={Restore-ProductionFence $owner};retain={$script:retained++};stopLegacy={$script:forbidden++};deploy={$script:forbidden++};receipt={param($r)$r|ConvertTo-Json -Depth 30|Set-Content -LiteralPath $path}}
  try{$result=Invoke-CutoverSequence $ports}finally{if($owner.db){$owner.db.Dispose()}}
  $read=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json -AsHashtable
  $original=if($occupancy){'RUNTIME_OCCUPANCY_NOT_EXCLUSIVELY_BOUND'}else{'UNRELATED_FAILURE'}
  $errorExpected=if($restoreFails){'FENCE_FAILED_AND_RESTORE_FAILED:'+$original+';ISOLATED_RESTORE_FAILURE'}else{$original}
  if($read.error -cne $errorExpected -or $script:forbidden -ne 0 -or $script:restoreCalls -ne 2){throw ('CONTROL_FLOW_FAILED:'+$case)}
  if($occupancy){
   if($read.runtime_occupancy_evidence.first_mismatch_pid -ne 99 -or $read.runtime_occupancy_evidence.inventory[0].creation_ticks -cne '639272406870046923'){throw 'EVIDENCE_LOST'}
  }elseif($read.ContainsKey('runtime_occupancy_evidence')){throw 'FABRICATED_EVIDENCE'}
  if($restoreFails){if($read.status -ne 'MANUAL_RECOVERY_REQUIRED' -or !$owner.manual_recovery_required -or $script:retained -ne 1){throw 'RETAIN_FAILED'}}
  elseif($read.status -ne 'BLOCKED' -or $owner.manual_recovery_required -or $script:retained -ne 0){throw 'RESTORE_FAILED'}
  $results+=@{case=$case;pass=$true;restore_calls=$script:restoreCalls;status=$read.status}
 }
}
@{status='FENCE_EXCEPTION_TRANSPORT_OFFLINE_PASS';passed=$results.Count;failed=0;formal_execution=$false;tests=$results}|ConvertTo-Json -Depth 10|Set-Content (Join-Path $OutputDirectory 'fence-test-receipt.json')
Write-Output ('PASS '+$results.Count)
