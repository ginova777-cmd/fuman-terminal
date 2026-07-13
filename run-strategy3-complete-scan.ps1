$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_DATA_DIR = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $env:FUMAN_RUNTIME_DIR "data" }
$env:FUMAN_CACHE_DIR = if ($env:FUMAN_CACHE_DIR) { $env:FUMAN_CACHE_DIR } else { Join-Path $env:FUMAN_RUNTIME_DIR "cache" }
$env:FUMAN_STATE_DIR = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $env:FUMAN_RUNTIME_DIR "state" }
$env:NODE_OPTIONS = "--use-system-ca"
foreach ($name in @("LINE_CHANNEL_ACCESS_TOKEN", "LINE_TARGET_ID", "LINE_TO", "LINE_USER_ID", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_TO")) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    if ($value) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
  }
}

$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = Join-Path $env:FUMAN_RUNTIME_DIR "logs"
New-Item -ItemType Directory -Force -Path $logDir, $env:FUMAN_DATA_DIR, $env:FUMAN_CACHE_DIR, $env:FUMAN_STATE_DIR | Out-Null
$log = Join-Path $logDir ("strategy3-complete-scan-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
$writeCodeRepoReceipts = ($env:FUMAN_STRATEGY3_RECEIPT_WRITE_CODE_REPO -eq "1") -or ($env:FUMAN_SCAN_RECEIPTS_WRITE_CODE_REPO -eq "1") -or ($env:FUMAN_WRITE_CODE_REPO_DATA -eq "1")
$syncReceiptDir = if ($writeCodeRepoReceipts) { Join-Path $PSScriptRoot "data\scan-receipts" } else { $null }
$receiptMode = if ($syncReceiptDir) { "runtime+code-repo" } else { "runtime-only" }
$initDirs = @($receiptDir)
if ($syncReceiptDir) { $initDirs += $syncReceiptDir }
New-Item -ItemType Directory -Force -Path $initDirs | Out-Null
$scanStartedAt = (Get-Date).ToString("o")

function Write-Strategy3CompleteLog($Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Write-Strategy3Receipt($Status, $ExitCode, $Complete, $Matches, $RunId, $Warnings = @(), $BlockingReason = "") {
  $receipt = [ordered]@{
    strategy = "strategy3"
    label = "strategy3 raw refresh"
    tier = "critical"
    startedAt = $scanStartedAt
    finishedAt = (Get-Date).ToString("o")
    status = $Status
    exitCode = $ExitCode
    scanned = 0
    total = 0
    matches = $Matches
    complete = $Complete
    qualityStatus = if ($Complete) { "complete" } else { "" }
    fallback = $false
    runId = $RunId
    payloadPath = (Join-Path $env:FUMAN_DATA_DIR "strategy3-latest.json")
    warnings = @($Warnings)
    blockingReason = $BlockingReason
    log = $log
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptDir "strategy3.json") -Encoding utf8
  if ($syncReceiptDir) {
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $syncReceiptDir "strategy3.json") -Encoding utf8
  }
}

function Write-Strategy3BlockedReceipt($Reason, $PreviousGoodRunId, $PreviousGoodCount, $Stage = "runner-source-gate") {
  $safeRunId = if ([string]::IsNullOrWhiteSpace([string]$PreviousGoodRunId)) { "missing-run" } else { ([string]$PreviousGoodRunId -replace "[^a-zA-Z0-9_-]", "-") }
  $receiptFile = Join-Path $receiptDir ("strategy3-blocked-runner-{0}-{1}.json" -f (Get-Date -Format yyyyMMdd-HHmmss), $safeRunId)
  $capturedAt = (Get-Date).ToString("o")
  $requiredFields = @(
    "source_snapshot_captured_at",
    "source_status_at_run",
    "quote_coverage_at_run",
    "intraday_1m_readiness_at_run",
    "ma_readiness_at_run",
    "preopen_futopt_daily_readiness_at_run",
    "run_quality_at_publish",
    "fallbackUsed",
    "fallbackScope",
    "fallbackAllowed",
    "fallbackDetails",
    "fallbackContract",
    "degradedBlocksLatest",
    "preservePreviousGood",
    "writeBudget",
    "retentionOk",
    "evidenceStatus",
    "unattendedStatus",
    "requiredFields",
    "blankCounts",
    "sampleMissingRows",
    "blockedReason",
    "scanner_block_reason"
  )
  $sourceStatusAtRun = [ordered]@{
    ok = $false
    ready = $false
    status = "not_ready"
    reason = $Reason
    source = "fugle_quotes_latest+v_strategy3_intraday_1m_status+stock_daily_volume"
  }
  $quoteCoverageAtRun = [ordered]@{
    ok = $false
    ready = $false
    status = "blocked"
    reason = $Reason
  }
  $intradayReadinessAtRun = [ordered]@{
    ok = $false
    ready = $false
    status = "not_ready"
    reason = $Reason
  }
  $maReadinessAtRun = [ordered]@{
    ok = $false
    ready = $false
    status = "blocked"
    reason = $Reason
  }
  $preopenFutoptDailyReadinessAtRun = [ordered]@{
    ok = $false
    ready = $false
    status = "blocked"
    reason = $Reason
    preopen = [ordered]@{ status = "not_required"; ok = $true; reason = "strategy3 publish gate does not require preopen snapshot" }
    futopt = [ordered]@{ status = "not_required"; ok = $true; reason = "strategy3 publish gate does not require futopt source" }
    dailyVolume = [ordered]@{ status = "unknown"; ok = $false; reason = $Reason }
  }
  $writeBudget = [ordered]@{
    ok = $false
    status = "blocked"
    mode = "complete-run-preserve-on-degraded"
    latestOverwriteBlockedOnDegraded = $true
    reason = $Reason
  }
  $fallbackContract = [ordered]@{
    source = [ordered]@{ allowed = $false; formalSource = $true; publishGateSource = "fugle_quotes_latest+v_strategy3_intraday_1m_status+stock_daily_volume" }
    tv_candle_diagnostic = [ordered]@{ allowed = $true; formalSource = $false; publishGateSource = "fugle_quotes_latest+v_strategy3_intraday_1m_status+stock_daily_volume" }
  }
  $runQualityAtPublish = [ordered]@{
    publishAllowed = $false
    latestOverwriteAllowed = $false
    latestWriteAttempted = $false
    latestPointerUpdated = $false
    emptyResultWritten = $false
    preservePreviousGood = $true
    blockedReceiptWritten = $true
    degradedBlocksLatest = $true
    fallbackUsed = $false
    fallbackScope = @()
    fallbackAllowed = $false
    fallbackDetails = @()
    fallbackContract = $fallbackContract
    writeBudget = $writeBudget
    retentionOk = $true
    evidenceStatus = "insufficient"
    unattendedStatus = "NO"
    blockedReason = $Reason
    scanner_block_reason = $Reason
    resultCount = 0
    readbackCount = $PreviousGoodCount
  }
  $receipt = [ordered]@{
    ok = $false
    strategy = "strategy3"
    stage = $Stage
    runId = $PreviousGoodRunId
    previousGoodRunId = $PreviousGoodRunId
    previousGoodCount = $PreviousGoodCount
    startedAt = $scanStartedAt
    finishedAt = (Get-Date).ToString("o")
    blockedReason = $Reason
    scanner_block_reason = $Reason
    source_snapshot_captured_at = $capturedAt
    source_status_at_run = $sourceStatusAtRun
    quote_coverage_at_run = $quoteCoverageAtRun
    intraday_1m_readiness_at_run = $intradayReadinessAtRun
    ma_readiness_at_run = $maReadinessAtRun
    preopen_futopt_daily_readiness_at_run = $preopenFutoptDailyReadinessAtRun
    run_quality_at_publish = $runQualityAtPublish
    publishAllowed = $false
    latestOverwriteAllowed = $false
    latestWriteAttempted = $false
    latestPointerUpdated = $false
    emptyResultWritten = $false
    preservePreviousGood = $true
    blockedReceiptWritten = $true
    degradedBlocksLatest = $true
    fallbackUsed = $false
    fallbackScope = @()
    fallbackAllowed = $false
    fallbackDetails = @()
    fallbackContract = $fallbackContract
    writeBudget = $writeBudget
    retentionOk = $true
    evidenceStatus = "insufficient"
    unattendedStatus = "NO"
    requiredFields = $requiredFields
    blankCounts = [ordered]@{}
    sampleMissingRows = @()
    receiptFile = $receiptFile
    log = $log
  }
  $receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $receiptFile -Encoding utf8
  if ($syncReceiptDir) {
    $receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $syncReceiptDir (Split-Path -Leaf $receiptFile)) -Encoding utf8
  }
  return $receiptFile
}

