Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Get-TaskBinding($Name){
 $task=Get-ScheduledTask -TaskName $Name -ErrorAction Stop
 if(@($task).Count -ne 1){throw 'TASK_IDENTITY_AMBIGUOUS'}
 [xml]$xml=Export-ScheduledTask -TaskName $Name -TaskPath $task.TaskPath
 $n=$xml.SelectSingleNode('//*[local-name()="Settings"]/*[local-name()="Enabled"]')
 $enabled=if($task.Settings.Enabled){'true'}else{'false'}
 if($n){$null=$n.ParentNode.RemoveChild($n)}
 $hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($xml.OuterXml))).ToLower()
 @{name=$Name;path=$task.TaskPath;enabled=$enabled;definition_sha256=$hash;state=[string]$task.State}
}
function Suspend-BoundTask($Expected){
 $b=Get-TaskBinding $Expected.name
 if($b.path -ne $Expected.path -or $b.definition_sha256 -ne $Expected.definition_sha256 -or $b.enabled -ne $Expected.enabled){throw 'TASK_BINDING_DRIFT'}
 if($b.state -eq 'Running'){throw 'TASK_STILL_RUNNING'}
 Disable-ScheduledTask -TaskName $b.name -TaskPath $b.path|Out-Null
 $post=Get-TaskBinding $b.name
 if($post.enabled -ne 'false' -or $post.definition_sha256 -ne $b.definition_sha256){throw 'TASK_SUSPEND_READBACK_FAILED'}
 return $post
}
function Restore-BoundTask($Expected){
 $b=Get-TaskBinding $Expected.name
 if($b.path -ne $Expected.path -or $b.definition_sha256 -ne $Expected.definition_sha256){throw 'TASK_RESTORE_DRIFT'}
 if($Expected.enabled -eq 'true'){Enable-ScheduledTask -TaskName $b.name -TaskPath $b.path|Out-Null}else{Disable-ScheduledTask -TaskName $b.name -TaskPath $b.path|Out-Null}
 $post=Get-TaskBinding $b.name
 if($post.enabled -ne $Expected.enabled -or $post.definition_sha256 -ne $Expected.definition_sha256){throw 'TASK_RESTORE_READBACK_FAILED'}
 return $post
}
function Enter-BoundMutexes($Names){
 $held=[Collections.Generic.List[object]]::new()
 try{foreach($name in $Names){$m=[Threading.Mutex]::new($false,$name);try{$got=$m.WaitOne(0)}catch [Threading.AbandonedMutexException]{$m.ReleaseMutex();$m.Dispose();throw 'ABANDONED_OWNER_REQUIRES_REVIEW'};if(!$got){$m.Dispose();throw 'RUNTIME_MUTEX_BUSY'};$held.Add($m)};return ,$held}catch{foreach($m in $held){$m.ReleaseMutex();$m.Dispose()};throw}
}
function Exit-BoundMutexes($Held){foreach($m in $Held){$m.ReleaseMutex();$m.Dispose()}}