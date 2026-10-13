Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Get-RecoveryReleaseLock { 'C:/fuman-release-owner/final-release-deployment.lock' }
function Assert-RecoveryReleaseLockIdentity($Raw,$Config){
 if($Raw['pid'] -isnot [long] -and $Raw['pid'] -isnot [int] -or $Raw.pid -le 0){throw 'RECOVERY_RELEASE_LOCK_IDENTITY_UNKNOWN'}
 if($Raw['action'] -ceq 'rollback'){return}
 # deploy-core Apply locks predate the action field. Accept only the exact reviewed target-bound shape.
 if($Raw.Contains('action') -or $Raw['target'] -cne $Config.target -or $Raw['token'] -isnot [string] -or $Raw.token -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' -or $Raw['host'] -isnot [string] -or !$Raw.host -or $Raw['started_at'] -isnot [string]){throw 'RECOVERY_RELEASE_LOCK_IDENTITY_UNKNOWN'}
 $stamp=[DateTimeOffset]::MinValue
 if(![DateTimeOffset]::TryParse($Raw.started_at,[ref]$stamp)){throw 'RECOVERY_RELEASE_LOCK_IDENTITY_UNKNOWN'}
}
function Assert-RecoveryWindow {
 $tw=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow,'Taipei Standard Time')
 if(($tw.Hour*60+$tw.Minute) -ge 360 -and ($tw.Hour*60+$tw.Minute) -lt 812){throw 'RECOVERY_LIVE_STOCK_WINDOW_BLOCKED'}
}
function Assert-RecoveryReleaseJournal($Config,$Directory,$Bundle,$Request){
 $release=$Bundle.state.release
 if([IO.Path]::GetFullPath($release) -cne [IO.Path]::GetFullPath((Join-Path (Split-Path $Directory) 'release'))){throw 'RECOVERY_RELEASE_PATH_MISMATCH'}
 Assert-RecoveryNoReparse (Split-Path $Directory) $release
 $hashes=@{}
 foreach($name in @('authority-before.bin','production-before.json','deployment-receipt.json','rollback-receipt.json','runtime-pair-journal.json','runtime-before-0.bin','runtime-before-1.bin')){
  $p=Join-Path $release $name
  if(Test-Path $p){Assert-RecoveryNoReparse $release $p;$hashes[$name]=Get-RecoveryHash $p}
 }
 if(!$hashes.Contains('authority-before.bin') -or !$hashes.Contains('production-before.json') -or !$hashes.Contains('deployment-receipt.json')){throw 'RECOVERY_RELEASE_JOURNAL_INCOMPLETE'}
 if(!$Request.Contains('release_journal') -or $Request.release_journal.Count -ne $hashes.Count){throw 'RECOVERY_RELEASE_JOURNAL_GO_REQUIRED'}
 foreach($k in $hashes.Keys){if($Request.release_journal[$k] -cne $hashes[$k]){throw 'RECOVERY_RELEASE_JOURNAL_DRIFT'}}
 $before=Get-Content "$release/production-before.json" -Raw|ConvertFrom-Json -AsHashtable
 $auth=Get-Content "$release/authority-before.bin" -Raw|ConvertFrom-Json -AsHashtable
 $journal=Get-Content "$release/deployment-receipt.json" -Raw|ConvertFrom-Json -AsHashtable
 if($before.head -cne $Config.expected -or $before.authority_sha256 -cne $hashes['authority-before.bin'] -or $auth.approvedProductionSha -cne $Config.expected -or $journal.target -cne $Config.target -or $journal.expected -cne $Config.expected){throw 'RECOVERY_RELEASE_EXACT_IDENTITY'}
 return $hashes
}
function Invoke-RecoveryRollback($Config,$Directory,$Bundle,$Request,$Gate){
 if($Request['allow_rollback'] -isnot [bool] -or !$Request.allow_rollback){throw 'RECOVERY_ROLLBACK_GO_REQUIRED'}
 $null=Assert-RecoveryReleaseJournal $Config $Directory $Bundle $Request
 Assert-OnlyBoundFuture $Config $null
 $lockPath=Get-RecoveryReleaseLock
 if(Test-Path $lockPath){
  if(!$Request['failed_release_lock_sha256'] -or (Get-RecoveryHash $lockPath) -cne $Request.failed_release_lock_sha256){throw 'RECOVERY_RELEASE_LOCK_UNKNOWN'}
  $raw=Get-Content $lockPath -Raw|ConvertFrom-Json -AsHashtable
  Assert-RecoveryReleaseLockIdentity $raw $Config
  if(Get-Process -Id $raw.pid -ErrorAction SilentlyContinue){throw 'RECOVERY_RELEASE_LOCK_OWNER_ALIVE'}
  # Archive exactly the reviewed failed rollback marker. Unknown locks stay put.
  $archive="$Directory/attempts/$($Request.request_id)/failed-release-lock.json"
  [IO.File]::Move($lockPath,$archive,$false)
  if((Get-RecoveryHash $archive) -cne $Request.failed_release_lock_sha256){throw 'RECOVERY_RELEASE_LOCK_ARCHIVE_DRIFT'}
 }
 $result=& node (Join-Path $PSScriptRoot 'ReleaseOperation.cjs') 'rollback' $Bundle.state.release $Gate
 if($LASTEXITCODE -ne 0){throw 'RECOVERY_RELEASE_OPERATION_FAILED'}
 $r=$result|ConvertFrom-Json -AsHashtable
 if($r.status -cne 'RESTORED' -or $r.sha -cne $Config.expected){throw 'RECOVERY_ROLLBACK_UNVERIFIED'}
 Invoke-PairedVerifier $Config $Config.expected|Out-Null
 if((Get-RecoveryHash $Config.authority) -cne (Get-RecoveryHash "$($Bundle.state.release)/authority-before.bin")){throw 'RECOVERY_AUTHORITY_BYTES_NOT_RESTORED'}
 Write-CutoverReceipt "$Directory/attempts/$($Request.request_id)/rollback-readback.json" $r
}
