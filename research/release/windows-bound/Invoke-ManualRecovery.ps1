[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('LIVE','DEAD')][string]$Mode,
 [Parameter(Mandatory)][string]$RecoveryDirectory,[Parameter(Mandatory)][string]$ApprovalFile)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/ProductionMaintenanceBinding.ps1"
. "$PSScriptRoot/ProductionRuntimePorts.ps1"
. "$PSScriptRoot/CutoverSequence.ps1"
. "$PSScriptRoot/ManualRecovery.ps1"
. "$PSScriptRoot/RecoveryRuntimePorts.ps1"
$config=Get-Content "$PSScriptRoot/release-config.json" -Raw|ConvertFrom-Json -AsHashtable
$bundle=Read-RecoveryBundle $RecoveryDirectory
Assert-RecoveryPackageContext $config $bundle
Assert-RecoveryNoReparse $PSScriptRoot $RecoveryDirectory
$request=Get-Content -LiteralPath $ApprovalFile -Raw|ConvertFrom-Json -AsHashtable -DateKind String
Assert-RecoveryApproval $request $bundle $Mode
. "$PSScriptRoot/RecoveryHost.ps1"
$saved=$bundle.context.owner
$ownerPath=Join-Path $config.runtime 'state/mother-cutover-maintenance-owner.lock'
Assert-RecoveryNoReparse $config.runtime $ownerPath
$identity=Get-Content $ownerPath -Raw|ConvertFrom-Json -AsHashtable -DateKind String
if($Mode -eq 'LIVE'){
 Assert-RecoveryOwnerIdentity $identity $saved
 $p=Get-Process -Id $saved.owner_pid -ErrorAction Stop
 if([string]$p.StartTime.ToUniversalTime().Ticks -cne [string]$saved.creation_ticks){throw 'RECOVERY_OWNER_PID_REUSED'}
 Publish-RecoveryRequest $RecoveryDirectory $request
 @{status='RECOVERY_REQUEST_QUEUED_NOT_RECOVERED';request_id=$request.request_id}|ConvertTo-Json
 return
}
if($identity.Contains('recovery_parent')){
 Assert-RecoveryOwnerIdentity $identity.recovery_parent $saved
 if(Get-Process -Id $saved.owner_pid -ErrorAction SilentlyContinue){throw 'RECOVERY_ORIGINAL_OWNER_NOT_ABSENT'}
 $p=Get-Process -Id $identity.owner_pid -ErrorAction Stop
 if([string]$p.StartTime.ToUniversalTime().Ticks -cne [string]$identity.creation_ticks){throw 'RECOVERY_SUCCESSOR_PID_REUSED'}
 Publish-RecoveryRequest $RecoveryDirectory $request
 @{status='RECOVERY_REQUEST_QUEUED_TO_SUCCESSOR';request_id=$request.request_id}|ConvertTo-Json
 return
}
Invoke-DeadRecoveryHost $config $RecoveryDirectory $request|ConvertTo-Json -Depth 12