. "${PSScriptRoot}\schedule-guard.ps1"
Write-Strategy3CompleteLog "Strategy3 receipt mode=$receiptMode"
Invoke-FumanWeekdayGuard -Label "Strategy3 complete scan" -LogPath $log

function Get-TaipeiTodayYmd {
  $taipeiNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Taipei Standard Time")
  return $taipeiNow.ToString("yyyyMMdd")
}

function Convert-DateTextToYmd($Value) {
  $text = [string]$Value
  if ($text -match "^\d{8}$") { return $text }
  if ($text -match "^\d{4}-\d{2}-\d{2}") { return $text.Substring(0, 10).Replace("-", "") }
  return ""
}

function Assert-Strategy3CompleteApi {
  param(
    [switch]$AllowPreviousComplete
  )
  $url = "https://fuman-terminal.vercel.app/api/scorecard?live=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45
  $scorecard = $response.Content | ConvertFrom-Json -AsHashtable
  $report = @($scorecard["sourceReports"]) | Where-Object { $_["key"] -eq "strategy3" } | Select-Object -First 1
  if ($response.StatusCode -ne 200 -or -not $report -or [string]::IsNullOrWhiteSpace([string]$report["runId"])) {
    throw "Strategy3 scorecard sourceReport verification failed status=$($response.StatusCode) runId=$($report["runId"])"
  }
  $runId = [string]$report["runId"]
  $today = Get-TaipeiTodayYmd
  $usedDate = if ($runId -match "strategy3-(\d{8})") { $Matches[1] } else { Convert-DateTextToYmd $report["date"] }
  $count = if ($null -ne $report["count"]) { [int]$report["count"] } else { 0 }
  if (-not $AllowPreviousComplete -and $usedDate -ne $today) { throw "Strategy3 scorecard sourceReport stale; usedDate=$usedDate today=$today" }
  if ($AllowPreviousComplete -and ([string]::IsNullOrWhiteSpace($usedDate) -or $usedDate -gt $today)) { throw "Strategy3 scorecard sourceReport invalid latest complete date; usedDate=$usedDate today=$today" }
  $allowZeroCompleteToday = (-not $AllowPreviousComplete) -and $usedDate -eq $today
  if ($count -le 0 -and -not $allowZeroCompleteToday) { throw "Strategy3 scorecard sourceReport empty; count=$count" }
  $payload = [pscustomobject]@{
    usedDate = $usedDate
    count = $count
    cacheSource = "supabase-api"
    runId = $runId
    transport = [pscustomobject]@{ gate = "run_id" }
  }
  Write-Strategy3CompleteLog "Strategy3 scorecard sourceReport verified: usedDate=$usedDate count=$count runId=$runId cacheSource=supabase-api gate=run_id"
  return $payload
}

