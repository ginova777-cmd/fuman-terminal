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
  $records+=@{pid=[int]$p.ProcessId;creation_ticks=$live.StartTime.ToUniversalTime().Ticks;exe=$p.ExecutablePath;role=$role;command_sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($p.CommandLine))).ToLower();entry_verified=($command -match ('(?:^|[\s"])'+[regex]::Escape($entry)+'(?=$|[\s"])'))}
 }
 return $records
}
function Assert-OnlyBoundFuture($Config,$Expected) {
 $all=@(Get-RuntimeInventory $Config)
 foreach($p in $all){if(!$Expected -or $p.role -ne 'future' -or $p.pid -ne $Expected.pid -or $p.creation_ticks -ne $Expected.creation_ticks -or $p.exe -ne $Expected.exe -or !$p.entry_verified){throw 'RUNTIME_OCCUPANCY_NOT_EXCLUSIVELY_BOUND'}}
 if($Expected -and $all.Count -ne 1){throw 'BOUND_FUTURE_NOT_UNIQUE'}
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
 $p=[Diagnostics.Process]::Start($start)
 $null=$p.Handle
 $identity=@{pid=$p.Id;creation_ticks=$p.StartTime.ToUniversalTime().Ticks;exe=$start.FileName;entry=$entry;started_at=[DateTimeOffset]::UtcNow.ToString('o')}
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
function Stop-NewBoundFuture($Config,$Identity) {
 $p=Get-BoundProcess $Identity;$p.Dispose()
 $raw=& pwsh -NoProfile -File (Join-Path $Config.prod 'ops/Request-FutoptGracefulStop.ps1') -RuntimeDir $Config.runtime -Request -Confirm:$false -WaitSeconds 90
 if($LASTEXITCODE -ne 0){throw 'NEW_SAFE_STOP_FAILED_NO_CHECKOUT'}
 $r=$raw|ConvertFrom-Json
 if($r.status -ne 'STOP_VERIFIED' -or $r.pid -ne $Identity.pid){throw 'NEW_STOP_RECEIPT_UNVERIFIED'}
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
