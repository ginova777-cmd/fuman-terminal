function ConvertTo-InstitutionDateKey {
  param([object]$Value)
  $text = [string]$Value
  if ($text -match '^\s*(\d{4})[-/]?(\d{2})[-/]?(\d{2})') { return "$($matches[1])$($matches[2])$($matches[3])" }
  if ($text -match '^\s*(\d{3})(\d{2})(\d{2})$') { return "$(1911 + [int]$matches[1])$($matches[2])$($matches[3])" }
  return ''
}

function Test-InstitutionWatchdogEvidence {
  param(
    [Parameter(Mandatory = $true)][object]$ScanReceipt,
    [Parameter(Mandatory = $true)][object]$ApiPayload,
    [Parameter(Mandatory = $true)][string]$ExpectedTradeDate
  )

  $issues = [System.Collections.Generic.List[string]]::new()
  $targetDate = ConvertTo-InstitutionDateKey $ExpectedTradeDate
  $runId = [string]$ScanReceipt.runId
  $scanDate = ConvertTo-InstitutionDateKey $ScanReceipt.marketDate
  $scanCount = [int]$ScanReceipt.matches
  $coverage = $ScanReceipt.selectionCoverage

  if (-not $targetDate) { $issues.Add('expected_trade_date_invalid') }
  if ($ScanReceipt.status -ne 'complete' -or $ScanReceipt.complete -ne $true -or [int]$ScanReceipt.exitCode -ne 0) { $issues.Add('institution_scan_receipt_not_complete') }
  if ($scanDate -ne $targetDate -or -not $runId.Contains($targetDate)) { $issues.Add('institution_scan_receipt_not_current_date') }
  if ([int]$ScanReceipt.scanned -le 0 -or [int]$ScanReceipt.scanned -ne [int]$ScanReceipt.total) { $issues.Add('institution_full_scan_count_mismatch') }
  if ($ScanReceipt.qualityStatus -ne 'complete' -or $ScanReceipt.publishAllowed -ne $true -or $ScanReceipt.evidenceStatus -ne 'complete' -or $ScanReceipt.unattendedStatus -ne 'YES') { $issues.Add('institution_publish_contract_not_complete') }
  if ($ScanReceipt.fallbackUsed -eq $true) { $issues.Add('institution_formal_fallback_used') }

  if ($coverage.contract -ne 'institution-candidate90-daily-up-hourly60-bonus-v1' -or $coverage.ok -ne $true) { $issues.Add('institution_selection_contract_not_ready') }
  if ([double]$coverage.dataCoverage -lt 0.9) { $issues.Add('institution_candidate_coverage_below_90pct') }
  if ([int]$coverage.candidateCount -lt 0 -or ([int]$coverage.dataReadyCount + [int]$coverage.dataMissingCount) -ne [int]$coverage.candidateCount) { $issues.Add('institution_candidate_counts_inconsistent') }
  if (([int]$coverage.technicalRejectedCount + [int]$coverage.resultCount) -ne [int]$coverage.dataReadyCount) { $issues.Add('institution_technical_result_counts_inconsistent') }
  if ([int]$coverage.resultCount -ne $scanCount) { $issues.Add('institution_receipt_result_count_mismatch') }

  foreach ($sourceName in @('institution_source_status_at_run', 'chip_source_status_at_run')) {
    $source = $ScanReceipt.$sourceName
    if ($source.status -ne 'ready' -or (ConvertTo-InstitutionDateKey $source.latestTradeDate) -ne $targetDate -or (ConvertTo-InstitutionDateKey $source.usedDate) -ne $targetDate) {
      $issues.Add($sourceName + '_not_ready_for_current_date')
    }
  }

  $apiCount = -1
  try { if ($null -ne $ApiPayload.count) { $apiCount = [int]$ApiPayload.count } } catch {}
  if ($ApiPayload.ok -ne $true -or [string]$ApiPayload.runId -ne $runId) { $issues.Add('institution_api_run_not_current_scan') }
  if ($apiCount -ne $scanCount) { $issues.Add('institution_api_count_does_not_match_scan_receipt') }

  return [pscustomobject]@{
    ok = ($issues.Count -eq 0)
    reason = if ($issues.Count -eq 0) { "same-day complete scan verified; count=$scanCount runId=$runId" } else { $issues -join ';' }
    issues = @($issues.ToArray())
    tradeDate = $targetDate
    runId = $runId
    count = $scanCount
  }
}
