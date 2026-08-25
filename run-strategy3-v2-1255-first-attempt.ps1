$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location "C:\fuman-terminal"
$runtimeDir = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtimeDir
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$compactDate = Get-Date -Format yyyyMMdd
$receiptDir = Join-Path $runtimeDir "data\scan-receipts"
$logDir = Join-Path $runtimeDir "logs"
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$scanReceipt = Join-Path $receiptDir ("strategy3-v2-complete-scan-attempt-1255-{0}.json" -f $compactDate)
$attemptReceipt = Join-Path $receiptDir ("strategy3-v2-first-attempt-1255-{0}.json" -f $compactDate)
$log = Join-Path $logDir ("strategy3-v2-first-attempt-1255-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$startedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
try {
  $output = & $nodeExe "--use-system-ca" "scripts\run-strategy3-v2-complete-scan.js" "--attempt-phase=1255" 2>&1
  $scannerExitCode = $LASTEXITCODE
  $output | Set-Content -LiteralPath $log -Encoding utf8
  $scan = $null
  if (Test-Path -LiteralPath $scanReceipt) {
    try { $scan = Get-Content -Raw -LiteralPath $scanReceipt | ConvertFrom-Json } catch { $scan = $null }
  }
  $result = [ordered]@{
    contract = "strategy3-v2-1255-first-attempt-wrapper-v1"
    ok = $true
    status = "STRATEGY3_V2_1255_ATTEMPT_RECORDED"
    trade_date = (Get-Date -Format yyyy-MM-dd)
    checked_at = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
    started_at = $startedAt
    attempt_phase = "1255"
    expected_fail_closed = $true
    scanner_exit_code = $scannerExitCode
    scan_receipt = $scanReceipt
    scan_status = [string]$scan.status
    scan_reason_code = [string]$scan.reason_code
    formal_allowed = $false
    publish_allowed = $false
    line_push_allowed = $false
    retry_task = "Fuman Strategy3 V2 Complete Scan 1300"
    retry_time = "13:00 Asia/Taipei"
    log = $log
  }
} catch {
  $result = [ordered]@{
    contract = "strategy3-v2-1255-first-attempt-wrapper-v1"
    ok = $false
    status = "STRATEGY3_V2_1255_ATTEMPT_WRAPPER_EXCEPTION"
    trade_date = (Get-Date -Format yyyy-MM-dd)
    checked_at = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
    attempt_phase = "1255"
    expected_fail_closed = $true
    formal_allowed = $false
    publish_allowed = $false
    line_push_allowed = $false
    retry_task = "Fuman Strategy3 V2 Complete Scan 1300"
    retry_time = "13:00 Asia/Taipei"
    error = $_.Exception.Message
    log = $log
  }
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $attemptReceipt -Encoding utf8
$result | ConvertTo-Json -Depth 8
exit 0
