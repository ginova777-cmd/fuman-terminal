$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$runtime = "C:\fuman-runtime"
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$pwshExe = "C:\Program Files\PowerShell\7\pwsh.exe"
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("cb-detect-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
$scanStartedAt = (Get-Date).ToString("o")

function Write-CbDetectReceipt($Status, $ExitCode, $Complete, $Matches, $RunId, $Warnings = @(), $BlockingReason = "", $PreservePreviousGood = $false) {
  $publishAllowed = $Complete -and -not $PreservePreviousGood -and [string]::IsNullOrWhiteSpace($BlockingReason)
  $evidenceStatus = if ($publishAllowed) { "complete" } else { "insufficient" }
  $unattendedStatus = if ($publishAllowed) { "YES" } else { "NO" }
  $writeBudget = [ordered]@{
    allowed = [bool]$publishAllowed
    status = if ($publishAllowed) { "allow" } else { "blocked" }
    finalStatus = if ($publishAllowed) { "allow" } else { "blocked" }
    scope = "cb_detect_complete_run_publish"
    reason = $BlockingReason
  }
  $receipt = [ordered]@{
    strategy = "cb-detect"
    label = "CB detect full scan"
    tier = "critical"
    startedAt = $scanStartedAt
    finishedAt = (Get-Date).ToString("o")
    source_snapshot_captured_at = $scanStartedAt
    status = $Status
    exitCode = $ExitCode
    scanned = 0
    total = 0
    matches = $Matches
    complete = $Complete
    qualityStatus = if ($Complete) { "complete" } else { "" }
    fallback = $false
    fallbackUsed = $false
    fallbackAllowed = $false
    fallbackScope = @()
    fallbackDetails = @()
    fallbackContract = "cb-detect-fallback-disclosure-v1"
    runId = $RunId
    payloadPath = "supabase-snapshot:cb_detect_latest"
    publishAllowed = $publishAllowed
    latestOverwriteAllowed = $publishAllowed
    latestWriteAttempted = [bool]$publishAllowed
    latestPointerUpdated = [bool]$publishAllowed
    overwrotePreviousGood = $false
    blockedReceiptWritten = [bool]$PreservePreviousGood
    degradedBlocksLatest = [bool]$PreservePreviousGood
    preservePreviousGood = [bool]$PreservePreviousGood
    writeBudget = $writeBudget
    retentionOk = $true
    evidenceStatus = $evidenceStatus
    unattendedStatus = $unattendedStatus
    run_quality_at_publish = [ordered]@{
      publishAllowed = $publishAllowed
      latestOverwriteAllowed = $publishAllowed
      latestWriteAttempted = [bool]$publishAllowed
      latestPointerUpdated = [bool]$publishAllowed
      overwrotePreviousGood = $false
      blockedReceiptWritten = [bool]$PreservePreviousGood
      preservePreviousGood = [bool]$PreservePreviousGood
      degradedBlocksLatest = [bool]$PreservePreviousGood
      fallbackUsed = $false
      fallbackAllowed = $false
      fallbackScope = @()
      fallbackDetails = @()
      fallbackContract = "cb-detect-fallback-disclosure-v1"
      writeBudget = $writeBudget
      evidenceStatus = $evidenceStatus
      unattendedStatus = $unattendedStatus
      resultCount = [int]$Matches
      readbackCount = [int]$Matches
      blockedReason = $BlockingReason
      scanner_block_reason = $BlockingReason
    }
    warnings = @($Warnings)
    blockingReason = $BlockingReason
    blockedReason = $BlockingReason
    scanner_block_reason = $BlockingReason
    log = $log
  }
  $receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $receiptDir "cb-detect.json") -Encoding utf8
}
function Get-CbDetectReadbackFromLog {
  $text = Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $match = [regex]::Match($text, "cb-detect supabase complete run ok: ([^,\s]+), rows (\d+)")
  if (-not $match.Success) { return $null }
  $runId = [string]$match.Groups[1].Value
  $count = [int]$match.Groups[2].Value
  if ([string]::IsNullOrWhiteSpace($runId) -or $count -le 0) { return $null }
  return [pscustomobject]@{
    runId = $runId
    count = $count
    cacheSource = "supabase-complete-run-readback"
  }
}

