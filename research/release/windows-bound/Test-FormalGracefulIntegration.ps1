param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
. (Join-Path $PSScriptRoot 'ProductionMaintenanceBinding.ps1')
. (Join-Path $PSScriptRoot 'ProductionRuntimePorts.ps1')
. (Join-Path $PSScriptRoot 'CutoverSequence.ps1')
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Invoke-ProductionMaintenanceOwner.ps1'),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'OWNER_PARSE_FAILED'}
$assignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$ports'},$true)
$table=[scriptblock]::Create($assignment.Extent.Text)
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('mp-safe-composition-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $testRoot,$OutputDirectory -Force|Out-Null
$target=(& git -C $repo rev-parse HEAD).Trim();$base='db55758a6de8c1896390fc8573b6eab0eacce9bf'
$results=@()
# Windows scheduler is a bounded isolated state model. No real task API is called.
# Exact Owner ports, Windows mutex/file fencing, real Collector/ACK and Git are used.
function Get-TaskBinding($Name){$script:tasks[$Name].Clone()}
function Suspend-BoundTask($Expected){if($tasks[$Expected.name].enabled -ne $Expected.enabled){throw 'TASK_DRIFT'};$tasks[$Expected.name].enabled='false'}
function Restore-BoundTask($Expected){$tasks[$Expected.name].enabled=$Expected.enabled}
function AssertOutsideStockSession {}
function CheckRequester {return $false}
function WriteGate {Write-CutoverReceipt $ctx.owner_gate $identity}
function Test-EvidenceOff($Config){if($env:FUMAN_CHANGE_EVIDENCE_PHASE1 -eq '1'){throw 'TEST_ENABLE_PRESENT'}}
function Invoke-PairedVerifier($Config,$Sha){$a=Get-Content $config.authority -Raw|ConvertFrom-Json;if((& git -C $config.prod rev-parse HEAD).Trim() -ne $Sha -or $a.approvedProductionSha -ne $Sha){throw 'PAIRED_VERIFY_FAILED'};return @{ok=$true}}
function Get-RuntimeInventory($Config){if($script:future){$p=Get-Process -Id $script:future.pid -ErrorAction SilentlyContinue;if($p){return $script:future}}}
function Start-BoundFuture($Config,$LogDir){
 Assert-OnlyBoundFuture $Config $null
 $entry=Join-Path $Config.prod 'scripts/fugle-futopt-websocket-collector.js'
 $si=[Diagnostics.ProcessStartInfo]::new();$si.FileName=(Get-Command node).Source;$si.UseShellExecute=$false;$si.CreateNoWindow=$true
 $si.ArgumentList.Add('--require');$si.ArgumentList.Add((Join-Path $repo 'scripts/fixtures/futopt-shutdown-preload.cjs'));$si.ArgumentList.Add($entry)
 $si.Environment.Clear();foreach($key in @('SystemRoot','PATH','TEMP','TMP')){$si.Environment[$key]=[Environment]::GetEnvironmentVariable($key)}
 $si.Environment['FUMAN_RUNTIME_DIR']=$Config.runtime;$si.Environment['FUMAN_CACHE_DIR']=Join-Path $Config.runtime 'cache';$si.Environment['FUMAN_STATE_DIR']=Join-Path $Config.runtime 'state';$si.Environment['FUMAN_CHANGE_EVIDENCE_PHASE1']='0'
 $si.Environment['FUGLE_FUTOPT_STREAMING_AFTER_HOURS']='false'
 $p=[Diagnostics.Process]::Start($si);$null=$p.Handle
 $script:future=@{pid=$p.Id;creation_ticks=[string]$p.StartTime.ToUniversalTime().Ticks;exe=$si.FileName;entry=$entry;entry_verified=$true;role='future'}
 $limit=[DateTimeOffset]::UtcNow.AddSeconds(20)
 do{Start-Sleep -Milliseconds 100;$f=Join-Path $Config.runtime 'state/futopt-shutdown/owner.json';if(Test-Path $f){$o=Get-Content $f -Raw|ConvertFrom-Json;if($o.pid -eq $p.Id){return $script:future}};if($p.HasExited){throw 'FIXTURE_START_EXITED'}}while([DateTimeOffset]::UtcNow -lt $limit)
 throw 'FIXTURE_START_TIMEOUT'
}
function Invoke-BoundGracefulStop($Config,$Identity,$OwnerGate,$ReceiptPath){
 Assert-OnlyBoundFuture $Config $Identity
 if(!$owner.db -or !$owner.stock -or !$owner.writer){throw 'TEST_OWNER_FENCE_MISSING'}
 $request=@{config=$Config;identity=$Identity;owner_gate=$OwnerGate;isolated_root=$testRoot;operation='stop';out=$ReceiptPath}
 if($scenario -eq 'stop-rejected' -and !$script:cleanup){$request.config=$Config.Clone();$request.config.collector_bindings_sha256='0'*64}
 $requestFile=$ReceiptPath+'.input.json';Write-CutoverReceipt $requestFile $request
 $raw=& node (Join-Path $PSScriptRoot 'test-formal-graceful-helper.cjs') $requestFile
 if($LASTEXITCODE -ne 0){throw 'EXPECTED_GRACEFUL_BLOCK_NO_FORCE'}
 $r=$raw|ConvertFrom-Json -DateKind String
 if(!$r.pid_exited){throw 'EXIT_UNVERIFIED'}
 $script:future=$null;Write-CutoverReceipt $ReceiptPath $r;return $r
}
function Wait-BoundFuture($Config,$Identity){
 if($scenario -eq 'verify-failure-rollback' -and !$script:injected){$script:injected=$true;throw 'INJECTED_POST_START_VERIFY_FAILURE'}
 $limit=[DateTimeOffset]::UtcNow.AddSeconds(15)
 do{try{$s=Get-Content (Join-Path $Config.runtime 'state/fugle-futopt-websocket-status.json') -Raw|ConvertFrom-Json -DateKind String
 return Assert-FutoptWriterHandback @{pid=$Identity.pid;unique=$true;creation_verified=$true;entry_verified=$true;alive=$true} $s 'futopt-daytrade-candles-v8'
 }catch{Start-Sleep -Milliseconds 200}}while([DateTimeOffset]::UtcNow -lt $limit);throw 'ISOLATED_TRANSPORT_TIMEOUT'
}
function ReleaseOperation($Action){
 Assert-OnlyBoundFuture $config $null
 $inputFile=Join-Path $out ($Action+'.input.json')
 Write-CutoverReceipt $inputFile @{config=$config;operation=$Action;out=$ctx.release;owner_gate=$ctx.owner_gate;isolated_root=$testRoot}
 $raw=& node (Join-Path $PSScriptRoot 'test-formal-graceful-helper.cjs') $inputFile
 if($LASTEXITCODE -ne 0){throw ('LOCAL_RELEASE_FAILED:'+ $raw)}
}
foreach($scenario in @('normal','verify-failure-rollback','stop-rejected')){
 $out=Join-Path $testRoot $scenario;New-Item -ItemType Directory (Join-Path $out 'runtime/secrets') -Force|Out-Null
 Set-Content (Join-Path $out 'runtime/secrets/fugle-api-key.txt') 'offline-fixture-only'
 & git clone --quiet --no-hardlinks $repo (Join-Path $out 'source');if($LASTEXITCODE){throw 'CLONE_SOURCE'}
 & git -C (Join-Path $out 'source') checkout -q -B main $target
 & git -C (Join-Path $out 'source') update-ref refs/remotes/origin/main $target
 & git clone --quiet --no-hardlinks (Join-Path $out 'source') (Join-Path $out 'physical');if($LASTEXITCODE){throw 'CLONE_PROD'}
 & git -C (Join-Path $out 'physical') checkout -q --detach $base
 $null=New-Item -ItemType Junction -Path (Join-Path $out 'release-alias') -Target (Join-Path $out 'physical')
 $config=@{prod=(Join-Path $out 'release-alias');runtime=(Join-Path $out 'runtime');source=(Join-Path $out 'source');target=$target;expected=$base;authority=(Join-Path $out 'authority.json');lock=(Join-Path $out 'deploy.lock');minFreeBytes=1;conflictingLocks=@();release_approved=$true;remote_main_verified=$true;binding_sha256='fixture';package_sha256='fixture';collector_entry_sha256=(Get-FileHash (Join-Path $out 'physical/scripts/fugle-futopt-websocket-collector.js')).Hash.ToLower()}
 $dual=& node (Join-Path $PSScriptRoot 'test-formal-graceful-helper.cjs') --bindings $config.prod $config.source $base $target
 if($LASTEXITCODE){throw 'BINDINGS_FAILED'}
 $dual=$dual|ConvertFrom-Json -AsHashtable
 $config.collector_release_bindings=$dual.bindings;$config.collector_bindings_sha256=$dual.sha256
 Write-CutoverReceipt $config.authority @{productionRoot=$config.prod;approvedProductionSha=$base}
 & node (Join-Path $PSScriptRoot 'test-formal-graceful-helper.cjs') --manifest $config.source $base $target $out
 if($LASTEXITCODE){throw 'MANIFEST_FAILED'}
 $config.manifestPath=Join-Path $out 'manifest.json';$config.diffPath=Join-Path $out 'exact.diff';$config.manifest_sha256=(Get-FileHash $config.manifestPath).Hash.ToLower();$config.diff_sha256=(Get-FileHash $config.diffPath).Hash.ToLower()
 $id=[guid]::NewGuid().ToString('N');$script:tasks=@{};$binding=@{files=@();tasks=@();locks=@{database_round=(Join-Path $out 'db-round.lock');stock=('Local\SafeE2E-'+$id+'-Stock');writer=('Local\SafeE2E-'+$id+'-Writer')}}
 foreach($name in @('stock','writer','recovery','closing')){$t=@{name=$name;path='\';enabled=$(if($name -eq 'recovery'){'false'}else{'true'});state='Ready';definition_sha256=([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($name))).ToLower())};$binding.tasks+=@{binding=$t};$tasks[$name]=$t.Clone()}
 $approval=@{action='CONTROLLED_CUTOVER_APPLY';target=$target;binding_sha256='fixture';package_sha256='fixture';not_before=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o');expires_at=[DateTimeOffset]::UtcNow.AddMinutes(15).ToString('o')}
 $owner=New-ProductionOwner $binding (Join-Path $out 'owner.json');$identity=@{maintenance_verified=$false;owner_pid=$PID}
 $ctx=@{legacy=$null;future=$null;proof=$null;archive=$null;release=(Join-Path $out 'release');owner_gate=(Join-Path $out 'owner-gate.json');keep=$false;current_sha=$base}
 $script:future=$null;$script:cleanup=$false;$script:injected=$false
 $null=Start-BoundFuture $config $out
 . $table
 $ports.formal=$false
 try{
 $r=Invoke-CutoverSequence $ports
 $expected=if($scenario -eq 'normal'){'CUTOVER_CONTROL_FLOW_VERIFIED_RUNTIME_ACCEPTANCE_PENDING'}elseif($scenario -eq 'stop-rejected'){'MANUAL_RECOVERY_REQUIRED'}else{'RECOVERED_OLD_RELEASE'}
 if($r.status -ne $expected){throw ('E2E_STATUS:'+($r|ConvertTo-Json -Depth 6 -Compress))}
 if($scenario -eq 'stop-rejected'){
  if(!$owner.db -or !$owner.stock -or !$owner.writer -or !$future -or !(Get-Process -Id $future.pid -ErrorAction SilentlyContinue)){throw 'FAILURE_MUST_RETAIN_OWNER_AND_LIVE_COLLECTOR'}
  Invoke-PairedVerifier $config $base|Out-Null
 }else{
  if($owner.db -or $owner.stock -or $owner.writer){throw 'FENCE_NOT_HANDED_BACK'}
  foreach($t in $binding.tasks){if($tasks[$t.binding.name].enabled -ne $t.binding.enabled){throw 'TASK_HANDBACK_MISMATCH'}}
  Invoke-PairedVerifier $config $(if($scenario -eq 'normal'){$target}else{$base})|Out-Null
 }
 $results+=@{scenario=$scenario;status='PASS';root=$out;result=$r;task_model='ISOLATED_NO_SYSTEM_TASKS';ack='ORIGINAL_COLLECTOR';git='REAL_LOCAL_CLONES';locks='REAL_LOCAL_WINDOWS_MUTEX_AND_FILE';final_sha=(& git -C $config.prod rev-parse HEAD).Trim()}
 }finally{
 # Only test-created processes and local fences are released. Never force terminate.
 $script:cleanup=$true;$owner.manual_recovery_required=$false
 if(!$owner.db){$owner=New-ProductionOwner $binding (Join-Path $out 'cleanup-owner.json');Enter-ProductionFence $owner $config $approval { <# Isolated runtime fixture guard; never formal. #> }}
 if($future){Invoke-BoundGracefulStop $config $future $ctx.owner_gate (Join-Path $out 'cleanup-stop.json')|Out-Null}
 Restore-ProductionFence $owner
 }
}
@{status='PASS';cases=$results;root=$testRoot;formal_mutations=$false}|ConvertTo-Json -Depth 20|Set-Content (Join-Path $OutputDirectory 'integrated-e2e.json') -Encoding utf8
Write-Output ('PASS '+$results.Count)

