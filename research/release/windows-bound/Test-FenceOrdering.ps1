param([string]$ChildRoot,[switch]$CrashChild)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ProductionMaintenanceBinding.ps1')
$script:realEnter=(Get-Command Enter-BoundMutexes).ScriptBlock
function Enter-BoundMutexes($Names){if(($script:inject -eq 'stock-busy' -and $Names[0].EndsWith('-stock')) -or ($script:inject -eq 'writer-busy' -and $Names[0].EndsWith('-writer'))){throw 'RUNTIME_MUTEX_BUSY'}; & $script:realEnter $Names}
$script:inject=''
$stockName='Fuman Fugle Daytrade WebSocket Collector 0600-1330';$writerName='Fuman Daytrade Source Writer 0600-1330'
function Get-TaskBinding($Name){$script:tasks[$Name].Clone()}
function Suspend-BoundTask($Expected){
 Assert-HeldFence $script:owner
 $script:mutations++
 if($script:failTask -and ($case -ne 'second-task-drift' -or $script:mutations -eq 2)){throw 'TASK_DRIFT_INJECTED'}
 $script:tasks[$Expected.name].enabled='false'
}
function Restore-BoundTask($Expected){$script:tasks[$Expected.name].enabled=$Expected.enabled}
function Setup($dir){
 New-Item -ItemType Directory $dir -Force|Out-Null
 $id=[IO.Path]::GetFileName($dir);$script:tasks=@{};$script:mutations=0;$script:failTask=$false
 $script:b=@{files=@();tasks=@();locks=@{database_round="$dir/round.lock";stock="Local\FenceOrder-$id-stock";writer="Local\FenceOrder-$id-writer"}}
 foreach($n in @($stockName,$writerName)){$t=@{name=$n;path='\';enabled='true';state='Ready';definition_sha256=('a'*64)};$script:tasks[$n]=$t.Clone();$script:b.tasks+=@{binding=$t}}
 $script:c=@{target='fixture';binding_sha256='x';package_sha256='x';release_approved=$true;remote_main_verified=$true}
 $script:a=@{action='CONTROLLED_CUTOVER_APPLY';target='fixture';binding_sha256='x';package_sha256='x';not_before=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o');expires_at=[DateTimeOffset]::UtcNow.AddMinutes(5).ToString('o')}
 $script:owner=New-ProductionOwner $b "$dir/owner.json"
}
if($CrashChild){Setup $ChildRoot;Enter-ProductionFence $owner $c $a {};[IO.File]::WriteAllText("$ChildRoot/ready",'ready');while(!(Test-Path "$ChildRoot/exit")){Start-Sleep -Milliseconds 50};[Environment]::Exit(74)}
$root=Join-Path ([IO.Path]::GetTempPath()) ('fence-order-'+[guid]::NewGuid().ToString('N'));$results=[Collections.Generic.List[object]]::new()
function Check($name,$ok){if(!$ok){throw ('ASSERT:'+ $name)};$results.Add(@{name=$name;status='PASS'})}
foreach($case in @('normal','db-busy','stock-busy','writer-busy','owner-identity','task-drift','second-task-drift','runtime-restart','missing-guard')){
 Setup "$root/$case";$script:inject=$case;$holder=$null;$err=$null;$script:guards=0
 if($case -eq 'db-busy'){$holder=[IO.File]::Open($b.locks.database_round,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
 if($case -eq 'owner-identity'){$owner.owner_creation_ticks=0}
 if($case -in @('task-drift','second-task-drift')){$script:failTask=$true}
 try{
  if($case -eq 'missing-guard'){Enter-ProductionFence $owner $c $a}
  else{Enter-ProductionFence $owner $c $a {$script:guards++;if($case -eq 'runtime-restart' -and $script:guards -ge 2){throw 'RUNTIME_PID_RESTARTED'}}}
 }catch{$err=$_.Exception.Message}
 if($case -eq 'normal'){
  Check 'all_locks_held_before_every_suspend' ($mutations -eq 2 -and $owner.db -and $owner.stock -and $owner.writer)
  $busy=$false;try{$f=[IO.File]::Open($b.locks.database_round,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$f.Dispose()}catch{$busy=$true};Check 'round_lock_still_exclusive_after_fence' $busy
  Release-StockBinding $owner;Check 'writer_and_db_held_through_stock_handback' ($owner.db -and $owner.writer -and !$owner.stock)
  Restore-WriterBinding $owner @{transport_identity_pass=$true};Check 'locks_release_only_at_handback' (!$owner.db -and !$owner.writer)
 }else{
  Check ($case+'_rejected') ([bool]$err)
  if($case -notin @('task-drift','second-task-drift')){Check ($case+'_no_task_mutation') ($mutations -eq 0)}
  Check ($case+'_no_handle_leak') (!$owner.db -and !$owner.stock -and !$owner.writer)
  Check ($case+'_task_states_restored') (@($tasks.Values|Where-Object enabled -ne 'true').Count -eq 0)
 }
 if($holder){$holder.Dispose()}
}
# Real isolated owner exit while holding two mutexes and exclusive round file.
$dir="$root/crash";New-Item -ItemType Directory $dir -Force|Out-Null
$ps=(Get-Process -Id $PID).Path;$child=Start-Process $ps -WindowStyle Hidden -ArgumentList "-NoProfile -File `"$PSCommandPath`" -ChildRoot `"$dir`" -CrashChild" -PassThru
$sw=[Diagnostics.Stopwatch]::StartNew();while(!(Test-Path "$dir/ready") -and $sw.Elapsed.TotalSeconds -lt 15){Start-Sleep -Milliseconds 50};if(!(Test-Path "$dir/ready")){throw 'CHILD_NOT_READY'}
$m=[Threading.Mutex]::OpenExisting('Local\FenceOrder-crash-stock')
$busy=$false;try{$held=Enter-BoundMutexes @('Local\FenceOrder-crash-stock')}catch{$busy=$_.Exception.Message -eq 'RUNTIME_MUTEX_BUSY'};Check 'live_owner_blocks_competing_mutex' $busy
[IO.File]::WriteAllText("$dir/exit",'exit');if(!$child.WaitForExit(10000)){throw 'CHILD_EXIT_TIMEOUT'};Check 'owner_abrupt_exit' ($child.ExitCode -eq 74)
$abandoned=$false;try{$held=Enter-BoundMutexes @('Local\FenceOrder-crash-stock')}catch{$abandoned=$_.Exception.Message -eq 'ABANDONED_OWNER_REQUIRES_REVIEW'};Check 'abandoned_mutex_fail_closed' $abandoned;$m.Dispose()
$stale=$false;try{$null=New-ProductionOwner @{tasks=@()} "$dir/owner.json"}catch{$stale=$_.Exception.Message -eq 'OWNER_RECEIPT_EXISTS'};Check 'crash_receipt_not_silently_reused' $stale
$f=[IO.File]::Open("$dir/round.lock",[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$f.Dispose();Check 'crash_os_lock_release_not_claimed_durable' $true
@{status='PASS';cases=$results.Count;results=$results;root=$root;formal_mutations=$false;scope='REAL_LOCAL_MUTEX_AND_FILE_LOCK_MOCK_TASKS_RUNTIME_IDENTITY'}|ConvertTo-Json -Depth 8


