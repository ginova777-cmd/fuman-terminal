param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("0845", "0850", "0855", "0859")]
  [string]$Slot,
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$TerminalDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$node = "C:\Program Files\nodejs\node.exe"
$producer = Join-Path $TerminalDir "scripts\run-daytrade-near-one-source.js"
$canonicalVerifier = Join-Path $TerminalDir "scripts\verify-star-preopen-slot-symbol-contract.js"
$calendar = Join-Path $TerminalDir "scripts\check-market-calendar-action.js"
$receiptDir = Join-Path $RuntimeDir "data\scan-receipts"
$logDir = Join-Path $RuntimeDir "logs"
New-Item -ItemType Directory -Force -Path $receiptDir, $logDir | Out-Null

$taipeiNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, "Taipei Standard Time")
$tradeDate = $taipeiNow.ToString("yyyy-MM-dd")
$actualSlot = $taipeiNow.ToString("HHmm")
$compactDate = $tradeDate.Replace("-", "")
$receiptPath = Join-Path $receiptDir "daytrade-futopt-preopen-evidence-$Slot-$compactDate.json"
$logPath = Join-Path $logDir "daytrade-futopt-preopen-evidence-$compactDate.log"
$lockWaitSeconds = 0
$retryCount = 0
$lockOwner = $null
$verifierExit = $null
$verifierPayload = $null

function Write-TaskLog([string]$Message) {
  "[{0}] slot={1} {2}" -f ([DateTimeOffset]::UtcNow.ToString("o")), $Slot, $Message |
    Add-Content -LiteralPath $logPath -Encoding utf8
}

function Convert-FutoptStatusTimeUtc {
  param([object]$Value)
  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $styles = [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal
  $parsed = [DateTimeOffset]::MinValue
  if ([DateTimeOffset]::TryParse($text, [System.Globalization.CultureInfo]::InvariantCulture, $styles, [ref]$parsed)) {
    return $parsed.ToUniversalTime()
  }
  return $null
}

function Get-FutoptCollectorHealth {
  $statusPath = Join-Path $RuntimeDir "state\fugle-futopt-websocket-status.json"
  try {
    $status = Get-Content -LiteralPath $statusPath -Raw -Encoding utf8 | ConvertFrom-Json -DateKind String
    $updatedAt = Convert-FutoptStatusTimeUtc $status.updatedAt
    if ($null -eq $updatedAt) { throw "status_updated_at_unparseable" }
    $ageSeconds = [Math]::Max(0, ([DateTimeOffset]::UtcNow - $updatedAt).TotalSeconds)
    return [ordered]@{
      readable = $true
      ready = ($status.websocketConnected -eq $true -and $status.websocketAuthenticated -eq $true -and $status.formalReady -eq $true -and $ageSeconds -le 90)
      age_seconds = [int][Math]::Floor($ageSeconds)
      connected = ($status.websocketConnected -eq $true)
      authenticated = ($status.websocketAuthenticated -eq $true)
      formal_ready = ($status.formalReady -eq $true)
      reason = [string]$status.formalReadyReason
      updated_at = [string]$status.updatedAt
      updated_at_utc = $updatedAt.ToString("o")
    }
  } catch {
    return [ordered]@{ readable=$false; ready=$false; age_seconds=$null; connected=$false; authenticated=$false; formal_ready=$false; reason="status_unreadable" }
  }
}

function Write-Receipt {
  param(
    [bool]$Ok,
    [string]$ReasonCode,
    [string]$SlotResult,
    [Nullable[int]]$ProducerExit = $null,
    [bool]$ProducerOk = $false,
    $CollectorHealth = $null
  )
  [ordered]@{
    ok = $Ok
    status = if ($Ok) { "complete" } else { "failed" }
    complete = $Ok
    exitCode = if ($Ok) { 0 } else { 1 }
    contract = "daytrade_futopt_preopen_natural_slot_v2"
    trade_date = $tradeDate
    slot = $Slot
    capture_slot = $Slot
    checked_at = [DateTimeOffset]::UtcNow.ToString("o")
    natural_schedule_evidence = ($actualSlot -eq $Slot)
    uses_0900_data = $false
    evidence_window = "08:45-08:59 Asia/Taipei"
    runner = "ops/Run-DaytradeFutoptPreopenEvidence.ps1"
    producer = "scripts/run-daytrade-near-one-source.js"
    verifier = "scripts/verify-star-preopen-slot-symbol-contract.js"
    verifier_exit = $verifierExit
    verifier_receipt = $verifierPayload
    slot_receipt_view = "v_fugle_daytrade_star_slot_verification_readback"
    symbol_results_view = "v_fugle_daytrade_star_slot_symbol_readback"
    producer_exit = $ProducerExit
    producer_ok = $ProducerOk
    collector_health = $CollectorHealth
    lock_wait_seconds = $lockWaitSeconds
    lock_owner = $lockOwner
    retry_count = $retryCount
    slot_result = $SlotResult
    first_blocker = if ($Ok) { $null } else { $ReasonCode }
    reason_code = $ReasonCode
    writes_formal_candidate = $false
    formal_candidate_allowed = $false
    publish_allowed = $false
    log_file = $logPath
  } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receiptPath -Encoding utf8
}

if ($actualSlot -ne $Slot) {
  Write-TaskLog "fail_closed actual_slot=$actualSlot reason=natural_schedule_minute_mismatch"
  Write-Receipt $false "natural_schedule_minute_mismatch" "wrong_slot"
  exit 1
}
if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $producer) -or -not (Test-Path -LiteralPath $canonicalVerifier)) {
  Write-Receipt $false "producer_or_node_missing" "blocked"
  exit 1
}
if (Test-Path -LiteralPath $calendar) {
  $calendarOutput = & $node $calendar "--label=Daytrade futopt preopen evidence" "--receipt=1" 2>&1
  $calendarExit = $LASTEXITCODE
  $calendarOutput | ForEach-Object { Write-TaskLog "market_calendar: $_" }
  if ($calendarExit -eq 10) { Write-Receipt $true "market_calendar_non_trading_day" "skipped"; exit 0 }
  if ($calendarExit -ne 0) { Write-Receipt $false "market_calendar_guard_failed" "blocked" $calendarExit; exit 1 }
}

