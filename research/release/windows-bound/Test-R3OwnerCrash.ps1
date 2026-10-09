param([string]$OutputDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'R3OwnerRecoveryGuard.ps1')
. (Join-Path $PSScriptRoot 'WindowsScheduleBinding.ps1')
$root=[IO.Path]::GetFullPath($OutputDirectory)
if($root -notlike '*\outputs\r3-integrated-*'){throw 'ISOLATED_ONLY'}
New-Item -ItemType Directory -Force -Path $root|Out-Null
$mutex='Global\Codex-MP-R3-Crash-'+[guid]::NewGuid().ToString('N')
$entry=Join-Path $root 'crash-owner.ps1'
@'
param($Root,$Mutex)
$m=[Threading.Mutex]::new($false,$Mutex);if(!$m.WaitOne(0)){exit 4}
@{owner_pid=$PID;owner_creation_date=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o');token=[guid]::NewGuid().ToString();stage='FENCED'}|ConvertTo-Json|Set-Content (Join-Path $Root 'owner.json')
$end=[DateTime]::UtcNow.AddSeconds(20)
while(!(Test-Path (Join-Path $Root 'crash-now'))){if([DateTime]::UtcNow -gt $end){exit 5};Start-Sleep -Milliseconds 100}
# Intentional own-process abnormal exit, not termination of another process.
[Environment]::Exit(9)
'@|Set-Content $entry
$p=Start-Process -FilePath (Get-Command pwsh).Source -ArgumentList @('-NoProfile','-File',('"'+$entry+'"'),'-Root',('"'+$root+'"'),'-Mutex',$mutex) -WindowStyle Hidden -PassThru
$file=Join-Path $root 'owner.json';$end=[DateTime]::UtcNow.AddSeconds(15)
while(!(Test-Path $file)){if([DateTime]::UtcNow -gt $end){throw 'OWNER_START_TIMEOUT'};Start-Sleep -Milliseconds 100}
$r=Get-Content $file -Raw|ConvertFrom-Json -DateKind String
if($r.owner_pid -ne $p.Id -or [DateTime]::Parse($r.owner_creation_date).ToUniversalTime() -ne $p.StartTime.ToUniversalTime()){throw 'OWNER_IDENTITY_MISMATCH'}
$handle=[Threading.Mutex]::OpenExisting($mutex)
try{
 $hash=(Get-FileHash $file).Hash
 [IO.File]::WriteAllText((Join-Path $root 'crash-now'),'own fixture exit only')
 if(!$p.WaitForExit(10000)){throw 'OWNER_EXIT_TIMEOUT'}
 if($p.ExitCode -ne 9){throw 'CRASH_NOT_OBSERVED'}
 $blocked=$false;try{Enter-BoundMutexes @($mutex)|Out-Null}catch{if($_.Exception.Message -ne 'ABANDONED_OWNER_REQUIRES_REVIEW'){throw};$blocked=$true}
 if(!$blocked){throw 'ABANDONED_MUTEX_ACCEPTED'}
 $durable=$false;try{Assert-R3OwnerClosed $file}catch{if($_.Exception.Message -ne 'OWNER_RECOVERY_REVIEW_REQUIRED'){throw};$durable=$true}
 if(!$durable -or (Get-FileHash $file).Hash -ne $hash){throw 'OWNER_EVIDENCE_CHANGED'}
 $missing=$false;try{Assert-R3OwnerClosed (Join-Path $root 'missing.json')}catch{if($_.Exception.Message -ne 'OWNER_HISTORY_UNKNOWN'){throw};$missing=$true}
 if(!$missing){throw 'UNKNOWN_ACCEPTED'}
 @{status='OWNER_CRASH_FAIL_CLOSED_PASS';owner=$r;exit_code=$p.ExitCode;abandoned_blocked=$blocked;durable_reentry_blocked=$durable;unknown_blocked=$missing;evidence_preserved=$true;automatic_recovery=$false;formal_mutations=0}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $root 'receipt.json')
}finally{$handle.Dispose()}
