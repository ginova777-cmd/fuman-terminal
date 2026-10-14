[CmdletBinding()]
param([switch]$Apply,[string]$ApprovalFile,[int]$RequesterPid,[long]$RequesterCreationTicks)
$ErrorActionPreference='Stop'
if(!$Apply){& (Join-Path $PSScriptRoot 'Read-ProductionBinding.ps1');return}
. (Join-Path $PSScriptRoot 'ProductionMaintenanceBinding.ps1')
. (Join-Path $PSScriptRoot 'ProductionRuntimePorts.ps1')
. (Join-Path $PSScriptRoot 'StockOnlyRuntimePorts.ps1')
. (Join-Path $PSScriptRoot 'StockOnlyCutoverSequence.ps1')
$config=Get-Content (Join-Path $PSScriptRoot 'release-config.json') -Raw|ConvertFrom-Json -AsHashtable
if(!$config.formal_apply_authorized){throw 'FORMAL_CUTOVER_GO_NOT_GRANTED'}
Assert-SealedOwnerPackage $config;Assert-InstalledOwnerTrust $config
if(!$ApprovalFile -or $RequesterPid -le 0 -or $RequesterCreationTicks -le 0){throw 'EXACT_APPROVAL_AND_REQUESTER_IDENTITY_REQUIRED'}
$approval=Get-Content -LiteralPath $ApprovalFile -Raw|ConvertFrom-Json -AsHashtable
Assert-StockOnlyApproval $config $approval
if(!([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
$binding=Get-Content (Join-Path $PSScriptRoot 'formal-binding.json') -Raw|ConvertFrom-Json -AsHashtable
if($binding.tasks.Count -ne 2){throw 'STOCK_ONLY_TWO_TASK_BINDING_REQUIRED'}
$null=Resolve-HandbackTasks $binding
$out=Join-Path $PSScriptRoot ('runs/'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'));New-Item -ItemType Directory $out|Out-Null
$owner=New-ProductionOwner $binding (Join-Path $out 'maintenance-state.json')
$ctx=@{legacy=$null;release=(Join-Path $out 'release');owner_gate=(Join-Path $out 'owner-gate.json');keep=$false}
$ownerLock=Join-Path $config.runtime 'state/mother-cutover-maintenance-owner.lock'
$lock=[IO.File]::Open($ownerLock,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
$identity=@{owner_pid=$PID;creation_ticks=[string](Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks;target=$config.target;token=$owner.token;maintenance_verified=$false;approval_not_before=$approval.not_before;approval_expires_at=$approval.expires_at;preserved_future_file=(Join-Path $out 'preserved-future-identity.json')}
try {
 $bytes=[Text.Encoding]::UTF8.GetBytes(($identity|ConvertTo-Json));$lock.Write($bytes,0,$bytes.Length);$lock.Flush($true)
 function AssertOutsideStockSession {
  $tw=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow,'Taipei Standard Time');$minute=$tw.Hour*60+$tw.Minute
  if($minute -ge 360 -and $minute -lt 812){throw 'LIVE_STOCK_WINDOW_NOT_SUPPORTED_BY_THIS_CUTOVER'}
 }
 function CheckRequester {try{return ((Get-Process -Id $RequesterPid -ErrorAction Stop).StartTime.ToUniversalTime().Ticks -ne $RequesterCreationTicks)}catch{return $true}}
 function WriteGate {Write-CutoverReceipt $ctx.owner_gate $identity}
 function ReleaseOperation($Action) {
  $raw=& node (Join-Path $PSScriptRoot 'ReleaseOperation.cjs') $Action $ctx.release $ctx.owner_gate
  if($LASTEXITCODE -ne 0){throw ('RELEASE_OPERATION_FAILED:'+ $Action)}
  $r=$raw|ConvertFrom-Json
  if($r.status -notin @('CODE_DEPLOYMENT_VERIFIED_RUNTIME_PENDING','RESTORED')){throw ('RELEASE_OPERATION_BLOCKED:'+ $r.status)}
 }
 $ports=@{
  formal=$true;requesterExited={CheckRequester};receipt={param($r) Write-CutoverReceipt (Join-Path $out 'cutover-receipt.json') $r}
  preflight={
   AssertOutsideStockSession;Assert-StockOnlyApproval $config $approval;Assert-ProductionBinding $binding;Test-EvidenceOff $config
   Invoke-PairedVerifier $config $config.expected|Out-Null
   $all=@(Get-RuntimeInventory $config)
   if($all.Count -ne 1 -or $all[0].role -ne 'future' -or !$all[0].entry_verified){throw 'UNIQUE_PRESERVED_FUTURE_AND_IDLE_STOCK_REQUIRED'}
   $ctx.legacy=$all[0];$ctx.legacy.creation_ticks=[string]$ctx.legacy.creation_ticks
   Write-CutoverReceipt $identity.preserved_future_file $ctx.legacy
  }
  assertPreservedFuture={Assert-PreservedStockFuture $config $ctx.legacy $out}
  assertStockWriterIdle={Assert-OnlyBoundFuture $config $ctx.legacy}
  fence={Enter-ProductionFence $owner $config $approval {Assert-PreservedStockFuture $config $ctx.legacy $out};$identity.maintenance_verified=$true;WriteGate}
  archive={Assert-HeldFence $owner;Assert-PreservedStockFuture $config $ctx.legacy $out;Write-CutoverReceipt (Join-Path $out 'preservation-archive.json') @{identity=$ctx.legacy;manifest_sha256=$config.stock_preservation_sha256;future_mutation=$false}}
  deploy={Assert-StockOnlyApproval $config $approval;AssertOutsideStockSession;ReleaseOperation 'apply'}
  verifyDeployment={Invoke-PairedVerifier $config $config.target|Out-Null}
  handbackStock={Assert-StockOnlyApproval $config $approval;AssertOutsideStockSession;Assert-PreservedStockFuture $config $ctx.legacy $out;Release-StockBinding $owner}
  handbackWriter={Assert-StockOnlyApproval $config $approval;AssertOutsideStockSession;Restore-StockOnlyWriterBinding $owner {Assert-PreservedStockFuture $config $ctx.legacy $out}}
  restore={Restore-ProductionFence $owner}
  rollback={
   $receipt=Join-Path $ctx.release 'rollback-receipt.json'
   if((Test-Path $receipt) -and (Get-Content $receipt -Raw|ConvertFrom-Json).status -eq 'FAILED'){throw 'PREVIOUS_ROLLBACK_FAILED_NO_RETRY'}
   if(!(Test-Path (Join-Path $ctx.release 'authority-before.bin'))){Invoke-PairedVerifier $config $config.expected|Out-Null;foreach($f in $binding.files){if((Get-FileHash $f.path).Hash.ToLower() -ne $f.sha256){throw 'PREDEPLOY_FILE_DRIFT'}};foreach($t in $binding.tasks){Assert-HandbackDefinition $t.binding};return}
   ReleaseOperation 'rollback'
  }
  verifyRollback={Invoke-PairedVerifier $config $config.expected|Out-Null}
  retain={$ctx.keep=$true;$owner.manual_recovery_required=$true;Write-OwnerState $owner 'MANUAL_RECOVERY_REQUIRED_STOCK_ONLY'}
 }
 $r=Invoke-StockOnlyCutoverSequence $ports
 $r|ConvertTo-Json -Depth 12
 if($r.status -ne 'STOCK_CUTOVER_CONTROL_VERIFIED_NATURAL_PENDING'){exit 1}
}finally{
 # A retained marker fences subsequent runs. OS handles end with this owner;
 # restoring a retained state requires an independently reviewed stock-only recovery.
 $lock.Dispose();if(!$ctx.keep){Remove-Item -LiteralPath $ownerLock -ErrorAction Stop}
}
