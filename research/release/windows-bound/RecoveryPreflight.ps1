Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Assert-RecoveryPackageContext($Config,$Bundle){
 Assert-SealedOwnerPackage $Config
 Assert-InstalledOwnerTrust $Config
 $admin=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 if(!$admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
 foreach($k in @('target','expected','prod','runtime','binding_sha256','package_sha256')){
  if(!$Config[$k] -or $Config[$k] -cne $Bundle.context.config[$k]){throw ('RECOVERY_CONFIG_DRIFT:'+ $k)}
 }
 Assert-RecoveryTaskSnapshot $Bundle.context.binding
}

function Assert-RecoveryOwnerIdentity($Actual,$Expected){
 foreach($k in @('owner_pid','creation_ticks','token','target')){
  if($null -eq $Actual[$k] -or [string]$Actual[$k] -cne [string]$Expected[$k]){throw ('RECOVERY_LOCK_IDENTITY_MISMATCH:'+ $k)}
 }
}

function Assert-RecoveryOriginalTasks($Binding){
 Assert-RecoveryTaskSnapshot $Binding
 foreach($t in $Binding.tasks){
  $a=Get-TaskBinding $t.binding.name
  if($a.path -cne $t.binding.path -or $a.definition_sha256 -cne $t.binding.definition_sha256){throw 'RECOVERY_TASK_DEFINITION_DRIFT'}
  if($a.state -eq 'Running'){throw 'RECOVERY_TASK_RUNNING'}
  if($a.enabled -notin @('true','false')){throw 'RECOVERY_TASK_STATE_UNKNOWN'}
  if($t.binding.enabled -eq 'false' -and $a.enabled -ne 'false'){throw 'RECOVERY_UNEXPECTED_ENABLED_TASK'}
 }
}

function Assert-RecoveryTerminalAck($Ack,$Request,$Original){
 $inputJson=@{ack=$Ack;request=$Request;identity=$Original}|ConvertTo-Json -Depth 30 -Compress
 $output=$inputJson | & node "$PSScriptRoot/stop-ack-contract.cjs" 2>&1
 if($LASTEXITCODE -ne 0){throw ('RECOVERY_TERMINAL_ACK:'+($output -join ' '))}
 $proof=($output -join '')|ConvertFrom-Json -AsHashtable
 if($proof.kind -notin @('ZERO_ACCEPTED_IN_BOUND_EPOCH','SAVED_ARTIFACTS_REQUIRE_READBACK')){throw 'ACK_CONTRACT_RESULT'}
}
function Assert-RecoveryNoReparse($Root,$Path){
 $rootFull=[IO.Path]::GetFullPath($Root).TrimEnd('\')
 $p=[IO.Path]::GetFullPath($Path)
 if(!$p.StartsWith($rootFull+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'RECOVERY_PATH_OUTSIDE_ROOT'}
 $item=Get-Item -LiteralPath $p -Force
 while($item -and $item.FullName.Length -ge $rootFull.Length){
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'RECOVERY_REPARSE_POINT'}
  $item=if($item -is [IO.DirectoryInfo]){$item.Parent}else{$item.Directory}
 }
}

function Read-RecoveryTerminalProof($Config,$Original){
 if(!$Original){throw 'RECOVERY_ORIGINAL_STOP_IDENTITY_UNAVAILABLE'}
 $control=$Original.control_root
 Assert-RecoveryNoReparse $Config.runtime $control
 $requestPath=Join-Path $control 'request.json'
 Assert-RecoveryNoReparse $Config.runtime $requestPath
 $q=Get-Content -LiteralPath $requestPath -Raw|ConvertFrom-Json -AsHashtable -DateKind String
 if($q.request_id -notmatch '^[a-fA-F0-9-]{36}$'){throw 'RECOVERY_TERMINAL_REQUEST'}
 $ackPath=Join-Path $control ('receipts/'+$q.request_id+'.json')
 Assert-RecoveryNoReparse $Config.runtime $ackPath
 $ack=Get-Content -LiteralPath $ackPath -Raw|ConvertFrom-Json -AsHashtable -DateKind String
 Assert-RecoveryTerminalAck $ack $q $Original
 if(Get-Process -Id $Original.pid -ErrorAction SilentlyContinue){throw 'RECOVERY_ORIGINAL_PID_NOT_ABSENT'}
 foreach($f in (@($ack.proof.files)+@($ack.proof.caches))){
  Assert-RecoveryNoReparse $Config.runtime $f.file
  if($f.sha256 -notmatch '^[a-f0-9]{64}$' -or (Get-RecoveryHash $f.file) -cne $f.sha256 -or (Get-Item -LiteralPath $f.file).Length -ne $f.bytes){throw 'RECOVERY_TERMINAL_BYTES_OR_HASH'}
 }
 return @{ack=$ack;ack_sha256=(Get-RecoveryHash $ackPath);request_sha256=(Get-RecoveryHash $requestPath)}
}

