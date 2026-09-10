Set-StrictMode -Version Latest

function Invoke-MotherPoolV41ConsumerGate {
  param(
    [Parameter(Mandatory = $true)][string]$Consumer,
    [Parameter(Mandatory = $true)][string]$TradeDate,
    [string]$RuntimeRoot = "C:\fuman-runtime"
  )

  $node = if (Test-Path -LiteralPath "C:\Program Files\nodejs\node.exe") { "C:\Program Files\nodejs\node.exe" } else { "node.exe" }
  $receiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
  New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
  $receiptPath = Join-Path $receiptDir ("mother-pool-v4-1-{0}.json" -f $Consumer)
  $normalizedDate = if ($TradeDate -match "^\d{8}$") {
    "{0}-{1}-{2}" -f $TradeDate.Substring(0,4), $TradeDate.Substring(4,2), $TradeDate.Substring(6,2)
  } else { $TradeDate }
  $output = (& $node "--use-system-ca" (Join-Path $PSScriptRoot "scripts\require-daytrade-mother-pool-v4-1.js") "--consumer=$Consumer" "--trade-date=$normalizedDate" "--receipt=$receiptPath" 2>&1) -join "`n"
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  if ($exitCode -ne 0) { throw "${Consumer}_mother_pool_v4_1_gate_failed: $output" }
  $payload = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  if ($payload.complete -ne $true -or $payload.contract_version -ne "4.1.0" -or $payload.source_freshness -ne "same_trade_date_current") {
    throw "${Consumer}_mother_pool_v4_1_identity_invalid"
  }
  return $payload
}
