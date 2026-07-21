param(
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$RuntimeRoot = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"
$repo = $ProjectRoot
$nodeExe = "node"
$receiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
$logDir = Join-Path $RuntimeRoot "logs"
New-Item -ItemType Directory -Force -Path $receiptDir, $logDir | Out-Null

function Get-TaipeiNow() {
  try {
    $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    return [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
  } catch {
    return Get-Date
  }
}

$startedAt = (Get-Date).ToString("o")
$taipeiNow = Get-TaipeiNow
$tradeDate = $taipeiNow.ToString("yyyy-MM-dd")
$stamp = $taipeiNow.ToString("yyyyMMdd-HHmmss")
$log = Join-Path $logDir ("strategy4-source-prewarm-{0}.log" -f $stamp)
$latestReceipt = Join-Path $receiptDir "strategy4-source-prewarm-latest.json"
$datedReceipt = Join-Path $receiptDir ("strategy4-source-prewarm-{0}.json" -f $stamp)

function Write-Log($Message) {
  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Write-JsonFile($Path, $Payload) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $Payload | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Complete-Receipt($Status, $ExitCode, $SourceReady, $Reason, $ResourceGate = $null, $RepairAttempted = $false, $RepairOk = $false) {
  $isComplete = ($Status -eq "complete" -and $ExitCode -eq 0 -and $SourceReady)
  $payload = [ordered]@{
    ok = $isComplete
    status = $Status
    exitCode = $ExitCode
    complete = $isComplete
    qualityStatus = $(if ($isComplete) { "complete" } else { "blocked" })
    fallback = $false
    warnings = @()
    blockingReason = $(if ($isComplete) { "" } else { $Reason })
    runId = "strategy4-source-prewarm-$($tradeDate.Replace('-', ''))"
    source = "strategy4-source-prewarm"
    tradeDate = $tradeDate
    startedAt = $startedAt
    finishedAt = (Get-Date).ToString("o")
    projectRoot = $ProjectRoot
    runtimeRoot = $RuntimeRoot
    log = $log
    sourceReady = $SourceReady
    repairAttempted = $RepairAttempted
    repairOk = $RepairOk
    reason = $Reason
    resourceGate = $ResourceGate
    publishAllowed = $SourceReady
    evidenceStatus = $(if ($SourceReady) { "complete" } else { "insufficient" })
    unattendedStatus = $(if ($SourceReady) { "PREWARM_READY" } else { "NO" })
    latestPointerUpdated = $false
    emptyResultWritten = $false
    preservePreviousGood = (-not $SourceReady)
  }
  Write-JsonFile $latestReceipt $payload
  Write-JsonFile $datedReceipt $payload
}

function Invoke-Strategy4SourceRepair {
  param([string]$Reason = "")

  Write-Log "Strategy4 source prewarm/repair start. reason=$Reason"
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

    Push-Location $repo
    try {
      & $nodeExe "scripts\prewarm-strategy4-history-cache.js" *>&1 | Tee-Object -FilePath $log -Append
      $prewarmExit = $LASTEXITCODE
      if ($prewarmExit -ne 0) {
        Write-Log "Strategy4 source prewarm failed with exit code $prewarmExit"
        return $false
      }

      $importScript = Join-Path $repo "ops\public-slot\Import-Strategy4DailyCacheToSupabase.ps1"
      if (-not (Test-Path -LiteralPath $importScript)) {
        Write-Log "Strategy4 source prewarm import skipped; helper not found: $importScript"
        return $false
      }

      & "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File $importScript -RetainTradeDays 120 -BatchSize 500 *>&1 | Tee-Object -FilePath $log -Append
      $importExit = $LASTEXITCODE
      if ($importExit -ne 0) {
        Write-Log "Strategy4 source prewarm import failed with exit code $importExit"
        return $false
      }
    } finally {
      Pop-Location
    }

    Write-Log "Strategy4 source prewarm/repair complete."
    return $true
  } finally {
    foreach ($key in $previousValues.Keys) {
      if ($null -ne $previousValues[$key]) { Set-Item -Path "Env:$key" -Value $previousValues[$key] }
      else { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
    }
  }
}

try {
  Write-Log "START Strategy4 source prewarm tradeDate=$tradeDate"
  Push-Location $repo
  try {
    . "${PSScriptRoot}\schedule-guard.ps1"
    Invoke-FumanWeekdayGuard -Label "Strategy4 source prewarm" -LogPath $log

    & $nodeExe "scripts\check-full-scan-date-preflight.js" "--label=strategy4-source-prewarm" "--after-close-profile=1" "--receipt" *>&1 | Tee-Object -FilePath $log -Append
    $dateExit = $LASTEXITCODE
    if ($dateExit -eq 10) {
      $reason = "market closed; source prewarm skipped and previous good preserved"
      Write-Log $reason
      Complete-Receipt "complete" 0 $false $reason $null $false $false
      exit 0
    }
    if ($dateExit -ne 0) {
      $reason = "date preflight failed; exit=$dateExit"
      Write-Log $reason
      Complete-Receipt "failed" $dateExit $false $reason $null $false $false
      exit $dateExit
    }

    & $nodeExe "scripts\verify-supabase-publish-hard-gate.js" "--strategy=strategy4" *>&1 | Tee-Object -FilePath $log -Append
    $gateExit = $LASTEXITCODE
    Write-Log "Strategy4 source prewarm publish gate probe exit=$gateExit"

    . "${PSScriptRoot}\scanner-resource-health.ps1"
    $resourceGate = Invoke-ScannerResourceHealthGate -Strategy "strategy4" -LogPath $log
    $repairAttempted = $false
    $repairOk = $false

    if ($resourceGate.PreserveLatest) {
      $repairAttempted = $true
      $repairOk = Invoke-Strategy4SourceRepair "resource health $($resourceGate.Status): $($resourceGate.Reason)"
      $resourceGate = Invoke-ScannerResourceHealthGate -Strategy "strategy4" -LogPath $log
    } else {
      Write-Log "Strategy4 source already ready; skip heavy repair/import and write ready prewarm receipt. reason=$($resourceGate.Reason)"
    }

    if ($resourceGate.PreserveLatest) {
      $reason = "resource health $($resourceGate.Status): $($resourceGate.Reason)"
      Write-Log "Strategy4 source prewarm NOT READY: $reason"
      Complete-Receipt "failed" 3 $false $reason $resourceGate $repairAttempted $repairOk
      exit 3
    }

    $reason = "source ready after prewarm: $($resourceGate.Reason)"
    Write-Log "Strategy4 source prewarm READY: $reason"
    Complete-Receipt "complete" 0 $true $reason $resourceGate $repairAttempted $repairOk
    exit 0
  } finally {
    Pop-Location
  }
} catch {
  $reason = $_.Exception.Message
  Write-Log "FAILED Strategy4 source prewarm: $reason"
  Complete-Receipt "failed" 1 $false $reason $null $false $false
  exit 1
}
