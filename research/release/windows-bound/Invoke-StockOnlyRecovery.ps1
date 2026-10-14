[CmdletBinding()]
param([Parameter(Mandatory)][string]$RunDirectory,[Parameter(Mandatory)][string]$ApprovalFile,[switch]$Apply)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ProductionMaintenanceBinding.ps1')
. (Join-Path $PSScriptRoot 'ProductionRuntimePorts.ps1')
. (Join-Path $PSScriptRoot 'StockOnlyRuntimePorts.ps1')
$c=Get-Content (Join-Path $PSScriptRoot 'release-config.json') -Raw|ConvertFrom-Json -AsHashtable
Assert-SealedOwnerPackage $c;Assert-InstalledOwnerTrust $c
if($c.cutover_scope -ne 'STOCK_ONLY_PRESERVE_FUTURES'){throw 'STOCK_SCOPE_REQUIRED'}
$run=[IO.Path]::GetFullPath($RunDirectory);$allowed=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'runs'))+'\'
if(!$run.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'RECOVERY_RUN_OUTSIDE_PACKAGE'}
foreach($p in @($run,(Join-Path $run 'release'))){if((Test-Path $p) -and ((Get-Item $p).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'RECOVERY_REPARSE_REJECTED'}}
$a=Get-Content -LiteralPath $ApprovalFile -Raw|ConvertFrom-Json -AsHashtable
$marker=Join-Path $c.runtime 'state/mother-cutover-maintenance-owner.lock'
$markerHash=(Get-FileHash $marker).Hash.ToLower();$old=Get-Content $marker -Raw|ConvertFrom-Json -AsHashtable -DateKind String
if($a.action -ne 'STOCK_ONLY_DEAD_RECOVERY' -or $a.target -ne $c.target -or $a.package_sha256 -ne $c.package_sha256 -or $a.owner_marker_sha256 -ne $markerHash -or $a.run_directory -ne $run){throw 'EXACT_STOCK_RECOVERY_APPROVAL_REQUIRED'}
$now=[DateTimeOffset]::UtcNow
if($now -lt [DateTimeOffset]::Parse($a.not_before) -or $now -ge [DateTimeOffset]::Parse($a.expires_at)){throw 'RECOVERY_WINDOW_NOT_ACTIVE'}
$tw=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($now,'Taipei Standard Time');$minute=$tw.Hour*60+$tw.Minute
if($minute -ge 360 -and $minute -lt 812){throw 'RECOVERY_LIVE_STOCK_WINDOW_NOT_SUPPORTED'}
if(Get-Process -Id $old.owner_pid -ErrorAction SilentlyContinue){throw 'ORIGINAL_OWNER_NOT_ABSENT'}
$futureFile=Join-Path $run 'preserved-future-identity.json'
if($old.preserved_future_file -ne $futureFile -or $old.target -ne $c.target -or $a.future_identity_sha256 -ne (Get-FileHash $futureFile).Hash.ToLower()){throw 'RECOVERY_FUTURE_BINDING_DRIFT'}
$future=Get-Content $futureFile -Raw|ConvertFrom-Json -AsHashtable -DateKind String
$binding=Get-Content (Join-Path $PSScriptRoot 'formal-binding.json') -Raw|ConvertFrom-Json -AsHashtable
if($binding.tasks.Count -ne 2){throw 'RECOVERY_TWO_TASK_SCOPE_REQUIRED'}
$null=Resolve-HandbackTasks $binding
foreach($item in $binding.tasks){Assert-HandbackDefinition $item.binding;if((Get-TaskBinding $item.binding.name).state -eq 'Running'){throw 'RECOVERY_TASK_RUNNING'}}
Assert-OnlyBoundFuture $c $future
$head=(& git -C $c.prod rev-parse HEAD).Trim();if($LASTEXITCODE -ne 0 -or $head -notin @($c.expected,$c.target)){throw 'RECOVERY_RELEASE_UNKNOWN'}
$readback=Join-Path $run ('recovery-review-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $readback|Out-Null
# The preservation verifier reads the original identity from this run.
Assert-PreservedStockFuture $c $future $run
if(!$Apply){@{status='STOCK_RECOVERY_REVIEW_REQUIRED';head=$head;formal_mutations=$false;marker_sha256=$markerHash}|ConvertTo-Json;return}
if(!([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
$owner=New-ProductionOwner $binding (Join-Path $readback 'maintenance-state.json');$owned=$null;$completed=$false;$taken=$false
try {
 $owner.db=[IO.File]::Open($binding.locks.database_round,'OpenOrCreate','ReadWrite','None')
 $owner.stock=Enter-BoundMutexes @($binding.locks.stock);$owner.writer=Enter-BoundMutexes @($binding.locks.writer)
 Assert-HeldFence $owner;Assert-PreservedStockFuture $c $future $run
 if((Get-FileHash $marker).Hash.ToLower() -ne $markerHash -or (Get-Process -Id $old.owner_pid -ErrorAction SilentlyContinue)){throw 'RECOVERY_MARKER_OR_OWNER_CHANGED'}
 if([DateTimeOffset]::UtcNow -ge [DateTimeOffset]::Parse($a.expires_at)){throw 'RECOVERY_APPROVAL_EXPIRED_BEFORE_TAKEOVER'}
 $claimed=Join-Path $readback 'original-owner-marker.json';[IO.File]::Move($marker,$claimed,$false)
 $owned=[IO.File]::Open($marker,'CreateNew','ReadWrite','Read');$taken=$true
 $identity=@{owner_pid=$PID;creation_ticks=[string](Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks;target=$c.target;token=$owner.token;maintenance_verified=$true;approval_not_before=$a.not_before;approval_expires_at=$a.expires_at;preserved_future_file=$futureFile;recovery_parent=$old}
 $bytes=[Text.Encoding]::UTF8.GetBytes(($identity|ConvertTo-Json -Depth 10));$owned.Write($bytes);$owned.Flush($true)
 # Gate must remain beside the exact preserved identity expected by ReleaseOperation.
 $gate=Join-Path $run 'recovery-owner-gate.json';Write-CutoverReceipt $gate $identity
 $release=Join-Path $run 'release';$backup=Join-Path $release 'authority-before.bin'
 if(Test-Path $backup){
  $rb=Join-Path $release 'rollback-receipt.json';if((Test-Path $rb) -and (Get-Content $rb -Raw|ConvertFrom-Json).status -eq 'FAILED'){throw 'FAILED_ROLLBACK_REQUIRES_SEPARATE_REPAIR'}
  $raw=& node (Join-Path $PSScriptRoot 'ReleaseOperation.cjs') rollback $release $gate
  if($LASTEXITCODE -ne 0 -or ($raw|ConvertFrom-Json).status -ne 'RESTORED'){throw 'STOCK_RECOVERY_ROLLBACK_FAILED'}
 }else{Invoke-PairedVerifier $c $c.expected|Out-Null;foreach($f in $binding.files){if((Get-FileHash $f.path).Hash.ToLower() -ne $f.sha256){throw 'PREDEPLOY_RUNTIME_DRIFT'}}}
 Invoke-PairedVerifier $c $c.expected|Out-Null;Assert-PreservedStockFuture $c $future $run
 Release-StockBinding $owner
 Restore-StockOnlyWriterBinding $owner {Assert-PreservedStockFuture $c $future $run}
 Restore-ProductionFence $owner
 Write-CutoverReceipt (Join-Path $readback 'receipt.json') @{status='STOCK_ONLY_RECOVERY_VERIFIED';sha=$c.expected;future_preserved=$true;natural_acceptance='NOT_OBSERVED';original_marker_sha256=$markerHash}
 $completed=$true
 @{status='STOCK_ONLY_RECOVERY_VERIFIED';receipt=(Join-Path $readback 'receipt.json')}|ConvertTo-Json
}finally{
 if($owned){$owned.Dispose()}
 if($completed){Remove-Item -LiteralPath $marker -ErrorAction Stop}
 # On failure retain marker and current task state. Release only our handles;
 # another recovery needs a fresh exact marker authorization.
 if($owner.stock){Exit-BoundMutexes $owner.stock};if($owner.writer){Exit-BoundMutexes $owner.writer};if($owner.db){$owner.db.Dispose()}
}