function Test-Strategy3ControlledSourceNotReady($Message) {
  $text = [string]$Message
  return $text -match "sessionReadyCount .* below" `
    -or $text -match "intraday1mReadyCount .* below" `
    -or $text -match "Strategy3 source drift failed" `
    -or $text -match "v_strategy3_intraday_1m_status rows=\d+/\d+" `
    -or $text -match "v_strategy3_quote_ready .*statement timeout"
}

Write-Strategy3CompleteLog "Strategy3 complete scan start"
Write-Strategy3CompleteLog "Strategy3 ready snapshot refresh start"
& $nodeExe "scripts\refresh-strategy3-ready-snapshot.js" >> $log 2>&1
$refreshExitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
if ($refreshExitCode -ne 0) {
  Write-Strategy3CompleteLog "Strategy3 ready snapshot refresh failed with exit code $refreshExitCode; resource health gate will decide preserve/publish."
} else {
  Write-Strategy3CompleteLog "Strategy3 ready snapshot refresh ok"
}
. "${PSScriptRoot}\scanner-resource-health.ps1"
$resourceGate = Invoke-ScannerResourceHealthGate -Strategy "strategy3" -LogPath $log
$sessionGate = $null
if ($resourceGate.PreserveLatest -and $resourceGate.Status -eq "not_ready" -and $resourceGate.Reason -match "intraday1m|latest_candle_date|ready_snapshot|snapshot_rows|sessionReadyCount") {
  $sessionText = (& $nodeExe "scripts\check-strategy3-session-readiness.js" 2>&1) -join "`n"
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy3 session1m live-source gate output: $sessionText"
  try {
    $sessionGate = $sessionText | ConvertFrom-Json -ErrorAction Stop
  } catch {
    $sessionGate = $null
  }
  if ($sessionGate -and $sessionGate.ready -eq $true) {
    Write-Strategy3CompleteLog "Strategy3 ready_snapshot health is stale, but live 09:00-12:59 source is ready; continuing scan. session1m=$($sessionGate.sessionReadyCount)/$($sessionGate.minIntraday1mCandidates) latest=$($sessionGate.latestCandleTime)"
    $resourceGate = [pscustomobject]@{
      PreserveLatest = $false
      Status = "ready"
      Reason = "live 09:00-12:59 source ready; ready_snapshot refresh blocked by DB grant/function"
    }
  }
}
if ($resourceGate.PreserveLatest) {
  $reason = "resource health $($resourceGate.Status): $($resourceGate.Reason)"
  Write-Strategy3CompleteLog "Strategy3 source gate blocked new publish; preserving latest complete run. $reason"
  $verifiedPayload = Assert-Strategy3CompleteApi -AllowPreviousComplete
  $snapshotScript = "${PSScriptRoot}\refresh-desktop-route-snapshot.ps1"
  if (Test-Path -LiteralPath $snapshotScript) {
    & $snapshotScript -Source "strategy3" -LogPath $log
    if ($LASTEXITCODE -ne 0) {
      throw "Strategy3 desktop snapshot refresh failed with exit code $LASTEXITCODE"
    }
  }
  $blockedReceiptFile = Write-Strategy3BlockedReceipt $reason ([string]$verifiedPayload.runId) ([int]$verifiedPayload.count) "runner-resource-gate"
  Write-Strategy3Receipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId) @($reason, "blockedReceipt=$blockedReceiptFile") $reason
  Write-Strategy3CompleteLog "Strategy3 resource-gated scan end; preserved runId=$($verifiedPayload.runId) usedDate=$($verifiedPayload.usedDate)"
  exit 0
}
$scannerError = ""
try {
  & $nodeExe "scripts\scan-strategy3-cache.js" >> $log 2>&1
  $exitCode = $LASTEXITCODE
  if ($null -eq $exitCode) { $exitCode = 0 }
  if ($exitCode -ne 0) { throw "Strategy3 complete scanner failed with exit code $exitCode; log=$log" }
} catch {
  $scannerError = $_.Exception.Message
  $tailText = (Get-Content -LiteralPath $log -ErrorAction SilentlyContinue | Select-Object -Last 40) -join "`n"
  if (-not (Test-Strategy3ControlledSourceNotReady "$scannerError`n$tailText")) {
    throw
  }
  Write-Strategy3CompleteLog "Strategy3 source not ready; preserving latest complete run instead of poisoning receipt. error=$scannerError"
  $verifiedPayload = Assert-Strategy3CompleteApi -AllowPreviousComplete
  $snapshotScript = "${PSScriptRoot}\refresh-desktop-route-snapshot.ps1"
  if (Test-Path -LiteralPath $snapshotScript) {
    & $snapshotScript -Source "strategy3" -LogPath $log
    if ($LASTEXITCODE -ne 0) {
      throw "Strategy3 desktop snapshot refresh failed with exit code $LASTEXITCODE"
    }
  }
  $reason = "source not ready; preserved latest complete run: $scannerError"
  $blockedReceiptFile = Write-Strategy3BlockedReceipt $reason ([string]$verifiedPayload.runId) ([int]$verifiedPayload.count) "runner-scanner-controlled-failure"
  Write-Strategy3Receipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId) @($reason, "blockedReceipt=$blockedReceiptFile") $reason
  Write-Strategy3CompleteLog "Strategy3 deferred complete scan end; preserved runId=$($verifiedPayload.runId) usedDate=$($verifiedPayload.usedDate)"
  exit 0
}

