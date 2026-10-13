function Get-ReceiptCatchupDecision {
  param($Pending, $Snapshot, [string]$TradeDate, [double]$ElapsedSeconds)
  if ($null -eq $Pending -or $Pending.status -ne 'PENDING') { return 'WRITER' }
  if ($null -eq $Snapshot -or $Snapshot.complete -ne $true -or $Pending.trade_date -ne $TradeDate -or $Snapshot.trade_date -ne $TradeDate) { return 'DISCARD' }
  foreach ($key in @('canonical_run_id','mother_pool_run_id','generation','snapshot_sequence')) {
    if ($null -eq $Pending.$key -or $Pending.$key -ne $Snapshot.$key) { return 'DISCARD' }
  }
  if ([double]::IsNaN($ElapsedSeconds) -or [double]::IsInfinity($ElapsedSeconds) -or $ElapsedSeconds -lt 0) { throw 'INVALID_CATCHUP_CLOCK' }
  if ($ElapsedSeconds -gt 235) { return 'DEFER' }
  return 'VERIFY_ONLY'
}
function Save-ReceiptCatchupState {
  param([string]$Path, $Value)
  $temp = $Path + '.' + $PID + '.tmp'
  $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temp -Encoding utf8
  [IO.File]::Move($temp, $Path, $true)
}
