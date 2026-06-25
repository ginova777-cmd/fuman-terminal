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

function Invoke-CacheSyncWithRetry($scriptPath, $maxAttempts = 3) {
  $previousScopedPublish = $env:FUMAN_STRATEGY4_SCOPED_PUBLISH
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    Write-Log "=== Strategy4 clean cache sync attempt $attempt/$maxAttempts start $(Get-Date) ==="
    try {
      $env:FUMAN_STRATEGY4_SCOPED_PUBLISH = "1"
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Scope strategy4 *>&1 | Tee-Object -FilePath $log -Append | Out-Null
    } finally {
      if ($null -ne $previousScopedPublish) {
        $env:FUMAN_STRATEGY4_SCOPED_PUBLISH = $previousScopedPublish
      } else {
        Remove-Item Env:FUMAN_STRATEGY4_SCOPED_PUBLISH -ErrorAction SilentlyContinue
      }
    }
    $syncExit = $LASTEXITCODE
    if ($syncExit -eq 0) {
      Write-Log "=== Strategy4 clean cache sync attempt $attempt/$maxAttempts succeeded $(Get-Date) ==="
      return 0
    }

    Write-Log "Strategy4 clean cache sync attempt $attempt/$maxAttempts failed with exit code $syncExit"
    if ($attempt -lt $maxAttempts) {
      $delaySeconds = 30 * $attempt
      Write-Log "Retrying Strategy4 clean cache sync in $delaySeconds seconds."
      Start-Sleep -Seconds $delaySeconds
    }
  }

  return $syncExit
}

Write-Log "=== Strategy4 full scan start $(Get-Date) ==="
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy4 full scan" -LogPath $log
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
    exit 0
  }
}

$env:FULL_SCAN = "1"
$env:STRATEGY4_BATCH_SIZE = "80"
$env:STRATEGY4_BATCHES_PER_RUN = "999"
$env:STRATEGY4_USE_MIS = "1"
$env:STRATEGY4_FAIL_ON_INCOMPLETE = "1"
$env:STRATEGY4_ALLOW_PARTIAL_PUBLISH = "1"
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
  & $nodeExe "scripts\verify-strategy4-contract.js" *>&1 | Tee-Object -FilePath $log -Append
  $contractExit = $LASTEXITCODE
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
  try {
    $env:STRATEGY4_USE_MIS = "0"
    $env:STRATEGY4_PREWARM_BATCH_SIZE = "80"
    $env:STRATEGY4_PREWARM_BATCHES_PER_RUN = "0"
    $env:STRATEGY4_PREWARM_SLEEP_MS = "0"
    $env:STRATEGY4_PREWARM_MAX_REMAINING_MISS = "2000"
    & $nodeExe "scripts\prewarm-strategy4-history-cache.js" *>&1 | Tee-Object -FilePath $log -Append
    $prewarmExit = $LASTEXITCODE
  } finally {
    if ($null -ne $previousPrewarmBatchSize) { $env:STRATEGY4_PREWARM_BATCH_SIZE = $previousPrewarmBatchSize } else { Remove-Item Env:STRATEGY4_PREWARM_BATCH_SIZE -ErrorAction SilentlyContinue }
    if ($null -ne $previousPrewarmBatches) { $env:STRATEGY4_PREWARM_BATCHES_PER_RUN = $previousPrewarmBatches } else { Remove-Item Env:STRATEGY4_PREWARM_BATCHES_PER_RUN -ErrorAction SilentlyContinue }
    if ($null -ne $previousPrewarmSleep) { $env:STRATEGY4_PREWARM_SLEEP_MS = $previousPrewarmSleep } else { Remove-Item Env:STRATEGY4_PREWARM_SLEEP_MS -ErrorAction SilentlyContinue }
    if ($null -ne $previousPrewarmMaxMiss) { $env:STRATEGY4_PREWARM_MAX_REMAINING_MISS = $previousPrewarmMaxMiss } else { Remove-Item Env:STRATEGY4_PREWARM_MAX_REMAINING_MISS -ErrorAction SilentlyContinue }
    if ($null -ne $previousPrewarmUseMis) { $env:STRATEGY4_USE_MIS = $previousPrewarmUseMis } else { Remove-Item Env:STRATEGY4_USE_MIS -ErrorAction SilentlyContinue }
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
  Remove-Item Env:STRATEGY4_ALLOW_PARTIAL_PUBLISH -ErrorAction SilentlyContinue
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
  if ($cacheControl -notmatch "no-store") { throw "missing no-store cache-control=$cacheControl" }
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

$snapshotScript = Join-Path $repo "refresh-desktop-route-snapshot.ps1"
if (Test-Path -LiteralPath $snapshotScript) {
  & $snapshotScript -Source "strategy4" -LogPath $log
  if ($LASTEXITCODE -ne 0) {
    Write-Log "Strategy4 desktop snapshot refresh failed with exit code $LASTEXITCODE"
    Write-Strategy4Receipt "failed" $LASTEXITCODE $false 0 ([string]$strategy4Output.runId) @("desktop snapshot refresh exit code $LASTEXITCODE") "critical scan failed during desktop snapshot refresh"
    exit $LASTEXITCODE
  }
} else {
  Write-Log "Strategy4 desktop snapshot refresh skipped; helper not found."
}

Write-Strategy4Receipt "complete" 0 $true ([int]$strategy4Output.count) ([string]$strategy4Output.runId)
Write-Log "=== Strategy4 full scan end $(Get-Date) ==="


