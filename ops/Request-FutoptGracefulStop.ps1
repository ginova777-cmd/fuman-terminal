[CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='High')]
param([string]$RuntimeDir='C:\fuman-runtime',[switch]$Request,[ValidateRange(1,120)][int]$WaitSeconds=45)
$ErrorActionPreference='Stop'
$runtime=[IO.Path]::GetFullPath($RuntimeDir)
$owner=Get-Content -LiteralPath (Join-Path $runtime 'state\futopt-shutdown\owner.json') -Raw|ConvertFrom-Json -DateKind String
if($owner.contract -ne 'futopt-stop-control-v1' -or $owner.epoch -notmatch '^[0-9a-f-]{36}$'){throw 'STOP_OWNER_INVALID'}
$control=[IO.Path]::GetFullPath((Join-Path $runtime ('state\futopt-shutdown\'+$owner.epoch)))
if($control -ne [IO.Path]::GetFullPath($owner.control_root)){throw 'STOP_CONTROL_PATH_MISMATCH'}
$identity=Get-Content -LiteralPath (Join-Path $control 'identity.json') -Raw|ConvertFrom-Json -DateKind String
foreach($field in @('pid','creation_time','epoch','entry','executable')){if($identity.$field -ne $owner.$field){throw 'STOP_OWNER_IDENTITY_MISMATCH'}}
$target=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$owner.pid)
if(!$target -or !$target.CommandLine -or !$target.ExecutablePath){throw 'STOP_PROCESS_IDENTITY_UNREADABLE'}
if($target.ExecutablePath -ne $owner.executable -or $target.CommandLine -notmatch [regex]::Escape($owner.entry) -or [IO.Path]::GetFileName($owner.entry) -ne 'fugle-futopt-websocket-collector.js'){throw 'STOP_ENTRYPOINT_MISMATCH'}
$birth=[DateTimeOffset]::new((Get-Process -Id $owner.pid -ErrorAction Stop).StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
if($birth -ne ([DateTimeOffset]::Parse($owner.creation_time)).ToUnixTimeMilliseconds()){throw 'STOP_PROCESS_CREATION_MISMATCH'}
if(!$Request -or !$PSCmdlet.ShouldProcess(('PID '+$owner.pid+' epoch '+$owner.epoch),'Request quiesce, flush, verify and exit')){
 @{status='STOP_PREFLIGHT_ONLY';pid=$owner.pid;creation_time=$owner.creation_time;epoch=$owner.epoch}|ConvertTo-Json;return
}
$id=[guid]::NewGuid().ToString();$req=@{request_id=$id;pid=[int]$owner.pid;creation_time=$owner.creation_time;epoch=$owner.epoch;requested_at=[DateTimeOffset]::UtcNow.ToString('o')}
$file=Join-Path $control 'request.json';$tmp=$file+'.tmp-'+$id
$bytes=[Text.Encoding]::UTF8.GetBytes(($req|ConvertTo-Json));$stream=[IO.File]::Open($tmp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
[IO.File]::Move($tmp,$file,$true)
$receipt=Join-Path $control ('receipts\'+$id+'.json');$watch=[Diagnostics.Stopwatch]::StartNew();$r=$null
while($watch.Elapsed.TotalSeconds -lt $WaitSeconds){
 if(Test-Path -LiteralPath $receipt){$r=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json -DateKind String;if($r.status -eq 'SAFE_STOP_FAILED'){throw ('STOP_SAVE_FAILED:'+ $r.error +'; receipt='+$receipt)};if($r.status -eq 'SAFE_STOP_SAVED'){break}}
 Start-Sleep -Milliseconds 250
}
if(!$r -or $r.status -ne 'SAFE_STOP_SAVED' -or !$r.safe_to_stop -or $r.request_id -ne $id -or $r.pid -ne $owner.pid -or $r.epoch -ne $owner.epoch -or $r.creation_time -ne $owner.creation_time -or $r.pending.dirty_groups -ne 0 -or $r.pending.pending_records -ne 0){throw ('STOP_NOT_VERIFIED; receipt='+$receipt)}
foreach($artifact in @($r.proof.files)+@($r.proof.caches)){
 $p=[IO.Path]::GetFullPath($artifact.file)
 if(!$p.StartsWith($runtime.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'STOP_PROOF_PATH_OUTSIDE_RUNTIME'}
 if((Get-Item -LiteralPath $p).Length -ne $artifact.bytes -or (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() -ne $artifact.sha256){throw 'STOP_PROOF_HASH_MISMATCH'}
}
while(Get-Process -Id $owner.pid -ErrorAction SilentlyContinue){if($watch.Elapsed.TotalSeconds -ge $WaitSeconds){throw 'STOP_RECEIPT_EXISTS_BUT_PROCESS_PRESENT'};Start-Sleep -Milliseconds 100}
@{status='STOP_VERIFIED';request_id=$id;pid=$owner.pid;epoch=$owner.epoch;receipt=$receipt;quality_gate_pass=$false}|ConvertTo-Json
