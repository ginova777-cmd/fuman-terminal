$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'institution-watchdog-contract.ps1')

function Copy-ContractObject([object]$Value) {
  return (($Value | ConvertTo-Json -Depth 30 -Compress) | ConvertFrom-Json)
}
function Assert-Case([string]$Name, [object]$Scan, [object]$Api, [bool]$Expected, [string]$ExpectedIssue = '') {
  $result = Test-InstitutionWatchdogEvidence -ScanReceipt $Scan -ApiPayload $Api -ExpectedTradeDate '2026-09-15'
  if ($result.ok -ne $Expected) { throw "$Name expected ok=$Expected, got ok=$($result.ok), issues=$($result.issues -join ',')" }
  if ($ExpectedIssue -and $result.issues -notcontains $ExpectedIssue) { throw "$Name expected issue $ExpectedIssue, got $($result.issues -join ',')" }
}

$baseScan = [pscustomobject]@{
  status='complete'; complete=$true; exitCode=0; marketDate='20260915'; tradeDate='2026-09-15';
  runId='institution-20260915-20260915131528'; scanned=1859; total=1859; matches=15;
  qualityStatus='complete'; publishAllowed=$true; evidenceStatus='complete'; unattendedStatus='YES'; fallbackUsed=$false;
  institution_source_status_at_run=[pscustomobject]@{status='ready';latestTradeDate='20260915';usedDate='20260915'};
  chip_source_status_at_run=[pscustomobject]@{status='ready';latestTradeDate='20260915';usedDate='20260915'};
  selectionCoverage=[pscustomobject]@{contract='institution-candidate90-daily-up-hourly60-bonus-v1';ok=$true;dataCoverage=0.9873417721518988;candidateCount=158;dataReadyCount=156;dataMissingCount=2;technicalRejectedCount=141;resultCount=15}
}
$baseApi = [pscustomobject]@{ok=$true;status='complete';runId='institution-20260915-20260915131528';count=15;updatedAt='2026-09-15T13:15:28.831Z'}
Assert-Case 'current 15-result scan' $baseScan $baseApi $true

$zeroScan=Copy-ContractObject $baseScan
$zeroScan.matches=0; $zeroScan.selectionCoverage.candidateCount=0; $zeroScan.selectionCoverage.dataReadyCount=0; $zeroScan.selectionCoverage.dataMissingCount=0; $zeroScan.selectionCoverage.technicalRejectedCount=0; $zeroScan.selectionCoverage.resultCount=0; $zeroScan.selectionCoverage.dataCoverage=1
$zeroApi=Copy-ContractObject $baseApi; $zeroApi.count=0
Assert-Case 'valid zero-result complete scan' $zeroScan $zeroApi $true

$hundredScan=Copy-ContractObject $baseScan
$hundredScan.matches=100; $hundredScan.selectionCoverage.candidateCount=300; $hundredScan.selectionCoverage.dataReadyCount=295; $hundredScan.selectionCoverage.dataMissingCount=5; $hundredScan.selectionCoverage.technicalRejectedCount=195; $hundredScan.selectionCoverage.resultCount=100; $hundredScan.selectionCoverage.dataCoverage=295/300
$hundredApi=Copy-ContractObject $baseApi; $hundredApi.count=100
Assert-Case '100-result scan' $hundredScan $hundredApi $true

$bad=Copy-ContractObject $baseScan; $bad.marketDate='20260914'; Assert-Case 'stale date' $bad $baseApi $false 'institution_scan_receipt_not_current_date'
$bad=Copy-ContractObject $baseScan; $bad.selectionCoverage.dataCoverage=0.89; Assert-Case 'coverage below 90 percent' $bad $baseApi $false 'institution_candidate_coverage_below_90pct'
$bad=Copy-ContractObject $baseScan; $bad.complete=$false; Assert-Case 'incomplete scan receipt' $bad $baseApi $false 'institution_scan_receipt_not_complete'
$badApi=Copy-ContractObject $baseApi; $badApi.runId='institution-20260914-old'; Assert-Case 'API old run' $baseScan $badApi $false 'institution_api_run_not_current_scan'
$badApi=Copy-ContractObject $baseApi; $badApi.count=14; Assert-Case 'API result count mismatch' $baseScan $badApi $false 'institution_api_count_does_not_match_scan_receipt'
$bad=Copy-ContractObject $baseScan; $bad.fallbackUsed=$true; Assert-Case 'fallback used' $bad $baseApi $false 'institution_formal_fallback_used'
$bad=Copy-ContractObject $baseScan; $bad.selectionCoverage.dataReadyCount=155; Assert-Case 'candidate accounting mismatch' $bad $baseApi $false 'institution_candidate_counts_inconsistent'

Write-Output 'institution watchdog contract tests passed: valid 0/15/100 results and 7 fail-closed cases'
