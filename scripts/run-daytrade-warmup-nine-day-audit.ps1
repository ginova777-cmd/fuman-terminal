param(
  [string]$Root = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"
$startedAt = Get-Date
$logDir = Join-Path $RuntimeDir "logs"
$stateDir = Join-Path $RuntimeDir "state\daytrade-warmup-nine-day"
$receiptFile = Join-Path $RuntimeDir "state\daytrade-warmup-nine-day-audit-latest.json"
$baselineReceiptFile = Join-Path $RuntimeDir "state\daytrade-futopt-near-one-baseline-audit-latest.json"
$logFile = Join-Path $logDir ("daytrade-warmup-nine-day-audit-{0}.log" -f $startedAt.ToString("yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $logDir,$stateDir | Out-Null

$record = [ordered]@{
  contract = "daytrade-warmup-nine-day-audit-task-v2"
  checkedAt = $startedAt.ToString("o")
  taskResult = "AUDIT_EXECUTED"
  ok = $false
  status = "ERROR"
  blockingReasons = @()
  report = ""
  logFile = $logFile
  naturalEvidenceBootstrap = $null
  ticket1Baseline = $null
}

try {
  # Materialize only verifier-owned local evidence. No writer, scanner, Supabase call,
  # or recovery-to-natural-success conversion occurs in this scheduled audit.
  $taipeiZone = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  $taipeiNow = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), $taipeiZone.Id)
  $todayKey = $taipeiNow.ToString("yyyyMMdd")
  $todayIso = $taipeiNow.ToString("yyyy-MM-dd")
  Push-Location -LiteralPath $Root
  try {
    $warmupRaw = (& node --use-system-ca "scripts\verify-daytrade-warmup-unattended.js" "--expected-date=$todayIso" 2>&1 | Out-String).Trim()
    $warmupExitCode = $LASTEXITCODE
    $checkpointResults = [ordered]@{}
    foreach ($phase in @("0705","0847","0912")) {
      $checkpointRaw = (& node --use-system-ca "scripts\write-daytrade-warmup-checkpoint.js" "--phase=$phase" "--expected-date=$todayKey" 2>&1 | Out-String).Trim()
      $checkpointResults[$phase] = [ordered]@{
        exitCode = $LASTEXITCODE
        output = $checkpointRaw
      }
    }
  }
  finally {
    Pop-Location
  }
  $record.naturalEvidenceBootstrap = [ordered]@{
    expectedDate = $todayIso
    verifierExitCode = $warmupExitCode
    verifierOutput = $warmupRaw
    checkpoints = $checkpointResults
    policy = "verify_only;closed_day_preserve_previous_good;no_writer_no_scanner_no_supabase"
  }

  Push-Location -LiteralPath $Root
  try {
    $raw = (& node --use-system-ca "scripts\verify-daytrade-warmup-nine-day-window.js" 2>&1 | Out-String).Trim()
    $exitCode = $LASTEXITCODE
  }
  finally {
    Pop-Location
  }
  Set-Content -LiteralPath $logFile -Value $raw -Encoding UTF8
  $payload = $raw | ConvertFrom-Json -ErrorAction Stop
  $record.ok = ($payload.ok -eq $true)
  $record.status = [string]$payload.status
  $record.blockingReasons = @($payload.blockingReasons)
  $record.report = [string]$payload.output
  $record.verifierExitCode = $exitCode
  $record.note = "TRACKING_PENDING is an honest in-window state; it is not an unattended completion claim."

  # Ticket 1 is read-only here: the source writer owns the natural 08:45 write.
  # A missing baseline must be visible on trading days, but must not fail a closed-market audit.
  $warmupSummaryFile = Join-Path $RuntimeDir ("state\daytrade-warmup-unattended-summary-{0}.json" -f $todayKey)
  $marketClosed = $false
  if (Test-Path -LiteralPath $warmupSummaryFile) {
    try {
      $warmupSummary = Get-Content -LiteralPath $warmupSummaryFile -Raw | ConvertFrom-Json
      $marketClosed = ($warmupSummary.market_closed -eq $true -or $warmupSummary.marketClosed -eq $true)
    } catch {
      $record.ticket1BaselineParseWarning = $_.Exception.Message
    }
  }
  Push-Location -LiteralPath $Root
  try {
    $baselineRaw = (& node --use-system-ca "scripts\verify-daytrade-futopt-near-one-baseline.js" 2>&1 | Out-String).Trim()
    $baselineExitCode = $LASTEXITCODE
  }
  finally {
    Pop-Location
  }
  $baselinePayload = $null
  try { $baselinePayload = $baselineRaw | ConvertFrom-Json -ErrorAction Stop } catch {
    $baselinePayload = [ordered]@{ ok = $false; parseError = $_.Exception.Message; raw = $baselineRaw }
  }
  $baselineStatus = if ($marketClosed) { "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD" } elseif ($baselinePayload.ok -eq $true) { "PASS" } else { "BLOCKED_NATURAL_0845_BASELINE_MISSING" }
  $record.ticket1Baseline = [ordered]@{
    checkedAt = (Get-Date).ToString("o")
    expectedDate = $baselinePayload.expectedDate
    status = $baselineStatus
    marketClosed = $marketClosed
    verifierExitCode = $baselineExitCode
    verifier = $baselinePayload
  }
  $record.ticket1Baseline | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $baselineReceiptFile -Encoding UTF8
  if (-not $marketClosed -and $baselinePayload.ok -ne $true) {
    $record.blockingReasons += "ticket1_natural_0845_baseline_missing"
  }
  $record.ok = ($record.ok -eq $true -and ($marketClosed -or $baselinePayload.ok -eq $true))
}
catch {
  $record.error = $_.Exception.Message
  Set-Content -LiteralPath $logFile -Value ($record | ConvertTo-Json -Depth 8) -Encoding UTF8
}
finally {
  $record.finishedAt = (Get-Date).ToString("o")
  $record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receiptFile -Encoding UTF8
}

$record | ConvertTo-Json -Depth 12
# A pending/closed-day verdict is a valid audit result, not a task execution error.
# Only an actual runner/read/parse error should make Task Scheduler report failure.
if ($record.error) { exit 1 }
exit 0


