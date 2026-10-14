Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Assert-StockOnlyApproval($Config,$Approval) {
 Assert-OwnerApproval $Config $Approval
 if($Config.cutover_scope -ne 'STOCK_ONLY_PRESERVE_FUTURES' -or $Approval.cutover_scope -ne $Config.cutover_scope -or $Approval.batch_id -ne 'Batch 0' -or $Approval.stock_preservation_sha256 -ne $Config.stock_preservation_sha256){throw 'EXACT_STOCK_ONLY_APPROVAL_REQUIRED'}
 if($Approval.future_stop_allowed -ne $false -or $Approval.future_start_allowed -ne $false){throw 'FUTURES_CONTROL_NOT_AUTHORIZED'}
}
function Assert-PreservedStockFuture($Config,$Identity,$Out) {
 $inventory=@(Get-RuntimeInventory $Config)
 $identityFile=Join-Path $Out 'preserved-future-identity.json'
 if(!(Test-Path -LiteralPath $identityFile)){throw 'PRESERVED_IDENTITY_FILE_REQUIRED'}
 $saved=Get-Content -LiteralPath $identityFile -Raw|ConvertFrom-Json -AsHashtable -DateKind String
 foreach($key in @('pid','creation_ticks','exe','entry','command_sha256')){if([string]$saved[$key] -cne [string]$Identity[$key]){throw 'PRESERVED_IDENTITY_CHANGED'}}
 $inventoryFile=Join-Path $Out 'preservation-inventory.json'
 Write-CutoverReceipt $inventoryFile @{inventory=@($inventory|ForEach-Object {$copy=$_.Clone();$copy.creation_ticks=[string]$copy.creation_ticks;$copy})}
 $raw=& node (Join-Path $PSScriptRoot 'StockPreservationOperation.cjs') $identityFile $inventoryFile
 if($LASTEXITCODE -ne 0){throw 'FUTURES_PRESERVATION_FAILED'}
 $proof=$raw|ConvertFrom-Json
 if($proof.status -ne 'PRESERVED_BOUND_FILES_AND_IDENTITY'){throw 'FUTURES_PRESERVATION_UNVERIFIED'}
 Write-CutoverReceipt (Join-Path $Out 'preservation-last-readback.json') $proof
}
function Restore-StockOnlyWriterBinding($Owner,[scriptblock]$AssertPreserved) {
 if(!$Owner.stock_handed_back -or !$AssertPreserved -or !$Owner.db -or !$Owner.writer){throw 'STOCK_ONLY_HANDBACK_ORDER'}
 & $AssertPreserved
 $roles=Resolve-HandbackTasks $Owner.binding
 foreach($task in @($roles.stock)+@($roles.remaining)){Assert-HandbackDefinition $task}
 # No future transport/market-health success is manufactured by this handback.
 Exit-BoundMutexes $Owner.writer;$Owner.writer=$null
 $Owner.db.Dispose();$Owner.db=$null
 foreach($task in $roles.remaining){Restore-BoundTask $task|Out-Null}
 $Owner.writer_handed_back=$true;Write-OwnerState $Owner 'STOCK_ONLY_WRITER_TASKS_RESTORED'
}
