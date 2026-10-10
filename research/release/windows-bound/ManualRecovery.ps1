Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Get-RecoveryHash($Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Assert-RecoveryTaskSnapshot($Binding){
 $roles=Resolve-HandbackTasks $Binding
 if(@($Binding.tasks).Count -ne 12){throw 'RECOVERY_REQUIRES_EXACT_12_TASKS'}
 foreach($t in $Binding.tasks){
  $expected=if($t.binding.name -in @($roles.stock.name,$roles.writer.name)){'true'}else{'false'}
  if($t.binding.enabled -cne $expected){throw 'RECOVERY_REQUIRES_ORIGINAL_2_ENABLED_10_DISABLED'}
 }
}
function Initialize-RecoveryContext($Root,$Config,$Binding,$Identity,$Approval){
 Assert-RecoveryTaskSnapshot $Binding
 $d=Join-Path $Root 'recovery';New-Item -ItemType Directory $d -ErrorAction Stop|Out-Null
 New-Item -ItemType Directory "$d/requests","$d/attempts" -ErrorAction Stop|Out-Null
 $c=@{contract='mother_owner_recovery_v1';config=$Config;binding=$Binding;owner=$Identity;original_approval=$Approval;created_at=[DateTimeOffset]::UtcNow.ToString('o')}
 Write-CutoverReceipt "$d/context.json" $c
 return $d
}
function Save-RecoveryCheckpoint($Directory,$Context,$Stage,$StopState){
 # Each stage gets an immutable file; current.json only points to its hash.
 $id=[guid]::NewGuid().ToString('N')
 $s=@{stage=$Stage;at=[DateTimeOffset]::UtcNow.ToString('o');legacy=$Context.legacy;future=$Context.future;current_sha=$Context.current_sha;stop_state=$StopState;release=$Context.release;stop_identity=$Context['stop_identity'];legacy_stop_receipt_hash=$Context['legacy_stop_receipt_hash']}
 $p=Join-Path $Directory ('checkpoint-'+$id+'.json');Write-CutoverReceipt $p $s
 Write-CutoverReceipt "$Directory/current.json" @{file=[IO.Path]::GetFileName($p);sha256=(Get-RecoveryHash $p)}
}
function Read-RecoveryBundle($Directory){
 $contextFile=Join-Path $Directory 'context.json';$context=Get-Content $contextFile -Raw|ConvertFrom-Json -AsHashtable -DateKind String
 if($context.contract -ne 'mother_owner_recovery_v1'){throw 'RECOVERY_CONTEXT_CONTRACT'}
 Assert-RecoveryTaskSnapshot $context.binding
 $pointer=Get-Content "$Directory/current.json" -Raw|ConvertFrom-Json -AsHashtable
 if($pointer.file -notmatch '^checkpoint-[a-f0-9]{32}\.json$'){throw 'RECOVERY_CHECKPOINT_PATH'}
 $p=Join-Path $Directory $pointer.file
 if((Get-RecoveryHash $p) -cne $pointer.sha256){throw 'RECOVERY_CHECKPOINT_HASH'}
 $state=Get-Content $p -Raw|ConvertFrom-Json -AsHashtable -DateKind String
 $failure=Join-Path (Split-Path $Directory) 'cutover-receipt.json'
 $last=Join-Path $Directory 'last-result.json'
 @{context=$context;state=$state;context_sha256=(Get-RecoveryHash $contextFile);checkpoint_sha256=$pointer.sha256;failure_sha256=$(if(Test-Path $failure){Get-RecoveryHash $failure}else{$null});prior_attempt_sha256=$(if(Test-Path $last){Get-RecoveryHash $last}else{$null})}
}
function Assert-RecoveryApproval($Request,$Bundle,$Mode){
 $c=$Bundle.context
 if($Request.action -cne 'MANUAL_RECOVERY_GO' -or $Request.mode -cne $Mode -or $Request.request_id -notmatch '^[a-f0-9]{32}$' -or $Request.owner_approved -isnot [bool] -or !$Request.owner_approved){throw 'EXPLICIT_RECOVERY_GO_REQUIRED'}
 foreach($k in @('context_sha256','checkpoint_sha256','failure_sha256','prior_attempt_sha256')){if($Request[$k] -cne $Bundle[$k]){throw ('RECOVERY_APPROVAL_DRIFT:'+ $k)}}
 if($Request.owner_pid -ne $c.owner.owner_pid -or [string]$Request.owner_creation_ticks -cne [string]$c.owner.creation_ticks -or $Request.owner_token -cne $c.owner.token -or $Request.target -cne $c.config.target -or $Request.expected -cne $c.config.expected){throw 'RECOVERY_OWNER_IDENTITY_MISMATCH'}
 $now=[DateTimeOffset]::UtcNow
 if($now -lt [DateTimeOffset]::Parse($Request.not_before) -or $now -ge [DateTimeOffset]::Parse($Request.expires_at)){throw 'RECOVERY_APPROVAL_EXPIRED'}
 if(([DateTimeOffset]::Parse($Request.expires_at)-[DateTimeOffset]::Parse($Request.not_before)).TotalMinutes -gt 30){throw 'RECOVERY_WINDOW_TOO_LONG'}
}
function Invoke-ControlledRecovery($Directory,$Request,$Owner,$Ports,$Mode){
 $bundle=Read-RecoveryBundle $Directory
 Assert-RecoveryApproval $Request $bundle $Mode
 # Authorization, identity and thread checks precede every lock/task mutation.
 & $Ports.authorize $bundle $Request $Mode
 Assert-FenceOwnerIdentity $Owner
 $attempt=Join-Path "$Directory/attempts" $Request.request_id
 if(Test-Path $attempt){throw 'RECOVERY_REQUEST_ALREADY_CONSUMED'}
 $gate=[IO.File]::Open("$Directory/operation.lock",'CreateNew','ReadWrite','None')
 $result=@{contract='mother_owner_recovery_result_v1';status='MANUAL_RECOVERY_BLOCKED';request_id=$Request.request_id;mode=$Mode;started_at=[DateTimeOffset]::UtcNow.ToString('o');stages=@();error=$null}
 try{
  New-Item -ItemType Directory $attempt -ErrorAction Stop|Out-Null
  Write-CutoverReceipt "$attempt/approval.json" $Request
  Write-CutoverReceipt "$attempt/input.json" $bundle
  # Freeze and revalidate after exclusive reservation. A request prepared before
  # another recovery attempt must not consume the changed recovery state.
  $Request=Get-Content "$attempt/approval.json" -Raw|ConvertFrom-Json -AsHashtable -DateKind String
  $bundle=Read-RecoveryBundle $Directory
  Assert-RecoveryApproval $Request $bundle $Mode
  & $Ports.authorize $bundle $Request $Mode
  foreach($stage in @('precheck','fence','runtime','restore','verify')){
   & $Ports.$stage $bundle $Request $Owner
   $result.stages+=@{name=$stage;at=[DateTimeOffset]::UtcNow.ToString('o')}
   Write-CutoverReceipt "$attempt/progress.json" $result
  }
  $result.status='MANUAL_RECOVERY_VERIFIED'
 }catch{$result.error=$_.Exception.Message;$Owner.manual_recovery_required=$true}
 finally{
  $result.finished_at=[DateTimeOffset]::UtcNow.ToString('o')
  try{Write-CutoverReceipt "$attempt/result.json" $result;Write-CutoverReceipt "$Directory/last-result.json" $result}
  finally{$gate.Dispose()}
  # Only our own successful journal completion permits releasing the operation marker.
  Remove-Item -LiteralPath "$Directory/operation.lock" -ErrorAction Stop
 }
 return $result
}
function Wait-ControlledOwnerRecovery($Directory,$Owner,$Ports,$Mode='LIVE'){
 Assert-FenceOwnerIdentity $Owner
 while($true){
  foreach($file in @(Get-ChildItem "$Directory/requests" -File -Filter '*.json'|Sort-Object Name)){
   if($file.BaseName -notmatch '^[a-f0-9]{32}$' -or (Test-Path "$Directory/attempts/$($file.BaseName)")){continue}
   $rejected=Join-Path $Directory ($file.BaseName+'.rejected.json');if(Test-Path $rejected){continue}
   try{
    $q=Get-Content $file.FullName -Raw|ConvertFrom-Json -AsHashtable -DateKind String
    if($q.request_id -cne $file.BaseName){throw 'REQUEST_FILE_ID_MISMATCH'}
    $r=Invoke-ControlledRecovery $Directory $q $Owner $Ports $Mode
    if($r.status -eq 'MANUAL_RECOVERY_VERIFIED'){return $r}
   }catch{Write-CutoverReceipt $rejected @{status='RECOVERY_REQUEST_REJECTED';error=$_.Exception.Message;at=[DateTimeOffset]::UtcNow.ToString('o')}}
  }
  # Original thread retains its remaining handles; no external mutex release.
  Start-Sleep -Seconds 2
 }
}
