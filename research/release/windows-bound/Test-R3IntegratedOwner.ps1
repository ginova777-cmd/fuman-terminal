param([string]$Source,[string]$Harness,[string]$OutputDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($OutputDirectory)
if($root -notlike '*\outputs\r3-integrated-*'){throw 'ISOLATED_ONLY'}
New-Item -ItemType Directory -Force -Path $root|Out-Null
. (Join-Path $PSScriptRoot 'ProductionMaintenanceBinding.ps1')
. (Join-Path $PSScriptRoot 'R3OwnerRecoveryGuard.ps1')
# Before registering tasks or acquiring locks, reject unresolved durable ownership.
foreach($priorOwner in @(Get-ChildItem -LiteralPath $root -Filter 'owner*.json')){
 Assert-R3OwnerClosed $priorOwner.FullName
}
if(Test-Path (Join-Path $root 'result.json')){throw 'FRESH_ISOLATED_RUN_REQUIRED'}
$tag=[guid]::NewGuid().ToString('N');$tasks=@();$owner=$null;$node=$null;$success=$false
$writer=Join-Path $root 'writer-probe.ps1'
@'
param($Root)
$ErrorActionPreference='Stop'
@{pid=$PID;creation_date=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content (Join-Path $Root 'writer-alive.json')
try{1..3|ForEach-Object {@{round=$_;pid=$PID;at=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json -Compress|Add-Content (Join-Path $Root 'writer-rounds.jsonl');Start-Sleep -Milliseconds 300}}
finally{Remove-Item -LiteralPath (Join-Path $Root 'writer-alive.json')}
'@|Set-Content $writer
$config=@{target='ISOLATED';binding_sha256=$tag;package_sha256=$tag;release_approved=$true;remote_main_verified=$true}
$approval=@{action='CONTROLLED_CUTOVER_APPLY';target='ISOLATED';binding_sha256=$tag;package_sha256=$tag;not_before=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o');expires_at=[DateTimeOffset]::UtcNow.AddMinutes(15).ToString('o')}
try{
 foreach($role in @('stock','writer')){
  $name='Codex-MP-R3-Integrated-'+$tag+'-'+$role
  $action=if($role -eq 'writer'){New-ScheduledTaskAction -Execute (Get-Command pwsh).Source -Argument ('-NoProfile -File "'+$writer+'" -Root "'+$root+'"')}else{New-ScheduledTaskAction -Execute 'C:\Windows\System32\cmd.exe' -Argument '/c exit 0'}
  Register-ScheduledTask -TaskName $name -Action $action -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date).AddDays(30)) -Description 'R3 isolated integration only'|Out-Null
  $tasks+=@{binding=(Get-TaskBinding $name)}
  Export-ScheduledTask -TaskName $name|Set-Content (Join-Path $root ($role+'-original.xml'))
 }
 $binding=@{files=@();tasks=$tasks;locks=@{database_round=(Join-Path $root 'database.lock');stock=('Global\Codex-MP-R3-'+$tag+'-stock');writer=('Global\Codex-MP-R3-'+$tag+'-writer')}}
 $owner=New-ProductionOwner $binding (Join-Path $root 'owner-first.json');Enter-ProductionFence $owner $config $approval
 $entry=Join-Path $PSScriptRoot '../test-r3-integrated-runtime.cjs'
 $node=Start-Process -FilePath (Get-Command node).Source -ArgumentList @('--max-old-space-size=128',('"'+$entry+'"'),('"'+$Source+'"'),('"'+$Harness+'"'),('"'+$root+'"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'node.stdout') -RedirectStandardError (Join-Path $root 'node.stderr')
 $last='';$deadline=[DateTime]::UtcNow.AddMinutes(8)
 while(!$node.HasExited){
  if([DateTime]::UtcNow -gt $deadline){throw 'ORCHESTRATION_TIMEOUT_NO_KILL'}
  $request=Join-Path $root 'owner-request.json'
  if(Test-Path $request){
   $q=Get-Content $request -Raw|ConvertFrom-Json
   if($q.id -ne $last){
    $last=$q.id;$reply=@{id=$last;status='PASS';action=$q.action;owner_pid=$PID;owner_creation_date=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}
    try{
     switch($q.action){
      'VERIFY_FENCE' {if(!$owner.db -or !$owner.stock -or !$owner.writer){throw 'FENCE_NOT_HELD'};$reply.fenced=$true}
      'HANDBACK' {
       $liveProof=Get-Content (Join-Path $root 'runtime-handoff.json') -Raw|ConvertFrom-Json -DateKind String
       foreach($identity in @($liveProof.stock.collector,$liveProof.stock.supervisor)){
        $actual=Get-Process -Id $identity.pid -ErrorAction Stop
        if($actual.StartTime.ToUniversalTime() -ne [DateTime]::Parse($identity.creation_date).ToUniversalTime()){throw 'LIVE_HANDBACK_IDENTITY_MISMATCH'}
       }
       $future=Get-Process -Id $liveProof.future.pid -ErrorAction Stop
       if([Math]::Abs(($future.StartTime.ToUniversalTime()-[DateTime]::Parse($liveProof.future.creation_time).ToUniversalTime()).TotalMilliseconds) -gt 1){throw 'FUTURE_HANDBACK_IDENTITY_MISMATCH'}
       Release-StockBinding $owner
       Restore-WriterBinding $owner @{transport_identity_pass=$true;scope='INDEPENDENT_WINDOWS_PID_CREATION_READBACK'}
       $roundFile=Join-Path $root 'writer-rounds.jsonl';$beforeCount=if(Test-Path $roundFile){@(Get-Content $roundFile).Count}else{0}
       Start-ScheduledTask -TaskName $tasks[1].binding.name
       $until=[DateTime]::UtcNow.AddSeconds(15)
       do {Start-Sleep -Milliseconds 200;$count=if(Test-Path $roundFile){@(Get-Content $roundFile).Count-$beforeCount}else{0};if([DateTime]::UtcNow -gt $until){throw 'WRITER_ROUNDS_TIMEOUT'}}while($count -lt 3 -or (Get-ScheduledTask -TaskName $tasks[1].binding.name).State -eq 'Running')
       $reply.writer_rounds=$count;$reply.writer_records=@(Get-Content $roundFile|Select-Object -Last 3|ForEach-Object{$_|ConvertFrom-Json})
      }
      'REFENCE' {$owner=New-ProductionOwner $binding (Join-Path $root ('owner-'+[guid]::NewGuid()+'.json'));Enter-ProductionFence $owner $config $approval;$reply.fenced=$true}
      'RESTORE_FAILURE' {
       $task=$tasks[1].binding;$xml=Get-Content (Join-Path $root 'writer-original.xml') -Raw
       Set-ScheduledTask -TaskName $task.name -Action (New-ScheduledTaskAction -Execute 'C:\Windows\System32\cmd.exe' -Argument '/c exit 3')|Out-Null
       $blocked=$false;try{Restore-BoundTask $task|Out-Null}catch{if($_.Exception.Message -notmatch 'TASK_RESTORE_DRIFT'){throw};$blocked=$true}
       if(!$blocked){throw 'RESTORE_FAILURE_NOT_BLOCKED'}
       Register-ScheduledTask -TaskName $task.name -Xml $xml -Force|Out-Null
       Disable-ScheduledTask -TaskName $task.name|Out-Null
       $reply.blocked=$true;$reply.recovered=$true
      }
      default {throw 'UNKNOWN_OWNER_ACTION'}
     }
    }catch{$reply.status='BLOCKED';$reply.error=$_.Exception.Message}
    $tmp=Join-Path $root 'owner-response.tmp';$reply|ConvertTo-Json -Depth 8|Set-Content $tmp;Move-Item -LiteralPath $tmp -Destination (Join-Path $root 'owner-response.json') -Force
   }
  }
  Start-Sleep -Milliseconds 100;$node.Refresh()
 }
 $result=Get-Content (Join-Path $root 'result.json') -Raw|ConvertFrom-Json
 if($result.status -ne 'INTEGRATED_ISOLATED_PASS'){throw 'RUNTIME_INTEGRATION_BLOCKED'}
 Restore-ProductionFence $owner
 foreach($task in $tasks){$actual=Get-TaskBinding $task.binding.name;if($actual.definition_sha256 -ne $task.binding.definition_sha256 -or $actual.enabled -ne $task.binding.enabled){throw 'FINAL_TASK_DRIFT'}}
 $success=$true
 @{status='OWNER_INTEGRATION_PASS';root=$root;formal_mutations=0}|ConvertTo-Json|Set-Content (Join-Path $root 'owner-result.json')
}catch{@{status='BLOCKED';error=$_.Exception.Message;root=$root;automatic_kill=$false}|ConvertTo-Json|Set-Content (Join-Path $root 'owner-result.json');throw}
finally{
 if($success){foreach($task in $tasks){Unregister-ScheduledTask -TaskName $task.binding.name -Confirm:$false}}
 # On failure retain exact task definitions/disabled state for explicit recovery; never kill.
}
