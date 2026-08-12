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

function Test-ProcessAliveById($ProcessId) {
  if (-not $ProcessId) { return $false }
  try { return $null -ne (Get-Process -Id ([int]$ProcessId) -ErrorAction Stop) } catch { return $false }
}

$lockDir = Join-Path $RuntimeRoot "data\locks"
$lockFile = Join-Path $lockDir "strategy4-source-prewarm.lock.json"
$lockAcquired = $false

function Acquire-Strategy4SourcePrewarmLock() {
  New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
  if (Test-Path -LiteralPath $lockFile) {
    $existing = $null
    try { $existing = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json } catch { $existing = $null }
    if ($existing -and (Test-ProcessAliveById $existing.pid) -and ([int]$existing.pid -ne [int]$PID)) {
      $reason = "strategy4_source_prewarm_lock_held:pid=$($existing.pid);startedAt=$($existing.startedAt)"
      Write-Log $reason
      Complete-Receipt "failed" 9 $false $reason $null $false $false
      exit 9
    }
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  }
  Write-JsonFile $lockFile ([ordered]@{
    contract = "strategy4-source-prewarm-single-lock-v1"
    pid = $PID
    tradeDate = $tradeDate
    startedAt = $startedAt
    log = $log
  })
  $script:lockAcquired = $true
}

function Release-Strategy4SourcePrewarmLock() {
  if (-not $script:lockAcquired) { return }
  try {
    $existing = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
    if ([int]$existing.pid -eq [int]$PID) { Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue }
  } catch {}
}

function Invoke-Strategy4SourceRootVerifier {
  param([string]$TargetDate = $tradeDate)

  Push-Location $repo
  try {
    $previousTargetDate = $env:FUMAN_SCANNER_TARGET_DATE
    $previousTargetTradeDate = $env:FUMAN_SCANNER_TARGET_TRADE_DATE
    $previousTerminalTargetDate = $env:FUMAN_TERMINAL_TARGET_TRADE_DATE
    try {
      $env:FUMAN_SCANNER_TARGET_DATE = $TargetDate
      $env:FUMAN_SCANNER_TARGET_TRADE_DATE = $TargetDate
      $env:FUMAN_TERMINAL_TARGET_TRADE_DATE = $TargetDate
      $verifierOutput = & $nodeExe "scripts\verify-strategy4-source-root.js" "--date=$TargetDate" 2>&1
      $verifierExit = $LASTEXITCODE
      $verifierOutput | Tee-Object -FilePath $log -Append | Out-Host
      return ($verifierExit -eq 0)
    } finally {
      if ($null -ne $previousTargetDate) { $env:FUMAN_SCANNER_TARGET_DATE = $previousTargetDate } else { Remove-Item Env:FUMAN_SCANNER_TARGET_DATE -ErrorAction SilentlyContinue }
      if ($null -ne $previousTargetTradeDate) { $env:FUMAN_SCANNER_TARGET_TRADE_DATE = $previousTargetTradeDate } else { Remove-Item Env:FUMAN_SCANNER_TARGET_TRADE_DATE -ErrorAction SilentlyContinue }
      if ($null -ne $previousTerminalTargetDate) { $env:FUMAN_TERMINAL_TARGET_TRADE_DATE = $previousTerminalTargetDate } else { Remove-Item Env:FUMAN_TERMINAL_TARGET_TRADE_DATE -ErrorAction SilentlyContinue }
    }
  } finally {
    Pop-Location
  }
}

function Invoke-Strategy4SourceRepair {
  param([string]$Reason = "")
  if ($env:STRATEGY4_DISABLE_SOURCE_REPAIR -eq "1") {
    Write-Log "Strategy4 Fugle source repair skipped by STRATEGY4_DISABLE_SOURCE_REPAIR=1. reason=$Reason"
    return $false
  }
  $snapshotScript = Join-Path $repo "scripts\sync-strategy4-fugle-daily-snapshot.js"
  if (-not (Test-Path -LiteralPath $snapshotScript)) {
    Write-Log "Strategy4 Fugle snapshot script missing: $snapshotScript"
    return $false
  }
  Write-Log "Strategy4 Fugle source repair start. reason=$Reason tradeDate=$tradeDate"
  & $nodeExe "--use-system-ca" $snapshotScript "--date=$tradeDate" *>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) {
    Write-Log "Strategy4 Fugle snapshot repair failed with exit code $LASTEXITCODE"
    return $false
  }
  if (Get-Command Invoke-Strategy4SourceRootVerifier -ErrorAction SilentlyContinue) {
    if (-not (Invoke-Strategy4SourceRootVerifier -TargetDate $tradeDate)) {
      Write-Log "Strategy4 source root verifier failed after Fugle snapshot repair"
      return $false
    }
  }
  Write-Log "Strategy4 Fugle source repair complete."
  return $true
}
Acquire-Strategy4SourcePrewarmLock

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

    $env:FUMAN_SCANNER_TARGET_DATE = $tradeDate
    $env:FUMAN_SCANNER_TARGET_TRADE_DATE = $tradeDate
    $env:FUMAN_TERMINAL_TARGET_TRADE_DATE = $tradeDate

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

    $sourceRootReady = Invoke-Strategy4SourceRootVerifier -TargetDate $tradeDate
    if (-not $sourceRootReady) {
      $reason = "Strategy4 source root verifier failed before ready receipt"
      Write-Log $reason
      Complete-Receipt "failed" 4 $false $reason $resourceGate $repairAttempted $repairOk
      exit 4
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
} finally {
  Release-Strategy4SourcePrewarmLock
}
