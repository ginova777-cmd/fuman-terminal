[CmdletBinding()]
param([switch]$WhatIf,[switch]$Preflight,[switch]$Apply,[string]$ApprovalFile,[int]$RequesterPid,[long]$RequesterCreationTicks)
$ErrorActionPreference='Stop'
if($Apply -and ($WhatIf -or $Preflight)){throw 'READONLY_APPLY_MODE_CONFLICT'}
if(!$Apply){& (Join-Path $PSScriptRoot 'Read-ProductionBinding.ps1');return}
. (Join-Path $PSScriptRoot 'ProductionMaintenanceBinding.ps1')
. (Join-Path $PSScriptRoot 'ProductionRuntimePorts.ps1')
. (Join-Path $PSScriptRoot 'CutoverSequence.ps1')
$config=Get-Content (Join-Path $PSScriptRoot 'release-config.json') -Raw|ConvertFrom-Json -AsHashtable
# This remains false in the delivered preparation package. Merge approval alone
# never authorizes a runtime stop, production checkout or schedule fence.
if(!$config.formal_apply_authorized){throw 'FORMAL_CUTOVER_GO_NOT_GRANTED'}
Assert-SealedOwnerPackage $config
Assert-InstalledOwnerTrust $config
if(!$ApprovalFile -or $RequesterPid -le 0 -or $RequesterCreationTicks -le 0){throw 'EXACT_APPROVAL_AND_REQUESTER_IDENTITY_REQUIRED'}
$approval=Get-Content -LiteralPath $ApprovalFile -Raw|ConvertFrom-Json -AsHashtable
Assert-OwnerApproval $config $approval
if(!$approval.graceful_stop_required){throw 'GRACEFUL_STOP_APPROVAL_REQUIRED'}
$admin=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
$bindingPath=Join-Path $PSScriptRoot 'formal-binding.json'
if((Get-FileHash -LiteralPath $bindingPath).Hash.ToLower() -ne $config.binding_sha256){throw 'FROZEN_BINDING_DRIFT'}
$binding=Get-Content -LiteralPath $bindingPath -Raw|ConvertFrom-Json -AsHashtable
$out=Join-Path $PSScriptRoot ('runs/'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'));New-Item -ItemType Directory $out|Out-Null
$owner=New-ProductionOwner $binding (Join-Path $out 'maintenance-state.json')
 $ctx=@{legacy=$null;future=$null;proof=$null;archive=$null;release=(Join-Path $out 'release');owner_gate=(Join-Path $out 'owner-gate.json');keep=$false;current_sha=$config.expected}
$ownerLock=Join-Path $config.runtime 'state/mother-cutover-maintenance-owner.lock'
$lock=[IO.File]::Open($ownerLock,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$identity=@{owner_pid=$PID;creation_ticks=[string](Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks;target=$config.target;token=$owner.token;maintenance_verified=$false;approval_not_before=$approval.not_before;approval_expires_at=$approval.expires_at}
try{
 $bytes=[Text.Encoding]::UTF8.GetBytes(($identity|ConvertTo-Json));$lock.Write($bytes,0,$bytes.Length);$lock.Flush($true)
 function WriteGate {Write-CutoverReceipt $ctx.owner_gate $identity}
 function ReleaseOperation($Action){
  $raw=& node (Join-Path $PSScriptRoot 'ReleaseOperation.cjs') $Action $ctx.release $ctx.owner_gate
  if($LASTEXITCODE -ne 0){throw ('RELEASE_OPERATION_FAILED:'+ $Action)}
  $r=$raw|ConvertFrom-Json
  if($r.status -notin @('CODE_DEPLOYMENT_VERIFIED_RUNTIME_PENDING','RESTORED')){throw ('RELEASE_OPERATION_BLOCKED:'+ $r.status)}
 }
 function AssertOutsideStockSession {
  $tw=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow,'Taipei Standard Time');$minute=$tw.Hour*60+$tw.Minute
  # First formal cutover supports no live stock handoff. It may not force-stop
  # stock processes or run a live-session rollback. Review a different window.
  if($minute -ge 360 -and $minute -lt 812){throw 'LIVE_STOCK_WINDOW_NOT_SUPPORTED_BY_THIS_CUTOVER'}
 }
 function CheckRequester {
  try{$p=Get-Process -Id $RequesterPid -ErrorAction Stop;return ($p.StartTime.ToUniversalTime().Ticks -ne $RequesterCreationTicks)}catch{return $true}
 }
 $ports=@{
  formal=$true
  receipt={param($r) Write-CutoverReceipt (Join-Path $out 'cutover-receipt.json') $r}
  requesterExited={CheckRequester}
  preflight={
   AssertOutsideStockSession;Assert-ProductionBinding $binding;Test-EvidenceOff $config
   Invoke-PairedVerifier $config $config.expected|Out-Null
   $all=@(Get-RuntimeInventory $config)
   if($all.Count -ne 1 -or $all[0].role -ne 'future' -or !$all[0].entry_verified){throw 'REQUIRE_UNIQUE_FUTURE_AND_IDLE_SHARED_RUNTIME'}
   $ctx.legacy=$all[0];$ctx.legacy.entry=Join-Path $config.prod 'scripts/fugle-futopt-websocket-collector.js'
   Assert-OnlyBoundFuture $config $ctx.legacy
  }
  fence={
   Enter-ProductionFence $owner $config $approval { Assert-OnlyBoundFuture $config $ctx.legacy }
   Assert-OnlyBoundFuture $config $ctx.legacy
   $identity.maintenance_verified=$true;WriteGate
  }
  archive={
   $fixed=@('cache/intraday/fugle-futopt-ws-quotes.json','cache/intraday/fugle-futopt-ws-candles.json','cache/intraday/fugle-futopt-tickers.json','state/fugle-futopt-websocket-status.json','state/fugle-daytrade-futopt-live-mirror.json','state/fugle-daytrade-futopt-collector-rotation.json','status/txf-candle-pipeline.json','status/txf-candle-recovery.json','status/futopt-catalogue-retry.json','data/stocks-slim.json')
   $paths=@($fixed|ForEach-Object {Join-Path $config.runtime $_}|Where-Object {Test-Path -LiteralPath $_})
   foreach($d in @('data/mother-pool/futures-1m','data/futures-catalogue')){$p=Join-Path $config.runtime $d;if(Test-Path -LiteralPath $p){$paths+=@(Get-ChildItem -LiteralPath $p -File -Recurse|ForEach-Object FullName)}}
   $paths=@($paths|Sort-Object -Unique)
   $ctx.archive=Join-Path $out 'legacy-archive';Save-LegacyBoundary $paths $ctx.archive|Out-Null
  }
  stopLegacy={
   Assert-OwnerApproval $config $approval;AssertOutsideStockSession;Assert-OnlyBoundFuture $config $ctx.legacy
   Invoke-BoundGracefulStop $config $ctx.legacy $ctx.owner_gate (Join-Path $out 'graceful-stop.json')|Out-Null
   Assert-OnlyBoundFuture $config $null
  }
  deploy={ReleaseOperation 'apply';Invoke-PairedVerifier $config $config.target|Out-Null;$ctx.current_sha=$config.target}
  startFuture={$ctx.future=Start-BoundFuture $config $out}
  verifyFuture={$ctx.proof=Wait-BoundFuture $config $ctx.future}
  handbackStock={
   AssertOutsideStockSession
   # Outside the live window only original scheduling is restored. No manual
   # fake natural start, quote or candle is produced for acceptance.
   Assert-OnlyBoundFuture $config $ctx.future
   Release-StockBinding $owner
   Write-CutoverReceipt (Join-Path $out 'stock-handback.json') @{status='ORIGINAL_TASK_RESTORED_OFF_SESSION';natural_start_verified=$false;sha=$ctx.current_sha}
  }
  handbackWriter={
   $ctx.proof=Wait-BoundFuture $config $ctx.future
   Restore-WriterBinding $owner $ctx.proof
  }
  restore={Restore-ProductionFence $owner}
  assertNoStockOrWriter={Assert-OnlyBoundFuture $config $ctx.future}
  refence={
   # Before handback the original fences remain held. Once handed back, do not
   # silently refence a potentially started task; require manual recovery.
   if($owner.stock_handed_back -or !$owner.db -or !$owner.writer){throw 'HANDBACK_STARTED_MANUAL_RECOVERY_REQUIRED'}
  }
  stopNewSafe={if(!$ctx.future){throw 'PARTIAL_START_IDENTITY_UNKNOWN_NO_CHECKOUT'};Invoke-BoundGracefulStop $config $ctx.future $ctx.owner_gate (Join-Path $out 'rollback-graceful-stop.json')|Out-Null}
  assertNoUsers={Assert-OnlyBoundFuture $config $null}
  rollback={
   Assert-RollbackNotPreviouslyFailed $ctx.release
   $head=(& git -C $config.prod rev-parse HEAD).Trim()
   if($head -eq $config.expected){Invoke-PairedVerifier $config $config.expected|Out-Null}
   elseif($head -eq $config.target){ReleaseOperation 'rollback'}else{throw 'ROLLBACK_HEAD_UNKNOWN'}
   $ctx.current_sha=$config.expected
  }
  restoreOldFuture={Invoke-PairedVerifier $config $config.expected|Out-Null;$ctx.future=Start-BoundFuture $config $out;$ctx.proof=Wait-BoundFuture $config $ctx.future}
  retain={$owner.manual_recovery_required=$true;$ctx.keep=$true;Write-OwnerState $owner 'MANUAL_RECOVERY_REQUIRED'}
 }
 $r=Invoke-CutoverSequence $ports
 if($r.status -eq 'MANUAL_RECOVERY_REQUIRED'){
  # No automatic unlock/exit: a live owner keeps the OS fences. Owner recovery
  # requires a separate explicit instruction; requester exit does not release it.
  while($true){Start-Sleep -Seconds 30;Write-OwnerState $owner 'MANUAL_RECOVERY_REQUIRED'}
 }
 $r|ConvertTo-Json -Depth 12
}finally{
 if(!$ctx.keep){$lock.Dispose();Remove-Item -LiteralPath $ownerLock -ErrorAction Stop}
}
