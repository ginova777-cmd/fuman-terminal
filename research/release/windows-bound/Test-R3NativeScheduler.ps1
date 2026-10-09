param([string]$TaskName,[string]$OutputDirectory,[switch]$RequireCrossSession)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($TaskName -notmatch '^Codex-MP-R3-Isolated-[a-f0-9]{32}$'){throw 'ISOLATED_TASK_NAME_REQUIRED'}
$root=[IO.Path]::GetFullPath($OutputDirectory)
if($root -notlike '*\outputs\r3-final-runtime-*'){throw 'ISOLATED_OUTPUT_REQUIRED'}
New-Item -ItemType Directory -Force -Path $root|Out-Null
. (Join-Path $PSScriptRoot 'WindowsScheduleBinding.ps1')
$before=Export-ScheduledTask -TaskName $TaskName
[IO.File]::WriteAllText((Join-Path $root 'original-task.xml'),$before)
$original=Get-TaskBinding $TaskName
$events=[Collections.Generic.List[object]]::new()
$mutexName='Global\Codex-MP-R3-'+[guid]::NewGuid().ToString('N')
$entry=Join-Path $root 'isolated-task.ps1'
@'
param($Root,$MutexName)
$ErrorActionPreference='Stop'
$h=[Threading.Mutex]::OpenExisting($MutexName)
try{$got=$h.WaitOne(0);if($got){$h.ReleaseMutex();throw 'MUTEX_NOT_HELD'}}finally{$h.Dispose()}
@{pid=$PID;creation_date=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o');session_id=(Get-Process -Id $PID).SessionId;mutex='HELD'}|ConvertTo-Json|Set-Content (Join-Path $Root 'task-start.json')
$deadline=[DateTime]::UtcNow.AddSeconds(40)
while(!(Test-Path (Join-Path $Root 'stop.request'))){if([DateTime]::UtcNow -gt $deadline){exit 2};Start-Sleep -Milliseconds 200}
@{pid=$PID;status='GRACEFUL_EXIT'}|ConvertTo-Json|Set-Content (Join-Path $Root 'task-exit.json')
'@ | Set-Content -LiteralPath $entry
$held=$null
try{
 Suspend-BoundTask $original|Out-Null
 Restore-BoundTask $original|Out-Null
 $events.Add(@{stage='REAL_DISABLE_RESTORE';pass=$true})
 $held=Enter-BoundMutexes @($mutexName)
 $sddl=[System.Threading.ThreadingAclExtensions]::GetAccessControl($held[0]).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
 $action=New-ScheduledTaskAction -Execute (Get-Command pwsh).Source -Argument ('-NoProfile -File "'+$entry+'" -Root "'+$root+'" -MutexName "'+$mutexName+'"')
 Set-ScheduledTask -TaskName $TaskName -Action $action|Out-Null
 Start-ScheduledTask -TaskName $TaskName
 $deadline=[DateTime]::UtcNow.AddSeconds(15)
 while(!(Test-Path (Join-Path $root 'task-start.json'))){if([DateTime]::UtcNow -gt $deadline){throw 'TASK_START_TIMEOUT'};Start-Sleep -Milliseconds 200}
 $identity=Get-Content (Join-Path $root 'task-start.json') -Raw|ConvertFrom-Json -DateKind String
 $live=Get-Process -Id $identity.pid
 if($live.StartTime.ToUniversalTime() -ne [DateTime]::Parse($identity.creation_date).ToUniversalTime()){throw 'PID_CREATION_MISMATCH'}
 $events.Add(@{stage='REAL_TASK_START';identity=$identity;owner_pid=$PID;owner_creation_date=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o');owner_session=(Get-Process -Id $PID).SessionId;global_mutex=$mutexName;acl_sddl=$sddl;cross_session=($identity.session_id -ne (Get-Process -Id $PID).SessionId)})
 [IO.File]::WriteAllText((Join-Path $root 'stop.request'),'STOP only isolated task')
 $deadline=[DateTime]::UtcNow.AddSeconds(15)
 while(Get-Process -Id $identity.pid -ErrorAction SilentlyContinue){if([DateTime]::UtcNow -gt $deadline){throw 'TASK_EXIT_TIMEOUT'};Start-Sleep -Milliseconds 200}
 if(!(Test-Path (Join-Path $root 'task-exit.json'))){throw 'NO_GRACEFUL_RECEIPT'}
 $events.Add(@{stage='REAL_TASK_GRACEFUL_EXIT';pass=$true})
 try{Restore-BoundTask $original|Out-Null;throw 'EXPECTED_RESTORE_REJECTION'}catch{if($_.Exception.Message -notlike '*TASK_RESTORE_DRIFT*'){throw};$events.Add(@{stage='RESTORE_DRIFT_BLOCKED';pass=$true})}
 Register-ScheduledTask -TaskName $TaskName -Xml $before -Force|Out-Null
 $restored=Get-TaskBinding $TaskName
 if($restored.definition_sha256 -ne $original.definition_sha256 -or $restored.enabled -ne $original.enabled){throw 'ORIGINAL_XML_NOT_RESTORED'}
 $after=Export-ScheduledTask -TaskName $TaskName
 [IO.File]::WriteAllText((Join-Path $root 'restored-task.xml'),$after)
 if($before -ne $after){throw 'RAW_XML_DIFFERENCE'}
 $events.Add(@{stage='EXACT_XML_ENABLED_TRIGGER_RESTORED';pass=$true})
 @{status='NATIVE_SCHEDULER_PASS';events=$events;cross_session=($identity.session_id -ne (Get-Process -Id $PID).SessionId);formal_mutations=0}|ConvertTo-Json -Depth 9|Set-Content (Join-Path $root 'native-scheduler-receipt.json')
} catch {
 @{status='BLOCKED';error=$_.Exception.Message;events=$events;task=$TaskName}|ConvertTo-Json -Depth 9|Set-Content (Join-Path $root 'native-scheduler-failure.json')
 throw
} finally {
 if($held){Exit-BoundMutexes $held}
 if((Get-ScheduledTask -TaskName $TaskName).State -ne 'Running'){
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
 }
}
