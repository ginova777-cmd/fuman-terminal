param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/ProductionRuntimePorts.ps1"
function Assert-OnlyBoundFuture {}
function Write-CutoverReceipt($p,$r){$r|ConvertTo-Json -Depth 15|Set-Content $p}
New-Item -ItemType Directory -Path $OutputDirectory -Force|Out-Null
$results=@()
foreach($scenario in @('requested','not_requested','malformed')){
 $script:case=$scenario
 function node { $global:LASTEXITCODE=1;if($script:case -eq 'malformed'){'invalid-json'}else{@{status='GRACEFUL_STOP_BLOCKED';error='ACK_SAVE_SCOPE';stop_not_requested=($script:case -eq 'not_requested')}|ConvertTo-Json -Compress} }
 $file="$OutputDirectory/$scenario.json"
 try{Invoke-BoundGracefulStop @{} @{pid=123;creation_ticks='123';exe='fixture'} 'fixture' $file;throw 'EXPECTED_FAILURE'}catch{if($_.Exception.Message -ne 'GRACEFUL_STOP_FAILED_NO_FORCE_FALLBACK'){throw}}
 $r=Get-Content $file -Raw|ConvertFrom-Json
 if($scenario -eq 'not_requested'){$ok=$r.stop_not_requested -eq $true}else{$ok=$r.status -eq 'GRACEFUL_STOP_FAILED' -and $r.raw_output.Count -gt 0}
 if(!$ok){throw "FAILED:$scenario"}
 $results+=@{scenario=$scenario;pass=$true}
}
@{status='STOP_FAILURE_EVIDENCE_PASS';formal_execution=$false;results=$results}|ConvertTo-Json -Depth 5|Tee-Object -FilePath "$OutputDirectory/stop-evidence-tests.json"


