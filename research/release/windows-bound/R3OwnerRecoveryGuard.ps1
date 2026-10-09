Set-StrictMode -Version Latest
function Assert-R3OwnerClosed([string]$Receipt) {
 if(!(Test-Path -LiteralPath $Receipt)){throw 'OWNER_HISTORY_UNKNOWN'}
 try{$r=Get-Content -LiteralPath $Receipt -Raw|ConvertFrom-Json -DateKind String}catch{throw 'OWNER_HISTORY_UNKNOWN'}
 if(!$r.owner_pid -or !$r.owner_creation_date -or !$r.token){throw 'OWNER_IDENTITY_UNKNOWN'}
 if($r.stage -ne 'CLOSED_VERIFIED'){throw 'OWNER_RECOVERY_REVIEW_REQUIRED'}
 # A dead PID or an available OS mutex never closes this durable obligation.
 if(!$r.runtime_exited -or !$r.tasks_restored -or !$r.lease_verified){throw 'OWNER_CLOSURE_UNVERIFIED'}
}
