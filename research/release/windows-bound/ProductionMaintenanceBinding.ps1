Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'WindowsScheduleBinding.ps1')

function Assert-SealedOwnerPackage($Config) {
 $file=Join-Path $PSScriptRoot 'tool-manifest.json'
 if((Get-FileHash -LiteralPath $file).Hash.ToLower() -ne $Config.package_sha256){throw 'TOOL_MANIFEST_DRIFT'}
 $m=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json
 foreach($item in $m.files){
  $path=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot $item.path))
  if(!$path.StartsWith($PSScriptRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'TOOL_PATH_OUTSIDE_PACKAGE'}
  if((Get-FileHash -LiteralPath $path).Hash.ToLower() -ne $item.sha256 -or (Get-Item -LiteralPath $path).Length -ne $item.bytes){throw ('TOOL_FILE_DRIFT:'+ $item.path)}
 }
 foreach($property in $m.config_identity.PSObject.Properties){if($Config[$property.Name] -ne $property.Value){throw ('TOOL_CONFIG_IDENTITY_DRIFT:'+ $property.Name)}}
}

# No top-level mutation. Same functions are exercised with isolated Windows ports.
# A caller must keep this PowerShell thread alive for the lifetime of held mutexes.
function Assert-OwnerApproval($Config,$Approval) {
 if(!$Approval -or $Approval.action -ne 'CONTROLLED_CUTOVER_APPLY' -or
    $Approval.target -ne $Config.target -or $Approval.binding_sha256 -ne $Config.binding_sha256 -or
    $Approval.package_sha256 -ne $Config.package_sha256){throw 'EXACT_OWNER_APPLY_APPROVAL_REQUIRED'}
 $now=[DateTimeOffset]::UtcNow
 if($now -lt [DateTimeOffset]::Parse($Approval.not_before) -or $now -ge [DateTimeOffset]::Parse($Approval.expires_at)){throw 'APPROVAL_WINDOW_NOT_ACTIVE'}
 if(!$Config.release_approved -or !$Config.remote_main_verified){throw 'RELEASE_NOT_APPROVED_OR_MAIN_UNVERIFIED'}
}
function Assert-ProductionBinding($Binding) {
 foreach($file in $Binding.files){
  if((Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash.ToLower() -ne $file.sha256){throw ('FILE_BINDING_DRIFT:'+ $file.path)}
 }
 foreach($task in $Binding.tasks){
  $actual=Get-TaskBinding $task.binding.name
  if($actual.path -ne $task.binding.path -or $actual.definition_sha256 -ne $task.binding.definition_sha256 -or $actual.enabled -ne $task.binding.enabled){throw ('TASK_BINDING_DRIFT:'+ $task.binding.name)}
 }
}
function Write-OwnerState($Owner,$Stage) {
 $Owner.stage=$Stage
 $record=[ordered]@{owner_pid=$PID;owner_started_at=$Owner.owner_started_at;token=$Owner.token;stage=$Stage;at=[DateTimeOffset]::UtcNow.ToString('o');suspended=@($Owner.suspended|ForEach-Object {$_.name});stock_handed_back=$Owner.stock_handed_back;writer_handed_back=$Owner.writer_handed_back;manual_recovery_required=$Owner.manual_recovery_required}
 $file=$Owner.receipt
 $tmp=$file+'.tmp';[IO.File]::WriteAllText($tmp,($record|ConvertTo-Json -Depth 8));[IO.File]::Move($tmp,$file,$true)
}
function New-ProductionOwner($Binding,$Receipt) {
 # A unique receipt path is required; no stale owner takeover.
 if(Test-Path -LiteralPath $Receipt){throw 'OWNER_RECEIPT_EXISTS'}
 @{binding=$Binding;receipt=$Receipt;token=[guid]::NewGuid().ToString();owner_started_at=[DateTimeOffset]::UtcNow.ToString('o');stage='NEW';suspended=[Collections.Generic.List[object]]::new();db=$null;stock=$null;writer=$null;stock_handed_back=$false;writer_handed_back=$false;manual_recovery_required=$false;start_recorded=$false}
}
function Enter-ProductionFence($Owner,$Config,$Approval) {
 Assert-OwnerApproval $Config $Approval
 Assert-ProductionBinding $Owner.binding
 Write-OwnerState $Owner 'FENCE_INTENT'
 try {
  # Suspend-BoundTask refuses Running. Never stop a running task to obtain idle.
  foreach($item in $Owner.binding.tasks){
   # Track intent before mutation so a failed readback still has a restore obligation.
   $Owner.suspended.Add($item.binding)
   Suspend-BoundTask $item.binding|Out-Null
   Write-OwnerState $Owner 'TASK_FENCED'
  }
  $Owner.db=[IO.File]::Open($Owner.binding.locks.database_round,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  $Owner.stock=Enter-BoundMutexes @($Owner.binding.locks.stock)
  $Owner.writer=Enter-BoundMutexes @($Owner.binding.locks.writer)
  Write-OwnerState $Owner 'FENCED'
 } catch {
  $original=$_.Exception.Message
  try {Restore-ProductionFence $Owner} catch { $Owner.manual_recovery_required=$true;Write-OwnerState $Owner 'MANUAL_RECOVERY_REQUIRED';throw ('FENCE_FAILED_AND_RESTORE_FAILED:'+ $original+';'+$_.Exception.Message) }
  throw $original
 }
}
function Release-StockBinding($Owner) {
 if(!$Owner.db -or !$Owner.writer){throw 'WRITER_FENCE_REQUIRED_FOR_STOCK_HANDBACK'}
 if($Owner.stock){Exit-BoundMutexes $Owner.stock;$Owner.stock=$null}
 Restore-BoundTask $Owner.binding.tasks[0].binding|Out-Null
 $Owner.stock_handed_back=$true;Write-OwnerState $Owner 'STOCK_TASK_RESTORED'
}
function Start-BoundStockOnce($Owner,$ResumeEvidence) {
 if(!$Owner.stock_handed_back -or $Owner.stock -or !$Owner.db -or !$Owner.writer){throw 'HANDBACK_ORDER_INVALID'}
 if($Owner.start_recorded){throw 'START_ALREADY_REQUESTED_READBACK_REQUIRED'}
 if(!$ResumeEvidence.calendar_verified -or !$ResumeEvidence.market_open -or !$ResumeEvidence.inventory_complete -or $ResumeEvidence.collector_count -ne 0){throw 'STOCK_RESUME_EVIDENCE_INVALID'}
 $now=[DateTimeOffset]::UtcNow
 $age=($now-[DateTimeOffset]::Parse($ResumeEvidence.checked_at)).TotalSeconds
 if($age -lt 0 -or $age -gt 15){throw 'STOCK_INVENTORY_STALE'}
 $tw=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($now,'Taipei Standard Time');$minute=$tw.Hour*60+$tw.Minute
 if($tw.ToString('yyyy-MM-dd') -ne $ResumeEvidence.trade_date -or $minute -lt 360 -or $minute -ge 810){throw 'STOCK_RESUME_OUTSIDE_WINDOW'}
 $task=$Owner.binding.tasks[0].binding;$actual=Get-TaskBinding $task.name
 if($actual.definition_sha256 -ne $task.definition_sha256 -or $actual.path -ne $task.path -or $actual.enabled -ne 'true' -or $actual.state -eq 'Running'){throw 'STOCK_TASK_CHANGED_OR_ALREADY_RUNNING'}
 $Owner.start_recorded=$true;Write-OwnerState $Owner 'STOCK_START_INTENT'
 Start-ScheduledTask -TaskName $task.name -TaskPath $task.path
 # Caller must independently read PID/create-time/entry/release/supervisor. No PASS here.
 Write-OwnerState $Owner 'STOCK_START_READBACK_REQUIRED'
}
function Assert-FutoptWriterHandback($Identity,$Status,$ExpectedRelease) {
 $now=[DateTimeOffset]::UtcNow
 if(!$Identity.unique -or !$Identity.creation_verified -or !$Identity.entry_verified -or !$Identity.alive){throw 'FUTOPT_IDENTITY_UNVERIFIED'}
 if([int]$Status.pid -ne [int]$Identity.pid -or $Status.collector_release -ne $ExpectedRelease){throw 'FUTOPT_RELEASE_OR_PID_MISMATCH'}
 $age=($now-[DateTimeOffset]::Parse($Status.updatedAt)).TotalSeconds
 if($age -lt 0 -or $age -gt 90){throw 'FUTOPT_TRANSPORT_STALE_OR_FUTURE'}
 $transport=if($Status.transportHealth){$Status.transportHealth.last_transport_at}else{$Status.lastMessageAt}
 if(!$transport){throw 'FUTOPT_TRANSPORT_TIME_MISSING'}
 $transportAge=($now-[DateTimeOffset]::Parse($transport)).TotalSeconds
 if($transportAge -lt 0 -or $transportAge -gt 300){throw 'FUTOPT_TRANSPORT_STALE_OR_FUTURE'}
 # Quality readiness is deliberately separate. A current v8 process with a
 # catalogue blocker is not converted into a healthy quote source.
 $healthy=$true
 foreach($key in @('ok','formalReady','websocketConnected','websocketAuthenticated')){if($Status.$key -isnot [bool] -or !$Status.$key){$healthy=$false}}
 if(![string]::IsNullOrWhiteSpace([string]$Status.error)){$healthy=$false}
 @{transport_identity_pass=$true;quality_gate_pass=$healthy;source_status=$Status}
}
function Restore-WriterBinding($Owner,$TransportProof) {
 if(!$Owner.stock_handed_back -or !$TransportProof.transport_identity_pass){throw 'WRITER_HANDBACK_NOT_VERIFIED'}
 if($Owner.writer){Exit-BoundMutexes $Owner.writer;$Owner.writer=$null}
 if($Owner.db){$Owner.db.Dispose();$Owner.db=$null}
 foreach($item in @($Owner.binding.tasks|Select-Object -Skip 1)){Restore-BoundTask $item.binding|Out-Null}
 $Owner.writer_handed_back=$true;Write-OwnerState $Owner 'WRITER_TASKS_RESTORED'
}
function Restore-ProductionFence($Owner) {
 # Call only on pre-stop failure, or after successful runtime recovery.
 if($Owner.manual_recovery_required){throw 'MANUAL_RECOVERY_OWNERSHIP_RETAINED'}
 if($Owner.stock){Exit-BoundMutexes $Owner.stock;$Owner.stock=$null}
 if($Owner.writer){Exit-BoundMutexes $Owner.writer;$Owner.writer=$null}
 if($Owner.db){$Owner.db.Dispose();$Owner.db=$null}
 foreach($task in $Owner.suspended){Restore-BoundTask $task|Out-Null}
 Write-OwnerState $Owner 'FENCE_RESTORED'
}
