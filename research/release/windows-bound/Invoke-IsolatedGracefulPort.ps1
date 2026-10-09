[CmdletBinding()]
param([Parameter(Mandatory)][string]$RuntimeDir,[Parameter(Mandatory)][string]$Repository,[Parameter(Mandatory)][string]$ProofFile,[switch]$Request)
$ErrorActionPreference='Stop'
# This adapter is review-only. It deliberately cannot address a formal runtime.
$runtime=[IO.Path]::GetFullPath($RuntimeDir)
if($runtime -match 'fuman-runtime|fuman-release-owner|prod81'){throw 'FORMAL_OPERATION_NOT_AUTHORIZED'}
$p=Get-Content -LiteralPath $ProofFile -Raw | ConvertFrom-Json -DateKind String
if($p.scope -ne 'ISOLATED_REVIEW' -or $p.inventory_complete -ne $true -or @($p.unknown_pids).Count){throw 'UNKNOWN_PID'}
if($p.locks_verified -ne $true){throw 'UNKNOWN_LOCK'}
if($p.writer_lease_released -ne $true -or $p.writer_exited -ne $true){throw 'WRITER_NOT_QUIESCENT'}
if($p.stock_exited -ne $true -or $p.supervisor_exited -ne $true){throw 'STOCK_SUPERVISOR_NOT_QUIESCENT_NO_SAFE_STOP_PORT'}
if($p.maintenance_fence_owned -ne $true){throw 'MAINTENANCE_OWNER_UNKNOWN'}
$age=([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($p.checked_at)).TotalSeconds
if($age -lt 0 -or $age -gt 15){throw 'QUIESCENCE_PROOF_STALE'}
$owner=Get-Content -LiteralPath (Join-Path $runtime 'state/futopt-shutdown/owner.json') -Raw | ConvertFrom-Json -DateKind String
foreach($field in @('pid','creation_time','epoch','entry','executable')){if($owner.$field -ne $p.future.$field){throw 'FUTURE_BINDING_MISMATCH'}}
$controller=Join-Path $Repository 'ops/Request-FutoptGracefulStop.ps1'
# Existing controller independently rechecks CIM identity, hashes, ACK and process exit.
# No legacy Kill/Stop-Process fallback exists here.
if($Request){& $controller -RuntimeDir $runtime -Request -Confirm:$false -WaitSeconds 20}
else{& $controller -RuntimeDir $runtime}