function Assert-CbDetectApi {
  $readback = Get-CbDetectReadbackFromLog
  if ($null -ne $readback) {
    "CB detect complete-run readback verified runId=$($readback.runId) count=$($readback.count)" >> $log
    return $readback
  }
  $url = "https://fuman-terminal.vercel.app/api/scorecard?live=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45
  $scorecard = $response.Content | ConvertFrom-Json -AsHashtable
  $report = @($scorecard["sourceReports"]) | Where-Object { $_["key"] -eq "cb" } | Select-Object -First 1
  if ($response.StatusCode -ne 200 -or -not $report -or [string]::IsNullOrWhiteSpace([string]$report["runId"])) {
    throw "CB detect scorecard sourceReport verification failed status=$($response.StatusCode) runId=$($report["runId"])"
  }
  $count = if ($null -ne $report["count"]) { [int]$report["count"] } else { 0 }
  if ($count -le 0) { throw "CB detect scorecard sourceReport empty count=$count" }
  "CB detect scorecard sourceReport verified runId=$($report["runId"]) count=$count" >> $log
  return [pscustomobject]@{
    runId = [string]$report["runId"]
    count = $count
    cacheSource = "scorecard-source-report"
  }
}

"=== CB detect full scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "CB detect full scan" -LogPath $log
. "${PSScriptRoot}\scanner-resource-health.ps1"
$resourceGate = Invoke-ScannerResourceHealthGate -Strategy "cb-detect" -LogPath $log
if ($resourceGate.PreserveLatest) {
  $reason = "resource health $($resourceGate.Status): $($resourceGate.Reason)"
  "CB detect source gate blocked new publish; preserving latest complete run. $reason" >> $log
  try {
    $verifiedPayload = Assert-CbDetectApi
    Write-CbDetectReceipt "blocked_preserved" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId) @($reason) $reason $true
    exit 0
  } catch {
    Write-CbDetectReceipt "blocked" 0 $false 0 "" @($reason, $_.Exception.Message) $reason $true
    exit 0
  }
}
$codeRepo = "${PSScriptRoot}"
Push-Location $codeRepo
try {
  & $nodeExe "scripts\generate-cb-detect.js" 2>&1 | ForEach-Object { $_ | Out-File -LiteralPath $log -Append -Encoding utf8 }
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    "CB detect full scan failed with exit code $exitCode" >> $log
    Write-CbDetectReceipt "failed" $exitCode $false 0 "" @("scanner exit code $exitCode") "critical scan failed with exit code $exitCode"
    exit $exitCode
  }
  try {
    $verifiedPayload = Assert-CbDetectApi
  } catch {
    "CB detect API verification failed: $($_.Exception.Message)" >> $log
    Write-CbDetectReceipt "failed" 1 $false 0 "" @($_.Exception.Message) "critical scan failed during API verification"
    exit 1
  }
  $warnings = @()
  $snapshotScript = Join-Path $codeRepo "refresh-desktop-route-snapshot.ps1"
  if (Test-Path -LiteralPath $snapshotScript) {
    & $pwshExe -NoProfile -ExecutionPolicy Bypass -File $snapshotScript -Source "cb-detect" -LogPath $log
    $snapshotExitCode = $LASTEXITCODE
    if ($snapshotExitCode -ne 0) {
      "CB detect desktop snapshot refresh retry after exit code $snapshotExitCode" >> $log
      Start-Sleep -Seconds 12
      & $pwshExe -NoProfile -ExecutionPolicy Bypass -File $snapshotScript -Source "cb-detect" -LogPath $log
      $snapshotExitCode = $LASTEXITCODE
    }
    if ($snapshotExitCode -ne 0) {
      "CB detect desktop snapshot refresh warning with exit code $snapshotExitCode" >> $log
      $warnings += "desktop snapshot refresh exit code $snapshotExitCode"
    }
  } else {
    "CB detect desktop snapshot refresh skipped; helper not found." >> $log
    $warnings += "desktop snapshot refresh helper not found"
  }
  Write-CbDetectReceipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId) $warnings
} finally {
  Pop-Location
}

"CB detect API-only: scanner success verifies api/cb-detect-latest and reads Supabase snapshot/API plus desktop snapshot." >> $log
"=== CB detect full scan end $(Get-Date) ===" >> $log
exit 0
