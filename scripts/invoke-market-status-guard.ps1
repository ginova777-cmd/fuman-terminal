param([Parameter(Mandatory=$true)][string]$Stage, [string]$TradeDate = "", [string]$ExecutionMode = "natural")
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$root = Split-Path -Parent $PSScriptRoot
$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$node = "C:\Program Files\nodejs\node.exe"; if (-not (Test-Path -LiteralPath $node)) { $node = "node.exe" }
$nodeArgs = @("--use-system-ca", (Join-Path $PSScriptRoot "write-market-status-receipt.js"), "--stage=$Stage", "--execution-mode=$ExecutionMode")
if ($TradeDate) { $nodeArgs += "--trade-date=$TradeDate" }
$out = & $node @nodeArgs 2>&1
$code = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
$json = $null; try { $text = ($out | ForEach-Object { [string]$_ }) -join "`n"; $json = $text | ConvertFrom-Json -AsHashtable; if (-not $json.receiptPath -or -not (Test-Path -LiteralPath $json.receiptPath)) { $json = $null } } catch {}
if ($null -eq $json -or [int]$json.exitCode -ne $code) { Write-Output 'MARKET_STATUS_UNVERIFIED'; Write-Output (($out | Out-String).Trim()); exit 2 }
$reportedCode = if ($null -ne $json -and $json.exitCode -ne $null) { [int]$json.exitCode } else { $code }
$json.runId = $json.wrapperRunId
if ($reportedCode -eq 0) { exit 0 }
if ($code -eq 10 -or $reportedCode -eq 10) {
  if ($null -eq $json) { exit 10 }
  $dir = Join-Path $runtime "data\scan-receipts"; New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmssfff"
  $receipt = [ordered]@{ contract="market-status-wrapper-skip-v1"; strategy=$Stage; tradeDate=[string]$json.tradeDate; runId=[string]$json.runId; stage=$Stage; executionMode=$ExecutionMode; marketReceipt=[string]$json.receiptPath; skipReason=[string]$json.skipReason; status="SKIPPED"; complete=$false; evaluationComplete=$true; scanExecuted=$false; exitCode=0; decisionExitCode=10; checkedAt=(Get-Date).ToString("o") }
  $path = Join-Path $dir ("{0}-market-closed-{1}.json" -f $Stage, $stamp)
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding utf8
  Write-Output ($receipt | ConvertTo-Json -Compress)
  exit 10
}
if ($reportedCode -eq 2) { Write-Output "MARKET_STATUS_UNVERIFIED"; exit 2 }
Write-Output (($out | Out-String).Trim()); exit $reportedCode
