$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } elseif ($env:FUMAN_RUNTIME_ROOT) { $env:FUMAN_RUNTIME_ROOT } else { "C:\fuman-runtime" }
$receiptDir = Join-Path $runtimeRoot "data\scan-receipts"
$notifier = Join-Path $root "scripts\notify-daytrade-intraday-burst-telegram.js"
$startedAt = [DateTimeOffset]::UtcNow.ToString("o")
$taipei = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, "Taipei Standard Time")
$tradeDate = $taipei.ToString("yyyy-MM-dd")
$receiptFile = Join-Path $receiptDir ("daytrade-intraday-burst-telegram-runner-{0}.json" -f $taipei.ToString("yyyyMMdd"))
$exitCode = 1
$errorMessage = $null

try {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  & $node $notifier
  $exitCode = if ($null -eq $LASTEXITCODE) { 1 } else { [int]$LASTEXITCODE }
} catch {
  $errorMessage = $_.Exception.Message
  $exitCode = 1
} finally {
  New-Item -ItemType Directory -Path $receiptDir -Force | Out-Null
  $finishedAt = [DateTimeOffset]::UtcNow.ToString("o")
  $receipt = [ordered]@{
    contract = "daytrade_intraday_burst_telegram_runner_v1"
    ok = ($exitCode -eq 0)
    complete = $true
    status = if ($exitCode -eq 0) { "complete" } else { "failed" }
    trade_date = $tradeDate
    started_at = $startedAt
    finished_at = $finishedAt
    exit_code = $exitCode
    runner_path = $MyInvocation.MyCommand.Path
    working_directory = $root
    notifier_path = $notifier
    notifier_receipt_path = Join-Path $receiptDir ("daytrade-intraday-burst-telegram-{0}.json" -f $taipei.ToString("yyyyMMdd"))
    error = $errorMessage
  }
  $temporaryFile = "$receiptFile.tmp-$PID"
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryFile -Encoding utf8
  Move-Item -LiteralPath $temporaryFile -Destination $receiptFile -Force
}

exit $exitCode
