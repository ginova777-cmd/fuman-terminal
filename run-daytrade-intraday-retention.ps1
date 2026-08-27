param(
  [switch]$Apply,
  [int]$MaxBatches = 60
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$script = Join-Path $root "scripts\cleanup-daytrade-intraday-retention.js"
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$statusDir = Join-Path $runtimeRoot "status"
$logDir = Join-Path $runtimeRoot "logs"
$dateToken = Get-Date -Format "yyyyMMdd"
$receiptFile = Join-Path $statusDir "daytrade-intraday-retention-$dateToken.json"
$logFile = Join-Path $logDir "daytrade-intraday-retention-$dateToken.log"
$nodeCandidates = @(
  "C:\Program Files\nodejs\node.exe",
  (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

try {
  New-Item -ItemType Directory -Force -Path $statusDir, $logDir | Out-Null
  if (-not (Test-Path -LiteralPath $script)) { throw "intraday retention script missing: $script" }
  if (-not $nodeCandidates) { throw "node executable not found" }

  $argsList = @("--use-system-ca", $script, "--max-batches=$MaxBatches", "--json")
  if ($Apply) { $argsList += "--apply" } else { $argsList += "--dry-run" }
  & $nodeCandidates[0] @argsList *> $logFile
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "daytrade intraday retention failed with exit code $exitCode" }
  if (-not (Test-Path -LiteralPath $receiptFile)) { throw "daytrade intraday retention receipt missing after successful process exit" }
}
catch {
  if (-not (Test-Path -LiteralPath $receiptFile)) {
    $failure = [ordered]@{
      ok = $false
      checkedAt = (Get-Date).ToUniversalTime().ToString("o")
      contract = "daytrade-intraday-retention-15d-v1"
      stage = "wrapper_startup"
      reasonCode = "retention_wrapper_failed_before_canonical_receipt"
      error = $_.Exception.Message
      applied = [bool]$Apply
      maxBatchSize = 5000
      requestedMaxBatches = [Math]::Min([Math]::Max($MaxBatches, 1), 60)
      protectedLatestTradeDateRequired = $true
      logFile = $logFile
    }
    $failure | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptFile -Encoding utf8
  }
  throw
}