$apiVerified = $false
$lastApiError = ""
$verifiedPayload = $null
for ($attempt = 1; $attempt -le 6; $attempt++) {
  try {
    $verifiedPayload = Assert-Strategy3CompleteApi
    $apiVerified = $true
    break
  } catch {
    $lastApiError = $_.Exception.Message
    Write-Strategy3CompleteLog "Strategy3 complete API verify attempt $attempt/6 failed: $lastApiError"
    if ($attempt -lt 6) { Start-Sleep -Seconds 5 }
  }
}
if (-not $apiVerified) { throw "Strategy3 complete API verification failed after retries: $lastApiError" }

$snapshotScript = "${PSScriptRoot}\refresh-desktop-route-snapshot.ps1"
if (Test-Path -LiteralPath $snapshotScript) {
  & $snapshotScript -Source "strategy3" -LogPath $log
  if ($LASTEXITCODE -ne 0) {
    throw "Strategy3 desktop snapshot refresh failed with exit code $LASTEXITCODE"
  }
} else {
  Write-Strategy3CompleteLog "Strategy3 desktop snapshot refresh skipped; helper not found."
}

Write-Strategy3Receipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId)
Write-Strategy3CompleteLog "Strategy3 complete scan end; Supabase complete run + no-store API is the terminal fast path"

