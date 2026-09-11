$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } elseif ($env:FUMAN_RUNTIME_ROOT) { $env:FUMAN_RUNTIME_ROOT } else { "C:\fuman-runtime" }
$receiptDir = Join-Path $runtimeRoot "data\scan-receipts"
$notifier = Join-Path $root "scripts\notify-daytrade-intraday-burst-telegram.js"
$startedAt = [DateTimeOffset]::UtcNow.ToString("o")
$taipei = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, "Taipei Standard Time")
$tradeDate = $taipei.ToString("yyyy-MM-dd")
$contractVersion = "4.1.0"
$canonicalRunId = "fugle_daytrade_source:{0}:canonical" -f $taipei.ToString("yyyyMMdd")
$receiptFile = Join-Path $receiptDir ("daytrade-intraday-burst-telegram-runner-{0}.json" -f $taipei.ToString("yyyyMMdd"))
$exitCode = 1
$errorMessage = $null
$notifierReceipt = $null
$notifierReceiptVerified = $false
$runnerStartedAt = [DateTimeOffset]::Parse(
  $startedAt,
  [Globalization.CultureInfo]::InvariantCulture,
  [Globalization.DateTimeStyles]::RoundtripKind
)

try {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  & $node $notifier
  $exitCode = if ($null -eq $LASTEXITCODE) { 1 } else { [int]$LASTEXITCODE }
  if ($exitCode -eq 0) {
    $notifierReceiptFile = Join-Path $receiptDir ("daytrade-intraday-burst-telegram-{0}.json" -f $taipei.ToString("yyyyMMdd"))
    if (-not (Test-Path -LiteralPath $notifierReceiptFile -PathType Leaf)) {
      throw "notifier_receipt_missing: $notifierReceiptFile"
    }
    $notifierReceiptRaw = Get-Content -LiteralPath $notifierReceiptFile -Raw
    $notifierReceipt = $notifierReceiptRaw | ConvertFrom-Json
    $notifierStartedAtMatch = [regex]::Match($notifierReceiptRaw, '"started_at"\s*:\s*"(?<value>[^"]+)"')
    if (-not $notifierStartedAtMatch.Success) {
      throw "notifier_receipt_started_at_missing"
    }
    $notifierStartedAt = [DateTimeOffset]::Parse(
      $notifierStartedAtMatch.Groups["value"].Value,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    )
    $notifierReceiptVerified = (
      [string]$notifierReceipt.contract -eq "daytrade_intraday_burst_telegram_v1" -and
      [string]$notifierReceipt.contract_version -eq $contractVersion -and
      [string]$notifierReceipt.trade_date -eq $tradeDate -and
      [string]$notifierReceipt.canonical_run_id -eq $canonicalRunId -and
      [bool]$notifierReceipt.ok -eq $true -and
      [bool]$notifierReceipt.complete -eq $true -and
      [string]$notifierReceipt.status -eq "complete" -and
      ([string]::IsNullOrWhiteSpace([string]$notifierReceipt.first_blocker) -or
        [string]$notifierReceipt.first_blocker -eq "outside_trading_window") -and
      $notifierStartedAt -ge $runnerStartedAt
    )
    if (-not $notifierReceiptVerified) {
      throw ("notifier_receipt_not_complete_or_stale: contract={0}; trade_date={1}; ok={2}; complete={3}; status={4}; first_blocker={5}; started_at={6}" -f
        $notifierReceipt.contract, $notifierReceipt.trade_date, $notifierReceipt.ok, $notifierReceipt.complete,
        $notifierReceipt.status, $notifierReceipt.first_blocker, $notifierReceipt.started_at)
    }
  }
} catch {
  $errorMessage = $_.Exception.Message
  $exitCode = 1
} finally {
  New-Item -ItemType Directory -Path $receiptDir -Force | Out-Null
  $finishedAt = [DateTimeOffset]::UtcNow.ToString("o")
  $runnerSucceeded = ($exitCode -eq 0 -and $notifierReceiptVerified)
  $failedChecks = @()
  $firstBlocker = $null
  if (-not $runnerSucceeded) {
    if ($null -ne $notifierReceipt -and $null -ne $notifierReceipt.failed_checks) {
      $failedChecks = @($notifierReceipt.failed_checks | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    if ($null -ne $notifierReceipt -and -not [string]::IsNullOrWhiteSpace([string]$notifierReceipt.first_blocker)) {
      $firstBlocker = [string]$notifierReceipt.first_blocker
    } elseif (-not [string]::IsNullOrWhiteSpace($errorMessage)) {
      $firstBlocker = "runner_exception"
    } else {
      $firstBlocker = "notifier_exit_nonzero"
    }
    if ($failedChecks.Count -eq 0) { $failedChecks = @($firstBlocker) }
  }
  $receipt = [ordered]@{
    contract = "daytrade_intraday_burst_telegram_runner_v1"
    contract_version = $contractVersion
    ok = $runnerSucceeded
    complete = $runnerSucceeded
    status = if ($runnerSucceeded) { "complete" } else { "failed" }
    trade_date = $tradeDate
    canonical_run_id = $canonicalRunId
    mother_pool_run_id = $notifierReceipt.mother_pool_run_id
    snapshot_sequence = $notifierReceipt.snapshot_sequence
    v4_contract_validated = $notifierReceipt.v4_contract_validated
    accepted_mother_pool_symbols = if ($null -ne $notifierReceipt) { [int]$notifierReceipt.accepted_mother_pool_symbols } else { 0 }
    started_at = $startedAt
    finished_at = $finishedAt
    exit_code = $exitCode
    runner_path = $MyInvocation.MyCommand.Path
    working_directory = $root
    notifier_path = $notifier
    notifier_receipt_path = Join-Path $receiptDir ("daytrade-intraday-burst-telegram-{0}.json" -f $taipei.ToString("yyyyMMdd"))
    notifier_receipt_verified = $notifierReceiptVerified
    notifier_receipt_contract = if ($null -ne $notifierReceipt) { [string]$notifierReceipt.contract } else { $null }
    notifier_receipt_status = if ($null -ne $notifierReceipt) { [string]$notifierReceipt.status } else { $null }
    notifier_receipt_complete = if ($null -ne $notifierReceipt) { [bool]$notifierReceipt.complete } else { $false }
    notifier_receipt_first_blocker = if ($null -ne $notifierReceipt) { [string]$notifierReceipt.first_blocker } else { $null }
    failed_checks = $failedChecks
    first_blocker = $firstBlocker
    error = $errorMessage
  }
  $temporaryFile = "$receiptFile.tmp-$PID"
  $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryFile -Encoding utf8
  Move-Item -LiteralPath $temporaryFile -Destination $receiptFile -Force
}

exit $exitCode
