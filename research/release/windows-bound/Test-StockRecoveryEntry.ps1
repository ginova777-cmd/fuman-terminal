$ErrorActionPreference='Stop'
$root=Join-Path 'C:/Users/ginov/Documents/Codex/stock-recovery-labs' ('stock-recovery-entry-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $root|Out-Null
$results=@()
foreach($scenario in @('normal','marker-drift','raw-drift','unknown-sha','after-deploy','after-crash')){
 $lab=Join-Path $root $scenario;New-Item -ItemType Directory $lab|Out-Null
 foreach($file in @('ProductionMaintenanceBinding.ps1','ProductionRuntimePorts.ps1','WindowsScheduleBinding.ps1','LegacyBoundary.ps1','StockOnlyRuntimePorts.ps1','StockPreservationOperation.cjs','stock-preserved-future.cjs')){Copy-Item (Join-Path $PSScriptRoot $file) $lab}
 $runtime=Join-Path $lab 'runtime';$prod=Join-Path $lab 'prod';$run=Join-Path $lab 'runs/old'
 foreach($p in @((Join-Path $runtime 'state'),$prod,$run)){New-Item -ItemType Directory $p -Force|Out-Null}
 [IO.File]::WriteAllText((Join-Path $prod 'future.js'),'preserved')
 $sha='a'*40;$config=@{target=('b'*40);expected=$sha;prod=$prod;runtime=$runtime;cutover_scope='STOCK_ONLY_PRESERVE_FUTURES';package_sha256=('c'*64)}
 $manifest=@{contract='stock_futures_preservation_v1';expected=$sha;target=$config.target;files=@(@{file='future.js';bytes=9;sha256=(Get-FileHash (Join-Path $prod 'future.js')).Hash.ToLower()})}
 $manifest|ConvertTo-Json -Depth 8|Set-Content (Join-Path $lab 'stock-preservation.json');$config.stock_preservation_sha256=(Get-FileHash (Join-Path $lab 'stock-preservation.json')).Hash.ToLower()
 $config|ConvertTo-Json|Set-Content (Join-Path $lab 'release-config.json')
 $identity=@{pid=123;creation_ticks='638000000000000001';exe='fixture';entry='future.js';command_sha256=('d'*64);role='future';entry_verified=$true}
 $identity|ConvertTo-Json|Set-Content (Join-Path $run 'preserved-future-identity.json')
 $marker=Join-Path $runtime 'state/mother-cutover-maintenance-owner.lock'
 @{owner_pid=2147483647;target=$config.target;preserved_future_file=(Join-Path $run 'preserved-future-identity.json')}|ConvertTo-Json|Set-Content $marker
 $binding=@{files=@();tasks=@();locks=@{database_round=(Join-Path $lab 'round.lock');stock=('Local\StockRecover-'+[guid]::NewGuid());writer=('Local\StockRecover-'+[guid]::NewGuid())}}
 foreach($name in @('Fuman Daytrade Source Writer 0600-1330','Fuman Fugle Daytrade WebSocket Collector 0600-1330')){$binding.tasks+=@{binding=@{name=$name;path='\';enabled='true';definition_sha256=('e'*64);state='Ready'}}}
 $binding|ConvertTo-Json -Depth 8|Set-Content (Join-Path $lab 'formal-binding.json')
 if($scenario -in @('after-deploy','after-crash')){
  & node (Join-Path $PSScriptRoot 'prepare-stock-recovery-fixture.cjs') $lab $(if($scenario -eq 'after-crash'){'crash'}else{'normal'})|Out-Null
  if($LASTEXITCODE -ne 0){throw 'REAL_RELEASE_FIXTURE_FAILED'}
  $config=Get-Content (Join-Path $lab 'release-config.json') -Raw|ConvertFrom-Json -AsHashtable
  $runtime=$config.runtime;$prod=$config.prod;$sha=$config.expected;$marker=Join-Path $runtime 'state/mother-cutover-maintenance-owner.lock'
  @{owner_pid=2147483647;target=$config.target;preserved_future_file=(Join-Path $run 'preserved-future-identity.json')}|ConvertTo-Json|Set-Content $marker
 }
 $approval=@{action='STOCK_ONLY_DEAD_RECOVERY';target=$config.target;package_sha256=$config.package_sha256;owner_marker_sha256=(Get-FileHash $marker).Hash.ToLower();run_directory=$run;future_identity_sha256=(Get-FileHash (Join-Path $run 'preserved-future-identity.json')).Hash.ToLower();not_before=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o');expires_at=[DateTimeOffset]::UtcNow.AddMinutes(5).ToString('o')}
 if($scenario -eq 'after-crash'){$approval.release_lock_sha256=(Get-FileHash (Join-Path $lab 'isolated-release.lock')).Hash.ToLower()}
 if($scenario -eq 'marker-drift'){$approval.owner_marker_sha256='0'*64}
 if($scenario -eq 'raw-drift'){[IO.File]::WriteAllText((Join-Path $prod 'future.js'),'changed')}
 $approval|ConvertTo-Json|Set-Content (Join-Path $lab 'approval.json')
 $entry=Get-Content (Join-Path $PSScriptRoot 'Invoke-StockOnlyRecovery.ps1') -Raw
 $mocks=@'
function Assert-SealedOwnerPackage($c){}
function Assert-InstalledOwnerTrust($c){}
function Get-RuntimeInventory($c){return (Get-Content (Join-Path $PSScriptRoot 'runs/old/preserved-future-identity.json') -Raw|ConvertFrom-Json -AsHashtable)}
$script:tasks=@{}
foreach($x in (Get-Content (Join-Path $PSScriptRoot 'formal-binding.json') -Raw|ConvertFrom-Json -AsHashtable).tasks){$script:tasks[$x.binding.name]=$x.binding.Clone();$script:tasks[$x.binding.name].enabled='false'}
function Get-TaskBinding($Name){$script:tasks[$Name].Clone()}
function Restore-BoundTask($Expected){$script:tasks[$Expected.name].enabled=$Expected.enabled;return $script:tasks[$Expected.name]}
function Invoke-PairedVerifier($Config,$Sha){if($Sha -ne $Config.expected){throw 'BAD_RECOVERY_SHA'};return @{ok=$true}}
function git { $global:LASTEXITCODE=0;return ('a'*40) }
'@
 if($scenario -in @('after-deploy','after-crash')){$mocks=$mocks.Replace("return ('a'*40)",("return '"+$config.target+"'"))}
 if($scenario -eq 'unknown-sha'){$mocks=$mocks.Replace("return ('a'*40)","return ('f'*40)")}
 $entry=$entry.Replace('Assert-SealedOwnerPackage $c;Assert-InstalledOwnerTrust $c',($mocks+"`nAssert-SealedOwnerPackage `$c;Assert-InstalledOwnerTrust `$c"))
 $entry=$entry.Replace("'C:/fuman-release-owner/final-release-deployment.lock'",("'"+(Join-Path $lab 'isolated-release.lock')+"'"))
 $entry=$entry.Replace('if($minute -ge 360 -and $minute -lt 812)','if($false)')
 $entry=$entry.Replace("if(!([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))","if(`$false)")
 Set-Content (Join-Path $lab 'entry.ps1') $entry
 $output=& pwsh -NoProfile -File (Join-Path $lab 'entry.ps1') -RunDirectory $run -ApprovalFile (Join-Path $lab 'approval.json') -Apply 2>&1
 $code=$LASTEXITCODE;$output|Out-String|Set-Content (Join-Path $lab 'output.txt')
 $expectedError=switch($scenario){'marker-drift'{'EXACT_STOCK_RECOVERY_APPROVAL_REQUIRED'} 'raw-drift'{'PRESERVED_BYTES_CHANGED'} 'unknown-sha'{'RECOVERY_RELEASE_UNKNOWN'}}
 $pass=if($scenario -in @('normal','after-deploy','after-crash')){$code -eq 0 -and !(Test-Path $marker)}else{$code -ne 0 -and (Test-Path $marker) -and ($output|Out-String).Contains($expectedError)}
 $results+=@{scenario=$scenario;exit=$code;pass=$pass;lab=$lab}
}
$r=@{status=$(if(@($results|Where-Object {!$_.pass}).Count){'BLOCKED'}else{'ISOLATED_STOCK_RECOVERY_ENTRY_PASS'});results=$results;formal_execution=$false;scope='Exact recovery entry with simulated admin/time/trust/process/task/Git boundaries, real local mutex/file/marker and preservation verifier; pre-deployment and real Git/runtime pair rollback branches; installed trust and process visibility simulated'}
$r|ConvertTo-Json -Depth 8|Set-Content (Join-Path $root 'receipt.json')
$r|ConvertTo-Json -Depth 8
if($r.status -eq 'BLOCKED'){exit 1}
