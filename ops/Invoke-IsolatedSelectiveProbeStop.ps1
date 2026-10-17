[CmdletBinding()]
param([ValidateSet('Stage','Stop')][string]$Mode,[Parameter(Mandatory)][string]$ApprovalFile,[switch]$Formal,[string]$CaseRoot,[ValidateSet('none','before_replace','after_replace','concurrent_change')][string]$Fault='none')
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$release='ef83ce7920a44a6d1dfff26e06b2e89f47f40323'
function Hash($p){(Get-FileHash -LiteralPath $p).Hash.ToLowerInvariant()}
function NoLink($p){$i=Get-Item -LiteralPath $p;while($i){if($i.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE_REJECTED'};$i=if($i -is [IO.FileInfo]){$i.Directory}else{$i.Parent}}}
function Bytes($probe){[Text.UTF8Encoding]::new($false).GetBytes(([ordered]@{contract='daytrade_module_recovery_policy_v1';trade_date='2026-10-15';release_sha=$release;restored=@();probe=$probe}|ConvertTo-Json -Compress))}
function Digest($b){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]]$b)).ToLowerInvariant()}
$stage=Bytes 'A01';$stop=Bytes $null
$lock=$null;$out=$null;$r=[ordered]@{mode=$Mode;status='BLOCKED';formal_execution=[bool]$Formal;write_attempted=$false;replaced=$false;error=$null;started_at=[DateTimeOffset]::Now.ToString('o')}
try{
 if($Mode -ne 'Stop'){throw 'STOP_ONLY'}
 if($Formal){throw 'ISOLATED_CANDIDATE_ONLY'}
 if($Formal){
  if($Fault -ne 'none' -or $CaseRoot){throw 'FORMAL_OVERRIDE_FORBIDDEN'}
  if(![Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
  $file='C:/fuman-runtime/config/daytrade-module-recovery-policy.json'
  $out=Join-Path $PSScriptRoot ('runs/'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $out -Force|Out-Null
 }else{
  if(!$CaseRoot){throw 'ISOLATED_CASE_REQUIRED'}
  $case=[IO.Path]::GetFullPath($CaseRoot);$labs=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'labs'))+[IO.Path]::DirectorySeparatorChar
  if(!$case.StartsWith($labs,[StringComparison]::OrdinalIgnoreCase)){throw 'ISOLATED_PATH_REQUIRED'}
  NoLink $case;$file=Join-Path $case 'policy.json';$out=Join-Path $case ('run-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $out|Out-Null
 }
 NoLink $file;NoLink $out;NoLink $ApprovalFile
 $g=Get-Content -LiteralPath $ApprovalFile -Raw|ConvertFrom-Json
 if($g.status -cne 'APPROVED' -or $g.action -cne ('A01_POLICY_'+$Mode.ToUpperInvariant()) -or $g.target -cne $release -or $g.trade_date -cne '2026-10-15' -or $g.tool_sha256 -cne (Hash $PSCommandPath) -or $g.policy_path -cne [IO.Path]::GetFullPath($file)){throw 'EXACT_GO_REQUIRED'}
 $now=[DateTimeOffset]::Now
 if($now -lt [DateTimeOffset]::Parse($g.not_before) -or $now -ge [DateTimeOffset]::Parse($g.expires_at)){throw 'GO_WINDOW_INVALID'}
 if($Formal){throw 'ISOLATED_CANDIDATE_ONLY'}
 if($Formal){
  if($Mode -eq 'Stage' -and $now -ge [DateTimeOffset]::Parse('2026-10-15T06:00:00+08:00')){throw 'STAGING_AFTER_NATURAL_START_FORBIDDEN'}
  $raw=& node 'C:/fuman-release-owner/fuman-terminal/scripts/verify-release-root-authority.js' --require-production-root
  if($LASTEXITCODE -ne 0){throw 'AUTHORITY_FAILED'}
  $a=($raw|Out-String)|ConvertFrom-Json
  if(!$a.ok -or $a.productionHead -cne $release -or !$a.productionClean){throw 'RELEASE_DRIFT'}
  if(Test-Path 'C:/fuman-runtime/state/mother-cutover-maintenance-owner.lock'){throw 'MAINTENANCE_ACTIVE'}
 }
 $lockPath=$file+'.a01-control.lock';if(Test-Path -LiteralPath $lockPath){NoLink $lockPath}
 $lock=[IO.File]::Open($lockPath,'OpenOrCreate','ReadWrite','None')
 $before=[IO.File]::ReadAllBytes($file);$beforeHash=Digest $before
 $expected=$g.expected_policy_sha256
 if($g.expected_policy_sha256 -cne $expected -or $beforeHash -cne $expected){throw 'POLICY_DRIFT_OR_ALREADY_EXECUTED'}
  $root=Split-Path $PSScriptRoot -Parent
 $files=@('scripts/prepare-selective-probe-stop.cjs','lib/daytrade-selective-probe-stop.cjs','lib/daytrade-module-recovery-policy.cjs','lib/daytrade-independent-preopen-modules.cjs','data/contracts/mother-pool-a01-b24-module-registry-v1.json')
 foreach($relative in $files){if($g.package_hashes.$relative -cne (Hash (Join-Path $root $relative))){throw 'PACKAGE_HASH_DRIFT'}}
 $raw=& node (Join-Path $root 'scripts/prepare-selective-probe-stop.cjs') $file $ApprovalFile
 if($LASTEXITCODE -ne 0){throw 'SELECTIVE_STOP_VALIDATION_FAILED'}
 $plan=($raw|Out-String)|ConvertFrom-Json
 $after=[Convert]::FromBase64String($plan.after_base64)
 $r.retained_modules=@($plan.retained)
 if($g.new_policy_sha256 -cne (Digest $after)){throw 'PROPOSED_HASH_DRIFT'}
 $acl=(Get-Acl -LiteralPath $file).Sddl
 [IO.File]::WriteAllBytes((Join-Path $out 'before.json'),$before)
 $r.before_sha256=$beforeHash;$r.expected_after_sha256=Digest $after;$r.policy_path=$file
 $tmp=$file+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
 $f=[IO.File]::Open($tmp,'CreateNew','Write','None');try{$f.Write([byte[]]$after,0,$after.Length);$f.Flush($true)}finally{$f.Dispose()}
 Set-Acl -LiteralPath $tmp -AclObject (Get-Acl -LiteralPath $file)
 if($Fault -eq 'before_replace'){throw 'INJECTED_BEFORE_REPLACE'}
 if($Fault -eq 'concurrent_change'){[IO.File]::AppendAllText($file,' ')}
 if((Hash $file) -cne $beforeHash){throw 'POLICY_CHANGED_BEFORE_REPLACE'}
 $r.write_attempted=$true
 [IO.File]::Replace($tmp,$file,(Join-Path $out 'atomic-backup.json'))
 $r.replaced=$true
 if($Fault -eq 'after_replace'){throw 'INJECTED_AFTER_REPLACE_READBACK_REQUIRED'}
 if((Hash $file) -cne $r.expected_after_sha256 -or (Get-Acl -LiteralPath $file).Sddl -cne $acl){throw 'POST_WRITE_HASH_OR_ACL_DRIFT'}
 $r.status=if($Mode -eq 'Stage'){'A01_PROBE_STAGED_NOT_ENABLED'}else{'A01_PROBE_CLEARED_NOT_INFLIGHT_ABORTED'}
}catch{$r.error=$_.Exception.Message;if($r.replaced){$r.status='REPLACED_REQUIRES_INDEPENDENT_READBACK'}}
finally{if($lock){$lock.Dispose()};$r.finished_at=[DateTimeOffset]::Now.ToString('o');if($out){$r|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $out 'receipt.json')};$r|ConvertTo-Json -Depth 8}
if($r.error){exit 1}


