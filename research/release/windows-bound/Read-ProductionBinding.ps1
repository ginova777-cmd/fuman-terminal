[CmdletBinding()]
param([string]$ConfigPath=(Join-Path $PSScriptRoot 'release-config.json'))
$ErrorActionPreference='Stop'
# Read-only companion. No lock acquisition, task changes, process control or DB writes.
$r=[ordered]@{contract='maintenance-binding-readonly-v1';checked_at=[DateTimeOffset]::UtcNow.ToString('o');formal_mutations=$false;locks_acquired=$false;apply_authorized=$false;checks=@();blockers=@();status='BLOCKED'}
function Check($Name,[scriptblock]$Probe){try{$value=& $Probe;$r.checks+=@{name=$Name;status='PASS';value=$value}}catch{$r.checks+=@{name=$Name;status='BLOCKED';reason=$_.Exception.Message};$r.blockers+=($Name+':'+$_.Exception.Message)}}
if(!(Test-Path -LiteralPath $ConfigPath)){$r.blockers+= 'RELEASE_CONFIG_MISSING';$r|ConvertTo-Json -Depth 12;return}
try{$c=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json -AsHashtable}catch{$r.blockers+='RELEASE_CONFIG_INVALID';$r|ConvertTo-Json -Depth 12;return}
Check 'config' {
 foreach($key in @('target','expected','rollback')){if($c[$key] -notmatch '^[a-f0-9]{40}$'){throw ('INVALID_SHA:'+ $key)}}
 if($c.rollback -ne $c.expected){throw 'ROLLBACK_BASE_MISMATCH'}
 if($c.formal_apply_authorized -ne $false){throw 'READONLY_PACKAGE_MUST_NOT_AUTHORIZE_APPLY'}
 foreach($flag in @('FUMAN_CHANGE_EVIDENCE_PHASE1','FUMAN_SHADOW_TELEMETRY','MP_PHASE2_ENABLED','MP_PHASE3_ENABLED','MP_PHASE4_ENABLED','MP_RELEASE_PREP_PUBLISHER')){if($c.flags[$flag] -ne '0'){throw ('FLAG_NOT_EXPLICITLY_OFF:'+ $flag)}}
 'VALID_READONLY_CONFIG'
}
Check 'production' {
 if(!$c.prod -or !(Test-Path -LiteralPath $c.prod -PathType Container)){throw 'PRODUCTION_PATH_MISSING'}
 $head=& git -C $c.prod rev-parse HEAD;if($LASTEXITCODE -ne 0){throw 'PRODUCTION_GIT_READ_FAILED'}
 $dirty=@(& git -C $c.prod status --porcelain);if($LASTEXITCODE -ne 0){throw 'PRODUCTION_STATUS_FAILED'}
 if($head.Trim() -ne $c.expected -or $dirty.Count){throw 'PRODUCTION_DRIFT'}
 $head.Trim()
}
Check 'authority' {
 $a=Get-Content -LiteralPath $c.authority -Raw|ConvertFrom-Json
 if($a.approvedProductionSha -ne $c.expected){throw 'AUTHORITY_DRIFT'}
 $a.approvedProductionSha
}
Check 'binding' {
 $p=Join-Path (Split-Path $ConfigPath) 'formal-binding.json'
 if((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() -ne $c.binding_sha256){throw 'BINDING_HASH_MISMATCH'}
 $b=Get-Content -LiteralPath $p -Raw|ConvertFrom-Json
 if(!$b.files -or !$b.tasks){throw 'BINDING_INCOMPLETE'}
 foreach($file in $b.files){if((Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash.ToLower() -ne $file.sha256){throw ('BOUND_FILE_DRIFT:'+ $file.path)}}
 . (Join-Path $PSScriptRoot 'WindowsScheduleBinding.ps1')
 foreach($task in $b.tasks){$actual=Get-TaskBinding $task.binding.name;if($actual.path -ne $task.binding.path -or $actual.definition_sha256 -ne $task.binding.definition_sha256 -or $actual.enabled -ne $task.binding.enabled){throw ('TASK_BINDING_DRIFT:'+ $task.binding.name)}}
 'PINNED_FILES_AND_TASKS_MATCH'
}
Check 'package' {
 $root=[IO.Path]::GetFullPath((Split-Path $ConfigPath))
 $manifest=Join-Path $root 'tool-manifest.json'
 if((Get-FileHash -LiteralPath $manifest).Hash.ToLower() -ne $c.package_sha256){throw 'TOOL_MANIFEST_DRIFT'}
 $m=Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json
 if(!$m.files){throw 'TOOL_MANIFEST_EMPTY'}
 foreach($f in $m.files){$p=[IO.Path]::GetFullPath((Join-Path $root $f.path));if(!$p.StartsWith($root.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'TOOL_PATH_OUTSIDE_PACKAGE'};if((Get-Item -LiteralPath $p).Length -ne $f.bytes -or (Get-FileHash -LiteralPath $p).Hash.ToLower() -ne $f.sha256){throw 'TOOL_FILE_DRIFT'}}
 foreach($p in $m.config_identity.PSObject.Properties){if($c[$p.Name] -ne $p.Value){throw ('TOOL_CONFIG_IDENTITY_DRIFT:'+ $p.Name)}}
 'SEALED_PACKAGE_MATCH'
}
Check 'environment' {
 foreach($scope in @('Process','User','Machine')){foreach($flag in $c.flags.Keys){$v=[Environment]::GetEnvironmentVariable($flag,$scope);if($v -and $v -ne '0'){throw ('ENABLE_PRESENT:'+ $scope+':'+$flag)}}}
 'NO_ENABLE_IN_CHECKED_SCOPES_CHILD_ENV_UNVERIFIED'
}
# These cannot be inferred from filesystem readability or an expired lease.
$r.blockers+=@('FORMAL_OWNER_TRUST_AND_MUTEX_ACL_NOT_ATTESTED','LIVE_RUNTIME_STOP_AND_HANDBACK_NOT_ATTESTED','MAINTENANCE_WINDOW_NOT_AUTHORIZED')
$r|ConvertTo-Json -Depth 12
