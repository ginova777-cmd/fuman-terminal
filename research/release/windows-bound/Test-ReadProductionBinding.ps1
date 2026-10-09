$ErrorActionPreference='Stop'
$script=Join-Path $PSScriptRoot 'Read-ProductionBinding.ps1'
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($script,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'PARSE_FAILED'}
$forbidden=@('Stop-Process','Start-Process','Disable-ScheduledTask','Enable-ScheduledTask','Start-ScheduledTask','New-Item','Set-Content','Remove-Item','Enter-BoundMutexes','Invoke-RestMethod')
foreach($command in $ast.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst]},$true)){if($command.GetCommandName() -in $forbidden){throw ('MUTATION_COMMAND:'+ $command.GetCommandName())}}
$missing=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()+'.json')
$r=(& $script -ConfigPath $missing)|ConvertFrom-Json
if($r.status -ne 'BLOCKED' -or $r.blockers -notcontains 'RELEASE_CONFIG_MISSING' -or $r.formal_mutations -or $r.locks_acquired){throw 'MISSING_CONFIG_NOT_CLOSED'}
$temp=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()+'.json')
try{
 [IO.File]::WriteAllText($temp,'{invalid')
 $r=(& $script -ConfigPath $temp)|ConvertFrom-Json
 if($r.blockers -notcontains 'RELEASE_CONFIG_INVALID'){throw 'INVALID_JSON_NOT_CLOSED'}
 [IO.File]::WriteAllText($temp,'{}')
 $r=(& $script -ConfigPath $temp)|ConvertFrom-Json
 if($r.status -ne 'BLOCKED' -or !($r.blockers -match 'INVALID_SHA') -or $r.apply_authorized){throw 'INCOMPLETE_CONFIG_NOT_CLOSED'}
 $flags=@{};foreach($f in @('FUMAN_CHANGE_EVIDENCE_PHASE1','FUMAN_SHADOW_TELEMETRY','MP_PHASE2_ENABLED','MP_PHASE3_ENABLED','MP_PHASE4_ENABLED','MP_RELEASE_PREP_PUBLISHER')){$flags[$f]='0'}
 $cfg=@{target=('a'*40);expected=('a'*40);rollback=('a'*40);formal_apply_authorized=$false;flags=$flags}
 $cfg.flags.MP_PHASE3_ENABLED='1';$cfg|ConvertTo-Json -Depth 5|Set-Content $temp
 $r=(& $script -ConfigPath $temp)|ConvertFrom-Json
 if(!($r.blockers -match 'FLAG_NOT_EXPLICITLY_OFF')){throw 'ENABLE_NOT_REJECTED'}
 $cfg.flags.MP_PHASE3_ENABLED='0';$cfg.formal_apply_authorized=$true;$cfg|ConvertTo-Json -Depth 5|Set-Content $temp
 $r=(& $script -ConfigPath $temp)|ConvertFrom-Json
 if(!($r.blockers -match 'READONLY_PACKAGE_MUST_NOT_AUTHORIZE_APPLY')){throw 'APPLY_NOT_REJECTED'}
 $cfg.formal_apply_authorized=$false;$cfg.rollback=('b'*40);$cfg|ConvertTo-Json -Depth 5|Set-Content $temp
 $r=(& $script -ConfigPath $temp)|ConvertFrom-Json
 if(!($r.blockers -match 'ROLLBACK_BASE_MISMATCH')){throw 'ROLLBACK_NOT_REJECTED'}
}finally{[IO.File]::Delete($temp)}
@{status='PASS';cases=@('parse','forbidden_direct_commands','missing_config','invalid_json','incomplete_config','enable_rejected','apply_rejected','rollback_mismatch');scope='OFFLINE_READONLY_COMPANION_NOT_FORMAL_CUTOVER'}|ConvertTo-Json