$collectorHealth = Get-FutoptCollectorHealth
if (-not $collectorHealth.ready) {
  Write-TaskLog "fail_closed reason=futopt_collector_not_ready age=$($collectorHealth.age_seconds)"
  Write-Receipt $false "futopt_collector_not_ready" "blocked" $null $false $collectorHealth
  exit 1
}

$producerExit = 1
$producerOutput = @()
for ($attempt = 1; $attempt -le 3; $attempt++) {
  $producerOutput = & $node --use-system-ca $producer --apply --once "--slot=$Slot" "--trade-date=$tradeDate" 2>&1
  $producerExit = $LASTEXITCODE
  $producerText = ($producerOutput | Out-String).Trim()
  $producerOutput | ForEach-Object { Write-TaskLog "producer_attempt=${attempt}: $_" }
  if ($producerExit -eq 0) { break }
  if ($producerText -match "already_running") {
    $retryCount += 1
    $lockPath = Join-Path $RuntimeDir "locks\daytrade-near-one-source.lock"
    if (Test-Path -LiteralPath $lockPath) {
      try { $lockOwner = (Get-Content -LiteralPath $lockPath -Raw -Encoding utf8).Trim() } catch { $lockOwner = "unreadable_lock_owner" }
    }
  }
  if ($attempt -lt 3) {
    $delay = 2 * $attempt
    $lockWaitSeconds += $delay
    Start-Sleep -Seconds $delay
  }
}
if ($producerExit -ne 0) {
  $reason = if ((($producerOutput | Out-String)) -match "already_running") { "PREOPEN_SLOT_LOCK_CONTENTION" } else { "producer_exit_nonzero" }
  Write-Receipt $false $reason "producer_failed" $producerExit $false $collectorHealth
  exit 1
}
try { $payload = (($producerOutput | Out-String).Trim() | ConvertFrom-Json) } catch {
  Write-Receipt $false "producer_output_invalid_json" "producer_failed" $producerExit $false $collectorHealth
  exit 1
}
if ($payload.ok -ne $true -or $payload.naturalScheduleEvidence -ne $true) {
  Write-Receipt $false "producer_evidence_incomplete" "evidence_incomplete" $producerExit $false $collectorHealth
  exit 1
}
$verifierOutput = & $node --use-system-ca $canonicalVerifier "--slot=$Slot" "--trade-date=$tradeDate" --publish 2>&1
$verifierExit = $LASTEXITCODE
$verifierOutput | ForEach-Object { Write-TaskLog "canonical_verifier: $_" }
try { $verifierPayload = (($verifierOutput | Out-String).Trim() | ConvertFrom-Json) } catch {
  Write-Receipt $false "canonical_slot_verifier_output_invalid" "verifier_failed" $producerExit $true $collectorHealth
  exit 1
}
if ($verifierPayload.complete -ne $true -or $verifierExit -ne 0) {
  $reason = if ($verifierPayload.first_blocker) { [string]$verifierPayload.first_blocker } else { "canonical_slot_verifier_incomplete" }
  Write-Receipt $false $reason "verifier_incomplete" $producerExit $true $collectorHealth
  exit 1
}
Write-Receipt $true "preopen_slot_verified_and_published" "complete" $producerExit $true $collectorHealth
exit 0
