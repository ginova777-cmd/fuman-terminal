Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'LegacyBoundary.ps1')
function Get-RuntimeInventory($Config) {
 $items=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^(node|pwsh|powershell)\.exe$'})
 $unknown=@($items|Where-Object {!$_.CommandLine -or !$_.ExecutablePath})
 if($unknown.Count){throw 'PROCESS_INVENTORY_INCOMPLETE_ADMIN_REQUIRED'}
 $prodPattern=[regex]::Escape($Config.prod.Replace('/','\').TrimEnd('\')+'\')
 $records=@()
 foreach($p in $items){
  $command=$p.CommandLine.Replace('/','\')
  $role=if($command -match 'fugle-futopt-websocket-collector\.js'){'future'}elseif($command -match 'fugle-websocket-collector\.js'){'stock'}elseif($command -match 'run-daytrade-source-writer\.js|Run-DaytradeSourceWriter\.ps1'){'writer'}elseif($command -match $prodPattern){'other-production'}else{continue}
  $live=Get-Process -Id $p.ProcessId -ErrorAction Stop
  $entry=(Join-Path $Config.prod ('scripts\'+$(if($role -eq 'future'){'fugle-futopt-websocket-collector.js'}else{'fugle-websocket-collector.js'}))).Replace('/','\')
  $records+=@{pid=[int]$p.ProcessId;parent_pid=[int]$p.ParentProcessId;entry=$entry;creation_ticks=$live.StartTime.ToUniversalTime().Ticks;exe=$p.ExecutablePath;role=$role;command_sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($p.CommandLine))).ToLower();entry_verified=($command -match ('(?:^|[\s"])'+[regex]::Escape($entry)+'(?=$|[\s"])'))}
 }
 return $records
}
function Throw-RuntimeOccupancyFailure($Code,$Expected,$All,$Offending) {
 $differences=@()
 if($null -ne $Offending){
  if(!$Expected){$differences+=@{field='expected';expected=$null;actual='occupant_present'}}
  else {
   foreach($field in @('role','pid','creation_ticks','exe','entry_verified')) {
    $wanted=if($field -eq 'role'){'future'}elseif($field -eq 'entry_verified'){$true}else{$Expected[$field]}
    if($Offending[$field] -ne $wanted){$differences+=@{field=$field;expected=[string]$wanted;actual=[string]$Offending[$field]}}
   }
  }
 }else{$differences+=@{field='count';expected=1;actual=$All.Count}}
 $e=[InvalidOperationException]::new($Code)
 # JSON ticks are strings so downstream readers do not round Windows identity.
 $snapshot=@($All|ForEach-Object { $copy=@{};foreach($k in $_.Keys){$copy[$k]=$_[$k]};$copy.creation_ticks=[string]$copy['creation_ticks'];$copy })
 $expectedCopy=$null
 if($Expected){$expectedCopy=@{};foreach($k in $Expected.Keys){$expectedCopy[$k]=$Expected[$k]};$expectedCopy.creation_ticks=[string]$expectedCopy.creation_ticks}
 $e.Data['RuntimeOccupancyEvidence']=@{schema='runtime_occupancy_failure_v1';observed_at=[DateTimeOffset]::UtcNow.ToString('o');code=$Code;expected=$expectedCopy;inventory=$snapshot;first_mismatch_pid=$(if($null -ne $Offending){$Offending.pid}else{$null});differences=$differences}
 throw $e
}
function Assert-OnlyBoundFuture($Config,$Expected) {
 $all=@(Get-RuntimeInventory $Config)
 foreach($p in $all){if(!$Expected -or $p.role -ne 'future' -or $p.pid -ne $Expected.pid -or $p.creation_ticks -ne $Expected.creation_ticks -or $p.exe -ne $Expected.exe -or !$p.entry_verified){Throw-RuntimeOccupancyFailure 'RUNTIME_OCCUPANCY_NOT_EXCLUSIVELY_BOUND' $Expected $all $p}}
 if($Expected -and $all.Count -ne 1){Throw-RuntimeOccupancyFailure 'BOUND_FUTURE_NOT_UNIQUE' $Expected $all $null}
}
function Test-EvidenceOff($Config) {
 foreach($scope in @('Process','User','Machine')){if([Environment]::GetEnvironmentVariable('FUMAN_CHANGE_EVIDENCE_PHASE1',$scope) -eq '1'){throw 'EVIDENCE_ENABLE_PRESENT'}}
 $binding=Get-Content (Join-Path $PSScriptRoot 'formal-binding.json') -Raw|ConvertFrom-Json
 $launcher=$binding.files[0].path
 if((Get-Content -LiteralPath $launcher -Raw) -match 'FUMAN_CHANGE_EVIDENCE_PHASE1[^\r\n]*[=:]\s*[''"]?1'){throw 'EVIDENCE_LAUNCHER_ENABLE_PRESENT'}
}
function Invoke-PairedVerifier($Config,$Sha) {
 $raw=& node $Config.verifier --require-production-root
 if($LASTEXITCODE -ne 0){throw 'AUTHORITY_VERIFIER_FAILED'}
 $r=$raw|ConvertFrom-Json
 if(!$r.ok -or !$r.productionClean -or $r.productionHead -ne $Sha -or $r.approvedProductionSha -ne $Sha){throw 'PAIRED_RELEASE_UNVERIFIED'}
 return $r
}
function Start-BoundFuture($Config,$LogDir) {
 Assert-OnlyBoundFuture $Config $null
 Test-EvidenceOff $Config
 $entry=Join-Path $Config.prod 'scripts/fugle-futopt-websocket-collector.js'
 # Verify the paired release, Git blob and checkout bytes before any START.
 $bindingInput=Join-Path $LogDir 'collector-start-binding-config.json'
 Write-CutoverReceipt $bindingInput $Config
 $bindingRaw=& node (Join-Path $PSScriptRoot 'collector-release-binding.cjs') $bindingInput
 if($LASTEXITCODE -ne 0){throw 'COLLECTOR_START_RELEASE_UNVERIFIED'}
 $releaseBinding=$bindingRaw|ConvertFrom-Json
 $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=(Get-Command node).Source;$start.WorkingDirectory=Split-Path $entry
 $start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $start.ArgumentList.Add('--use-system-ca');$start.ArgumentList.Add($entry)
 # Child-local environment only; no machine/user/current process mutation.
 foreach($pair in @{
  FUMAN_RUNTIME_DIR=$Config.runtime;FUMAN_CACHE_DIR=(Join-Path $Config.runtime 'cache');FUMAN_STATE_DIR=(Join-Path $Config.runtime 'state');
  FUGLE_FUTOPT_STREAMING_CHANNELS='trades,aggregates,candles';FUGLE_FUTOPT_STREAMING_AFTER_HOURS='false';FUGLE_FUTOPT_STREAMING_MAX_TOTAL_SUBSCRIPTIONS='1800';FUGLE_FUTOPT_STREAMING_MAX_SYMBOLS='500';FUGLE_FUTOPT_COLLECTOR_RELEASE='futopt-daytrade-candles-v8';FUMAN_CHANGE_EVIDENCE_PHASE1='0'
 }.GetEnumerator()){$start.Environment[$pair.Key]=[string]$pair.Value}
 # Refuse inherited preload flags. Never carry an offline fixture into production.
 if($start.Environment.ContainsKey('NODE_OPTIONS') -and $start.Environment['NODE_OPTIONS']){throw 'NODE_OPTIONS_REQUIRE_REVIEW'}
 $launchReceipt=Join-Path $LogDir 'collector-launch-receipt.json'
 $launchSpec=Join-Path $LogDir 'collector-launch-spec.json'
 $envMap=@{};foreach($key in @('FUMAN_RUNTIME_DIR','FUMAN_CACHE_DIR','FUMAN_STATE_DIR','FUGLE_FUTOPT_STREAMING_CHANNELS','FUGLE_FUTOPT_STREAMING_AFTER_HOURS','FUGLE_FUTOPT_STREAMING_MAX_TOTAL_SUBSCRIPTIONS','FUGLE_FUTOPT_STREAMING_MAX_SYMBOLS','FUGLE_FUTOPT_COLLECTOR_RELEASE','FUMAN_CHANGE_EVIDENCE_PHASE1')){$envMap[$key]=$start.Environment[$key]}
 Write-CutoverReceipt $launchSpec @{exe=$start.FileName;entry=$entry;entry_hash=$releaseBinding.runtime_sha256;environment=$envMap;receipt=$launchReceipt}
 $launch=[Diagnostics.ProcessStartInfo]::new();$launch.FileName=(Get-Command pwsh).Source
 $launch.UseShellExecute=$true;$launch.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
 $helper=Join-Path $PSScriptRoot 'Start-IsolatedHandleCollector.ps1'
 $launch.Arguments='-NoProfile -File "'+$helper+'" -Spec "'+$launchSpec+'" -SpecHash '+(Get-FileHash $launchSpec).Hash
 $broker=[Diagnostics.Process]::Start($launch)
 if(!$broker.WaitForExit(15000)){throw 'LAUNCHER_TIMEOUT_REQUIRES_REVIEW'}
 if($broker.ExitCode -ne 0 -or !(Test-Path $launchReceipt)){throw 'LAUNCHER_FAILED_REQUIRES_REVIEW'}
 $la=Get-Content $launchReceipt -Raw|ConvertFrom-Json
 if($la.spec_hash -ne (Get-FileHash $launchSpec).Hash -or $la.entry -ne $entry -or $la.entry_hash -ne $releaseBinding.runtime_sha256){throw 'LAUNCH_RECEIPT_DRIFT'}
 $p=Get-Process -Id $la.pid -ErrorAction Stop
 if([string]$p.StartTime.ToUniversalTime().Ticks -ne $la.creation_ticks){throw 'LAUNCH_PID_RECYCLED'}
 $null=$p.Handle
 $identity=@{pid=$p.Id;creation_ticks=$p.StartTime.ToUniversalTime().Ticks;exe=$start.FileName;entry=$entry;started_at=[DateTimeOffset]::UtcNow.ToString('o');release_sha=$releaseBinding.release_sha;runtime_sha256=$releaseBinding.runtime_sha256}
 Write-CutoverReceipt (Join-Path $LogDir 'future-start.json') $identity
 return $identity
}
function Wait-BoundFuture($Config,$Identity,[int]$Seconds=90) {
 $watch=[Diagnostics.Stopwatch]::StartNew();$last='NOT_OBSERVED'
 while($watch.Elapsed.TotalSeconds -lt $Seconds){
  Assert-OnlyBoundFuture $Config $Identity
  $p=Get-BoundProcess $Identity;$p.Dispose()
  try{
   $status=Get-Content -LiteralPath (Join-Path $Config.runtime 'state/fugle-futopt-websocket-status.json') -Raw|ConvertFrom-Json -DateKind String
   $proof=Assert-FutoptWriterHandback @{pid=$Identity.pid;unique=$true;creation_verified=$true;entry_verified=$true;alive=$true} $status 'futopt-daytrade-candles-v8'
   return $proof
  }catch{$last=$_.Exception.Message}
  Start-Sleep -Seconds 1
 }
 throw ('FUTURE_READBACK_TIMEOUT:'+ $last)
}
function Invoke-BoundGracefulStop($Config,$Identity,$OwnerGate,$ReceiptPath) {
 Assert-OnlyBoundFuture $Config $Identity
 # Decimal ticks remain strings; JSON numbers cannot represent Windows ticks exactly.
 $requestIdentity=@{pid=[int]$Identity.pid;creation_ticks=[string]$Identity.creation_ticks;exe=$Identity.exe}
 if($Identity.ContainsKey('release_sha')){$requestIdentity.release_sha=$Identity.release_sha}
 $identityPath=$ReceiptPath+'.identity.json';Write-CutoverReceipt $identityPath $requestIdentity
 $raw=& node (Join-Path $PSScriptRoot 'GracefulOperation.cjs') $OwnerGate $identityPath
 if($LASTEXITCODE -ne 0){
  $failure=$null
  try{$failure=$raw|ConvertFrom-Json -DateKind String -AsHashtable}catch{}
  $ex=[InvalidOperationException]::new('GRACEFUL_STOP_FAILED_NO_FORCE_FALLBACK')
  Write-CutoverReceipt $ReceiptPath @{status='GRACEFUL_STOP_FAILED';exit_code=$LASTEXITCODE;raw_output=@($raw);failure=$failure;force_fallback=$false}
  if($failure -and $failure.status -eq 'GRACEFUL_STOP_BLOCKED' -and $failure.stop_not_requested -is [bool] -and $failure.stop_not_requested -eq $true){
   Write-CutoverReceipt $ReceiptPath $failure
   $ex.Data['StopNotRequested']=$true
  }
  throw $ex
 }
 $r=$raw|ConvertFrom-Json -DateKind String
 if($r.status -ne 'GRACEFUL_STOP_VERIFIED' -or $r.pid -ne $Identity.pid -or !$r.pid_exited){throw 'STOP_RECEIPT_UNVERIFIED'}
 Write-CutoverReceipt $ReceiptPath $r
 Assert-OnlyBoundFuture $Config $null
 return $r
}
function Assert-RollbackNotPreviouslyFailed($ReleaseDirectory) {
 $file=Join-Path $ReleaseDirectory 'rollback-receipt.json'
 if(Test-Path -LiteralPath $file){
  $r=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json
  if($r.status -eq 'FAILED'){throw 'PRIOR_ROLLBACK_FAILED_NO_AUTOMATIC_RETRY'}
 }
}


