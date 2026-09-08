param(
  [ValidateSet("Run", "Verify", "Status")]
  [string]$Mode = "Run"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$RuntimeDir = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$ReceiptDir = Join-Path $RuntimeDir "data\scan-receipts"
$RunnerReceipt = Join-Path $ReceiptDir "stock-master-sync-runner.json"
$VerifierReceipt = Join-Path $ReceiptDir "stock-master-sync.json"
$WrapperReceipt = Join-Path $ReceiptDir "stock-master-sync-wrapper.json"
$Node = if (Test-Path -LiteralPath "C:\Program Files\nodejs\node.exe") { "C:\Program Files\nodejs\node.exe" } else { "node" }
New-Item -ItemType Directory -Force -Path $ReceiptDir | Out-Null

if ($Mode -eq "Status") {
  if (-not (Test-Path -LiteralPath $WrapperReceipt)) { throw "MISSING: $WrapperReceipt" }
  Get-Content -LiteralPath $WrapperReceipt -Raw
  exit 0
}

function Invoke-NodeContractStep {
  param([string]$Script, [string]$Label, [string[]]$Arguments = @())
  $output = & $Node --use-system-ca $Script @Arguments 2>&1
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  return [pscustomobject]@{ label = $Label; exit_code = $exitCode; output = ($output | Out-String).Trim() }
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$runId = "stock-master-sync-$stamp"
$steps = @()
if ($Mode -eq "Run") {
  $runner = Invoke-NodeContractStep -Script "scripts\run-stock-master-sync.js" -Label "runner" -Arguments @("--run-id=$runId", "--quiet")
  $steps += $runner
} else {
  $runner = [pscustomobject]@{ label = "runner"; exit_code = 0; output = "existing runner receipt" }
}

$verifier = if ($runner.exit_code -eq 0) {
  Invoke-NodeContractStep -Script "scripts\verify-stock-master-sync.js" -Label "canonical-verifier" -Arguments @("--quiet")
} else {
  [pscustomobject]@{ label = "canonical-verifier"; exit_code = -1; output = "skipped because runner failed" }
}
$steps += $verifier

$runnerData = if (Test-Path -LiteralPath $RunnerReceipt) { Get-Content -LiteralPath $RunnerReceipt -Raw | ConvertFrom-Json } else { $null }
$verifierData = if (Test-Path -LiteralPath $VerifierReceipt) { Get-Content -LiteralPath $VerifierReceipt -Raw | ConvertFrom-Json } else { $null }
$runnerOk = ($runner.exit_code -eq 0 -and $null -ne $runnerData -and $runnerData.complete -eq $true)
$verifierOk = ($verifier.exit_code -eq 0 -and $null -ne $verifierData -and $verifierData.complete -eq $true)
$complete = ($runnerOk -and $verifierOk)
$receipt = [ordered]@{
  contract = "stock_master_sync_wrapper_receipt_v1"
  status = if ($complete) { "complete" } else { "failed" }
  complete = $complete
  ok = $complete
  mode = $Mode.ToLowerInvariant()
  run_id = if ($null -ne $runnerData) { $runnerData.run_id } else { $runId }
  checked_at = (Get-Date).ToUniversalTime().ToString("o")
  source_authority = "MOPS_OPEN_DATA_TWSE_TPEX"
  official_rows = if ($null -ne $verifierData) { $verifierData.official_rows } else { 0 }
  stock_tickers_rows = if ($null -ne $verifierData) { $verifierData.stock_tickers_rows } else { 0 }
  stock_universe_rows = if ($null -ne $verifierData) { $verifierData.stock_universe_rows } else { 0 }
  missing_stock_tickers_count = if ($null -ne $verifierData) { $verifierData.missing_stock_tickers_count } else { -1 }
  missing_stock_universe_count = if ($null -ne $verifierData) { $verifierData.missing_stock_universe_count } else { -1 }
  runner_ok = $runnerOk
  canonical_verifier_ok = $verifierOk
  canonical_verifier = "scripts/verify-stock-master-sync.js"
  master_blacklist_filter_applied = $false
  scanner_eligibility_separate_from_master = $true
  steps = $steps
  runner_receipt = $RunnerReceipt
  canonical_receipt = $VerifierReceipt
  wrapper_receipt = $WrapperReceipt
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $WrapperReceipt -Encoding UTF8
$receipt | ConvertTo-Json -Depth 8
if (-not $complete) { exit 1 }
exit 0
