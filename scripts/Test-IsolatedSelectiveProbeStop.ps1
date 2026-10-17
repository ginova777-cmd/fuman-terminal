$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path $PSScriptRoot -Parent
$tool=Join-Path $root 'ops/Invoke-IsolatedSelectiveProbeStop.ps1'
function Get-TestHash($p){(Get-FileHash -LiteralPath $p).Hash.ToLowerInvariant()}
function D($b){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]]$b)).ToLowerInvariant()}
$batch=Join-Path $root ('ops/labs/selective-stop-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $batch -Force|Out-Null
$sha='ef83ce7920a44a6d1dfff26e06b2e89f47f40323';$results=@()
$files=@('scripts/prepare-selective-probe-stop.cjs','lib/daytrade-selective-probe-stop.cjs','lib/daytrade-module-recovery-policy.cjs','lib/daytrade-independent-preopen-modules.cjs','data/contracts/mother-pool-a01-b24-module-registry-v1.json')
foreach($scenario in @('normal','wrong_hash','wrong_new','wrong_sha','expired','package_drift','missing_acceptance','lock_held','before_replace','after_replace','concurrent_change','duplicate','formal_rejected')){
 $case=Join-Path $batch $scenario;New-Item -ItemType Directory $case|Out-Null
 $file=Join-Path $case 'policy.json';$checks=@{};foreach($key in @('payload_bound','runtime_bound','resource_load','natural_write','independent_readback','freshness','page_render','page_refresh')){$checks[$key]=$true}
 $p=[ordered]@{contract='daytrade_module_recovery_policy_v1';trade_date='2026-10-15';release_sha=$sha;restored=@('A02');probe='A01';acceptance=@{A02=@{module_id='A02';trade_date='2026-10-15';release_sha=$sha;receipt_sha256=('b'*64);checks=$checks}}}
 if($scenario -eq 'missing_acceptance'){$p.acceptance=@{}}
 $before=[Text.UTF8Encoding]::new($false).GetBytes(($p|ConvertTo-Json -Depth 10));[IO.File]::WriteAllBytes($file,$before)
 $text=[Text.Encoding]::UTF8.GetString($before);$after=[Text.Encoding]::UTF8.GetBytes($text.Replace('"probe": "A01"','"probe": null'));$acl=(Get-Acl $file).Sddl
 $hashes=@{};foreach($f in $files){$hashes[$f]=Get-TestHash (Join-Path $root $f)}
 $g=@{status='APPROVED';action='A01_POLICY_STOP';module_id='A01';target=$sha;trade_date='2026-10-15';tool_sha256=(Get-TestHash $tool);policy_path=[IO.Path]::GetFullPath($file);not_before=[DateTimeOffset]::Now.AddMinutes(-1).ToString('o');expires_at=[DateTimeOffset]::Now.AddMinutes(10).ToString('o');expected_policy_sha256=(D $before);new_policy_sha256=(D $after);package_hashes=$hashes}
 switch($scenario){'wrong_hash'{$g.expected_policy_sha256='0'*64};'wrong_new'{$g.new_policy_sha256='0'*64};'wrong_sha'{$g.target='0'*40};'expired'{$g.expires_at=[DateTimeOffset]::Now.AddMinutes(-1).ToString('o')};'package_drift'{$g.package_hashes[$files[0]]='0'*64}}
 $go=Join-Path $case 'go.json';$g|ConvertTo-Json -Depth 10|Set-Content $go
 $fault=if($scenario -in @('before_replace','after_replace','concurrent_change')){$scenario}else{'none'}
 $held=$null
 try{
  if($scenario -eq 'lock_held'){$held=[IO.File]::Open($file+'.a01-control.lock','OpenOrCreate','ReadWrite','None')}
  $extra=if($scenario -eq 'formal_rejected'){@('-Formal')}else{@()}
  & pwsh -NoProfile -File $tool -Mode Stop -ApprovalFile $go -CaseRoot $case -Fault $fault @extra *> "$case/run.log";$code=$LASTEXITCODE
 }finally{if($held){$held.Dispose()}}
 $expected=if($scenario -in @('normal','duplicate','after_replace')){D $after}elseif($scenario -eq 'concurrent_change'){D ([Text.Encoding]::UTF8.GetBytes($text+' '))}else{D $before}
 $pass=($code -eq 0) -eq ($scenario -in @('normal','duplicate'))
 $pass=$pass -and (Get-TestHash $file) -ceq $expected -and (Get-Acl $file).Sddl -ceq $acl
 if($scenario -eq 'duplicate'){& pwsh -NoProfile -File $tool -Mode Stop -ApprovalFile $go -CaseRoot $case *> "$case/replay.log";$pass=$pass -and $LASTEXITCODE -ne 0 -and (Get-TestHash $file) -ceq $expected}
 if($scenario -eq 'after_replace'){$receipt=Get-ChildItem $case -Filter receipt.json -Recurse|Select-Object -First 1;$r=Get-Content $receipt.FullName -Raw|ConvertFrom-Json;$pass=$pass -and $r.status -ceq 'REPLACED_REQUIRES_INDEPENDENT_READBACK'}
 $results+=@{scenario=$scenario;exit=$code;pass=[bool]$pass;case=$case;policy_hash=(Get-TestHash $file)}
}
$r=@{status='ISOLATED_SELECTIVE_STOP_PASS';tests=$results;passed=@($results|Where-Object pass).Count;failed=@($results|Where-Object {!$_.pass}).Count;formal_execution=$false;scope='Original A01 CAS/ACL lifecycle adapted in isolated-only candidate; fixture acceptance, not formal source proof'}
if($r.failed){$r.status='BLOCKED'}
$r|ConvertTo-Json -Depth 10|Set-Content (Join-Path $batch 'receipt.json')
@{status=$r.status;passed=$r.passed;failed=$r.failed;receipt=(Join-Path $batch 'receipt.json')}|ConvertTo-Json
if($r.failed){exit 1}
