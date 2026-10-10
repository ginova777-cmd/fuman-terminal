Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Publish-RecoveryRequest($Directory,$Request){
 $dest=Join-Path "$Directory/requests" ($Request.request_id+'.json')
 $temp=$dest+'.tmp-'+[guid]::NewGuid().ToString('N')
 $f=[IO.File]::Open($temp,'CreateNew','Write','None')
 try{$bytes=[Text.Encoding]::UTF8.GetBytes(($Request|ConvertTo-Json -Depth 40));$f.Write($bytes);$f.Flush($true)}finally{$f.Dispose()}
 [IO.File]::Move($temp,$dest,$false)
}
function Read-RecoveryLockStream($Stream){
 if($Stream.Length -gt 65536){throw 'RECOVERY_OWNER_LOCK_SIZE'}
 $Stream.Position=0;$bytes=[byte[]]::new($Stream.Length);$Stream.ReadExactly($bytes)
 return @{bytes=$bytes;identity=([Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json -AsHashtable -DateKind String)}
}
function Close-RecoveryReservation($Stream,$Path,$Identity,$Archive){
 $actual=Read-RecoveryLockStream $Stream
 Assert-RecoveryOwnerIdentity $actual.identity $Identity
 $Stream.Dispose()
 # The protected path cannot be created anew until the exact known marker moves.
 # Preserve the marker; no deletion or replacement of an unknown file.
 $read=Get-Content -LiteralPath $Path -Raw|ConvertFrom-Json -AsHashtable -DateKind String
 Assert-RecoveryOwnerIdentity $read $Identity
 [IO.File]::Move($Path,$Archive,$false)
 $check=Get-Content $Archive -Raw|ConvertFrom-Json -AsHashtable -DateKind String
 Assert-RecoveryOwnerIdentity $check $Identity
}
function Invoke-DeadRecoveryHost($Config,$Directory,$Request){
 $bundle=Read-RecoveryBundle $Directory
 Assert-RecoveryApproval $Request $bundle 'DEAD'
 Assert-RecoveryPackageContext $Config $bundle
 $saved=$bundle.context.owner
 if(Get-Process -Id $saved.owner_pid -ErrorAction SilentlyContinue){throw 'RECOVERY_ORIGINAL_OWNER_NOT_ABSENT'}
 $ownerPath=Join-Path $Config.runtime 'state/mother-cutover-maintenance-owner.lock'
 Assert-RecoveryNoReparse $Config.runtime $ownerPath
 $reservation=[IO.File]::Open($ownerPath,'Open','ReadWrite','Read')
 $adopted=$false;$done=$false
 try{
  $original=Read-RecoveryLockStream $reservation
  Assert-RecoveryOwnerIdentity $original.identity $saved
  # A second crashed successor is not silently adopted as the original owner.
  if($original.identity.Contains('recovery_parent')){throw 'RECOVERY_SUCCESSOR_DEATH_REQUIRES_REVIEW'}
  $owner=New-ProductionOwner $bundle.context.binding "$Directory/successor-$($Request.request_id).json"
  $archive="$Directory/original-owner-$($Request.request_id).bin"
  $f=[IO.File]::Open($archive,'CreateNew','Write','None')
  try{$f.Write($original.bytes);$f.Flush($true)}finally{$f.Dispose()}
  $identity=@{owner_pid=$PID;creation_ticks=[string]$owner.owner_creation_ticks;target=$Config.target;token=$owner.token;maintenance_verified=$false;recovery_parent=$saved;approval_not_before=$Request.not_before;approval_expires_at=$Request.expires_at}
  Write-CutoverReceipt "$Directory/successor-intent-$($Request.request_id).json" @{original_sha256=(Get-RecoveryHash $archive);successor=$identity;request=$Request}
  $bytes=[Text.Encoding]::UTF8.GetBytes(($identity|ConvertTo-Json -Depth 12));$reservation.Position=0;$reservation.Write($bytes);$reservation.SetLength($bytes.Length);$reservation.Flush($true)
  $adopted=$true
  $ports=New-RecoveryRuntimePorts $Config $Directory $identity $ownerPath
  Publish-RecoveryRequest $Directory $Request
  # All failed attempts stay on this same lock-owning thread. No automatic retry:
  # each next attempt requires a new ID and binds the previous result hash.
  $result=Wait-ControlledOwnerRecovery $Directory $owner $ports 'DEAD'
  if($result.status -ne 'MANUAL_RECOVERY_VERIFIED'){throw 'RECOVERY_UNVERIFIED'}
  Close-RecoveryReservation $reservation $ownerPath $identity "$Directory/completed-owner-$($Request.request_id).json"
  $done=$true
  Write-CutoverReceipt "$Directory/dead-host-complete.json" @{status='DEAD_OWNER_RECOVERY_HANDBACK_VERIFIED';result=$result;owner_lock_absent=(!(Test-Path $ownerPath));stock_released=(!$owner.stock);writer_released=(!$owner.writer);db_released=(!$owner.db)}
  return $result
 }finally{
  if(!$adopted -or $done){$reservation.Dispose()}
  # Unexpected host error is left durably unresolved; never restore tasks here.
 }
}
