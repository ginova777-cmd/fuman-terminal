$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repo = "${PSScriptRoot}"
$runtime = "C:\fuman-runtime"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$gitPath = "C:\Program Files\Git\cmd"
$env:Path = "$gitPath;C:\Program Files\nodejs;" + $env:Path
$env:NODE_OPTIONS = "--use-system-ca"
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"

Set-Location $repo

$logDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("strategy4-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
$scanStartedAt = (Get-Date).ToString("o")
$strategy4Stamp = Get-Date -Format yyyyMMdd

function Write-Log($message) {
  $message | Tee-Object -FilePath $log -Append | Out-Null
}

function Write-Strategy4Receipt($Status, $ExitCode, $Complete, $Matches, $RunId, $Warnings = @(), $BlockingReason = "") {
  $receipt = [ordered]@{
    strategy = "strategy4"
    label = "strategy4 full scan"
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
    payloadPath = "supabase:strategy4_scan_results"
    warnings = @($Warnings)
    blockingReason = $BlockingReason
    log = $log
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptDir "strategy4.json") -Encoding utf8
}

function Assert-Strategy4LatestApi {
  $apiUrl = "https://fuman-terminal.vercel.app/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1&fresh=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $apiResponse = Invoke-WebRequest -Uri $apiUrl -UseBasicParsing -TimeoutSec 45
  $payload = $apiResponse.Content | ConvertFrom-Json
  if ($apiResponse.StatusCode -ne 200) { throw "Strategy4 API HTTP $($apiResponse.StatusCode)" }
  if ($payload.ok -ne $true) { throw "Strategy4 API ok=false error=$($payload.error)" }
  if ([string]::IsNullOrWhiteSpace([string]$payload.runId)) { throw "Strategy4 API missing runId" }
  if (([int]$payload.count) -le 0) { throw "Strategy4 API empty count=$($payload.count)" }
  Write-Log "Strategy4 latest API verified: runId=$($payload.runId) count=$($payload.count) scanStamp=$($payload.scanStamp)"
  return $payload
}

function Invoke-Strategy4SnapshotRefresh($RunId = "", $Count = 0, $Warning = "") {
  $snapshotScript = Join-Path $repo "refresh-desktop-route-snapshot.ps1"
  if (Test-Path -LiteralPath $snapshotScript) {
    & $snapshotScript -Source "strategy4" -LogPath $log
    if ($LASTEXITCODE -ne 0) {
      Write-Log "Strategy4 desktop snapshot refresh failed with exit code $LASTEXITCODE"
      Write-Strategy4Receipt "failed" $LASTEXITCODE $false 0 $RunId @("desktop snapshot refresh exit code $LASTEXITCODE") "critical scan failed during desktop snapshot refresh"
      exit $LASTEXITCODE
    }
  } else {
    Write-Log "Strategy4 desktop snapshot refresh skipped; helper not found."
  }
  if ($Warning) {
    Write-Strategy4Receipt "complete" 0 $true $Count $RunId @($Warning)
  }
}

function Invoke-Strategy4SourceRepair {
  param([string]$Reason = "")

  if ($env:STRATEGY4_DISABLE_SOURCE_REPAIR -eq "1") {
    Write-Log "Strategy4 source repair skipped by STRATEGY4_DISABLE_SOURCE_REPAIR=1. reason=$Reason"
    return $false
  }

  Write-Log "Strategy4 source repair start. reason=$Reason"
  $previousValues = @{
    STRATEGY4_USE_MIS = $env:STRATEGY4_USE_MIS
    STRATEGY4_PREWARM_BATCH_SIZE = $env:STRATEGY4_PREWARM_BATCH_SIZE
    STRATEGY4_PREWARM_BATCHES_PER_RUN = $env:STRATEGY4_PREWARM_BATCHES_PER_RUN
    STRATEGY4_PREWARM_SLEEP_MS = $env:STRATEGY4_PREWARM_SLEEP_MS
    STRATEGY4_PREWARM_MAX_REMAINING_MISS = $env:STRATEGY4_PREWARM_MAX_REMAINING_MISS
    STRATEGY4_HISTORY_LOOKBACK_DAYS = $env:STRATEGY4_HISTORY_LOOKBACK_DAYS
    STRATEGY4_HISTORY_CACHE_ROWS = $env:STRATEGY4_HISTORY_CACHE_ROWS
    STRATEGY4_PREWARM_SUPABASE_ONLY = $env:STRATEGY4_PREWARM_SUPABASE_ONLY
    STRATEGY4_ALLOW_YAHOO_FALLBACK = $env:STRATEGY4_ALLOW_YAHOO_FALLBACK
  }

  try {
    $env:STRATEGY4_USE_MIS = "0"
    $env:STRATEGY4_PREWARM_BATCH_SIZE = "80"
    $env:STRATEGY4_PREWARM_BATCHES_PER_RUN = "999"
    $env:STRATEGY4_PREWARM_SLEEP_MS = "0"
    $env:STRATEGY4_PREWARM_MAX_REMAINING_MISS = "2000"
    $env:STRATEGY4_HISTORY_LOOKBACK_DAYS = "420"
    $env:STRATEGY4_HISTORY_CACHE_ROWS = "260"
    $env:STRATEGY4_PREWARM_SUPABASE_ONLY = "0"
    $env:STRATEGY4_ALLOW_YAHOO_FALLBACK = "0"

    & $nodeExe "scripts\prewarm-strategy4-history-cache.js" *>&1 | Tee-Object -FilePath $log -Append
    $prewarmExit = $LASTEXITCODE
    if ($prewarmExit -ne 0) {
      Write-Log "Strategy4 source repair prewarm failed with exit code $prewarmExit"
      return $false
    }

    $importScript = Join-Path $repo "ops\public-slot\Import-Strategy4DailyCacheToSupabase.ps1"
    if (-not (Test-Path -LiteralPath $importScript)) {
      Write-Log "Strategy4 source repair import skipped; helper not found: $importScript"
      return $false
    }

    & "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File $importScript -RetainTradeDays 120 -BatchSize 500 *>&1 | Tee-Object -FilePath $log -Append
    $importExit = $LASTEXITCODE
    if ($importExit -ne 0) {
      Write-Log "Strategy4 source repair import failed with exit code $importExit"
      return $false
    }

    Write-Log "Strategy4 source repair complete."
    return $true
  } finally {
    foreach ($key in $previousValues.Keys) {
      if ($null -ne $previousValues[$key]) {
        Set-Item -Path "Env:$key" -Value $previousValues[$key]
      } else {
        Remove-Item "Env:$key" -ErrorAction SilentlyContinue
      }
    }
  }
}

Write-Log "=== Strategy4 full scan start $(Get-Date) ==="
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy4 full scan" -LogPath $log

& $nodeExe "scripts\verify-supabase-publish-hard-gate.js" "--strategy=strategy4" *>&1 | Tee-Object -FilePath $log -Append
$publishGateExit = $LASTEXITCODE
if ($publishGateExit -ne 0) {
  $reason = "Strategy4 Supabase publish hard gate blocked new publish; preserving latest complete run. exit=$publishGateExit"
  Write-Log $reason
  try {
    $latestPayload = Assert-Strategy4LatestApi
    Invoke-Strategy4SnapshotRefresh ([string]$latestPayload.runId) ([int]$latestPayload.count) $reason
  } catch {
    Write-Log "Strategy4 latest API verification after publish gate block failed: $($_.Exception.Message)"
  }
  Write-Strategy4Receipt "failed" $publishGateExit $false 0 "" @($reason) $reason
  exit $publishGateExit
}
. "${PSScriptRoot}\scanner-resource-health.ps1"
$resourceGate = Invoke-ScannerResourceHealthGate -Strategy "strategy4" -LogPath $log
if ($resourceGate.PreserveLatest) {
  $reason = "resource health $($resourceGate.Status): $($resourceGate.Reason)"
  Write-Log "Strategy4 source gate blocked new publish; attempting source repair before preserving latest. $reason"
  $repairOk = Invoke-Strategy4SourceRepair $reason
  if ($repairOk) {
    $resourceGate = Invoke-ScannerResourceHealthGate -Strategy "strategy4" -LogPath $log
  }
  if ($resourceGate.PreserveLatest) {
    $reason = "resource health $($resourceGate.Status): $($resourceGate.Reason)"
    Write-Log "Strategy4 source gate still blocked after repair; preserving latest complete run. $reason"
    $latestPayload = Assert-Strategy4LatestApi
    Invoke-Strategy4SnapshotRefresh ([string]$latestPayload.runId) ([int]$latestPayload.count) $reason
    exit 0
  }
  Write-Log "Strategy4 source gate recovered after repair; continuing full scan."
}
if ($env:STRATEGY4_ALLOW_BEFORE_1600 -ne "1") {
  try {
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    $taipeiNow = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
  } catch {
    $taipeiNow = Get-Date
  }
  $startAt = [TimeSpan]::Parse("16:00:00")
  if ($taipeiNow.TimeOfDay -lt $startAt) {
    Write-Log "Strategy4 full scan skipped before 16:00 Taipei: $($taipeiNow.ToString('yyyy/MM/dd HH:mm:ss'))"
    $latestPayload = Assert-Strategy4LatestApi
    Invoke-Strategy4SnapshotRefresh ([string]$latestPayload.runId) ([int]$latestPayload.count) "before 16:00 Taipei; preserved latest complete run"
    exit 0
  }
}

$env:FULL_SCAN = "1"
$env:STRATEGY4_BATCH_SIZE = "80"
$env:STRATEGY4_BATCHES_PER_RUN = "999"
$env:STRATEGY4_USE_MIS = "1"
$env:STRATEGY4_FAIL_ON_INCOMPLETE = "1"
$env:STRATEGY4_SYNC_PARTIAL = "1"
$env:STRATEGY4_PARTIAL_SYNC_EVERY_CHUNKS = "3"
$env:STRATEGY4_SCAN_STAMP = $strategy4Stamp

try {
  & $nodeExe "scripts\verify-strategy4-data-sources.js" *>&1 | Tee-Object -FilePath $log -Append
  $sourceExit = $LASTEXITCODE
  if ($sourceExit -ne 0) {
    Write-Log "Strategy4 data source verification failed with exit code $sourceExit"
    Write-Strategy4Receipt "failed" $sourceExit $false 0 "" @("data source verification exit code $sourceExit") "critical scan failed during data source verification"
    exit $sourceExit
  }
  Write-Log "Strategy4 contract seed fallback enabled for cache-miss self-heal."
  $previousContractFallback = $env:STRATEGY4_SUPABASE_ALLOW_EXTERNAL_FALLBACK
  try {
    $env:STRATEGY4_SUPABASE_ALLOW_EXTERNAL_FALLBACK = "1"
    & $nodeExe "scripts\verify-strategy4-contract.js" *>&1 | Tee-Object -FilePath $log -Append
    $contractExit = $LASTEXITCODE
  } finally {
    if ($null -ne $previousContractFallback) { $env:STRATEGY4_SUPABASE_ALLOW_EXTERNAL_FALLBACK = $previousContractFallback } else { Remove-Item Env:STRATEGY4_SUPABASE_ALLOW_EXTERNAL_FALLBACK -ErrorAction SilentlyContinue }
  }
  if ($contractExit -ne 0) {
    Write-Log "Strategy4 contract verification failed with exit code $contractExit"
    Write-Strategy4Receipt "failed" $contractExit $false 0 "" @("contract verification exit code $contractExit") "critical scan failed during contract verification"
    exit $contractExit
  }
  Write-Log "=== Strategy4 Supabase daily volume cache prewarm start $(Get-Date) ==="
  $previousPrewarmBatchSize = $env:STRATEGY4_PREWARM_BATCH_SIZE
  $previousPrewarmBatches = $env:STRATEGY4_PREWARM_BATCHES_PER_RUN
  $previousPrewarmSleep = $env:STRATEGY4_PREWARM_SLEEP_MS
  $previousPrewarmMaxMiss = $env:STRATEGY4_PREWARM_MAX_REMAINING_MISS
  $previousPrewarmUseMis = $env:STRATEGY4_USE_MIS
  $previousHistoryLookbackDays = $env:STRATEGY4_HISTORY_LOOKBACK_DAYS
  $previousHistoryCacheRows = $env:STRATEGY4_HISTORY_CACHE_ROWS
  try {
    $env:STRATEGY4_USE_MIS = "0"
    $env:STRATEGY4_PREWARM_BATCH_SIZE = "80"
    $env:STRATEGY4_PREWARM_BATCHES_PER_RUN = "999"
    $env:STRATEGY4_PREWARM_SLEEP_MS = "0"
    $env:STRATEGY4_PREWARM_MAX_REMAINING_MISS = "2000"
    $env:STRATEGY4_HISTORY_LOOKBACK_DAYS = "420"
    $env:STRATEGY4_HISTORY_CACHE_ROWS = "260"
    & $nodeExe "scripts\prewarm-strategy4-history-cache.js" *>&1 | Tee-Object -FilePath $log -Append
    $prewarmExit = $LASTEXITCODE
  } finally {
    if ($null -ne $previousPrewarmBatchSize) { $env:STRATEGY4_PREWARM_BATCH_SIZE = $previousPrewarmBatchSize } else { Remove-Item Env:STRATEGY4_PREWARM_BATCH_SIZE -ErrorAction SilentlyContinue }
    if ($null -ne $previousPrewarmBatches) { $env:STRATEGY4_PREWARM_BATCHES_PER_RUN = $previousPrewarmBatches } else { Remove-Item Env:STRATEGY4_PREWARM_BATCHES_PER_RUN -ErrorAction SilentlyContinue }
    if ($null -ne $previousPrewarmSleep) { $env:STRATEGY4_PREWARM_SLEEP_MS = $previousPrewarmSleep } else { Remove-Item Env:STRATEGY4_PREWARM_SLEEP_MS -ErrorAction SilentlyContinue }
    if ($null -ne $previousPrewarmMaxMiss) { $env:STRATEGY4_PREWARM_MAX_REMAINING_MISS = $previousPrewarmMaxMiss } else { Remove-Item Env:STRATEGY4_PREWARM_MAX_REMAINING_MISS -ErrorAction SilentlyContinue }
    if ($null -ne $previousPrewarmUseMis) { $env:STRATEGY4_USE_MIS = $previousPrewarmUseMis } else { Remove-Item Env:STRATEGY4_USE_MIS -ErrorAction SilentlyContinue }
    if ($null -ne $previousHistoryLookbackDays) { $env:STRATEGY4_HISTORY_LOOKBACK_DAYS = $previousHistoryLookbackDays } else { Remove-Item Env:STRATEGY4_HISTORY_LOOKBACK_DAYS -ErrorAction SilentlyContinue }
    if ($null -ne $previousHistoryCacheRows) { $env:STRATEGY4_HISTORY_CACHE_ROWS = $previousHistoryCacheRows } else { Remove-Item Env:STRATEGY4_HISTORY_CACHE_ROWS -ErrorAction SilentlyContinue }
  }
  if ($prewarmExit -ne 0) {
    Write-Log "Strategy4 Supabase daily volume cache prewarm failed with exit code $prewarmExit"
    Write-Strategy4Receipt "failed" $prewarmExit $false 0 "" @("prewarm exit code $prewarmExit") "critical scan failed during history cache prewarm"
    exit $prewarmExit
  }
  Write-Log "=== Strategy4 Supabase daily volume cache prewarm end $(Get-Date) ==="
  & $nodeExe "scripts\scan-strategy4-cache.js" *>&1 | Tee-Object -FilePath $log -Append
  $scanExit = $LASTEXITCODE
} finally {
  Remove-Item Env:FULL_SCAN -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_BATCH_SIZE -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_BATCHES_PER_RUN -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_USE_MIS -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_FAIL_ON_INCOMPLETE -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_SYNC_PARTIAL -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_PARTIAL_SYNC_EVERY_CHUNKS -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_SCAN_STAMP -ErrorAction SilentlyContinue
}

if ($scanExit -ne 0) {
  Write-Log "Strategy4 scan failed with exit code $scanExit"
  Write-Strategy4Receipt "failed" $scanExit $false 0 "" @("scanner exit code $scanExit") "critical scan failed with exit code $scanExit"
  exit $scanExit
}

Write-Log "Strategy4 API-only: static JSON copy, slim generation, cache sync, postflight static checks, and JSON-based sheet upload are disabled."

$apiUrl = "https://fuman-terminal.vercel.app/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1&fresh=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
try {
  $apiResponse = Invoke-WebRequest -Uri $apiUrl -UseBasicParsing -TimeoutSec 45
  $strategy4Output = $apiResponse.Content | ConvertFrom-Json
  $cacheControl = [string]$apiResponse.Headers["Cache-Control"]
  if ($apiResponse.StatusCode -ne 200) { throw "HTTP $($apiResponse.StatusCode)" }
  if ($strategy4Output.ok -ne $true) { throw "api ok=false error=$($strategy4Output.error)" }
  if ([string]::IsNullOrWhiteSpace([string]$strategy4Output.runId)) { throw "missing runId" }
  if (([int]$strategy4Output.count) -le 0) { throw "empty count=$($strategy4Output.count)" }
  if ($cacheControl -notmatch "no-store") {
    Write-Log "Strategy4 API cache-control=$cacheControl; continuing after runId/count verification."
  }
  $apiUpdatedAtText = [string]($strategy4Output.updatedAt ?? $strategy4Output.generatedAt)
  if ([string]::IsNullOrWhiteSpace($apiUpdatedAtText)) { throw "missing updatedAt" }
  $apiUpdatedAt = [DateTimeOffset]::Parse($apiUpdatedAtText)
  $scanStarted = [DateTimeOffset]::Parse($scanStartedAt)
  if ($apiUpdatedAt -lt $scanStarted.AddMinutes(-5)) {
    throw "api did not expose this scan yet: runId=$($strategy4Output.runId) updatedAt=$apiUpdatedAtText scanStartedAt=$scanStartedAt"
  }
  Write-Log "Strategy4 API-only verification ok: runId=$($strategy4Output.runId) count=$($strategy4Output.count) scanStamp=$($strategy4Output.scanStamp) cache=$cacheControl"
} catch {
  Write-Log "Strategy4 API-only verification failed: $($_.Exception.Message)"
  Write-Strategy4Receipt "failed" 1 $false 0 "" @($_.Exception.Message) "critical scan failed during API verification"
  exit 1
}

Invoke-Strategy4SnapshotRefresh ([string]$strategy4Output.runId)

Write-Strategy4Receipt "complete" 0 $true ([int]$strategy4Output.count) ([string]$strategy4Output.runId)
Write-Log "=== Strategy4 full scan end $(Get-Date) ==="


