$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-warrant-flow.ps1"

$runtime = "C:\fuman-runtime"
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("warrant-flow-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
$scanStartedAt = (Get-Date).ToString("o")

function Write-WarrantFlowReceipt($Status, $ExitCode, $Complete, $Matches, $RunId, $Warnings = @(), $BlockingReason = "") {
  $receipt = [ordered]@{
    strategy = "warrant-flow"
    label = "warrant flow full scan"
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
    payloadPath = "supabase:warrant_flow_scan_results"
    warnings = @($Warnings)
    blockingReason = $BlockingReason
    log = $log
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptDir "warrant-flow.json") -Encoding utf8
}

function Assert-WarrantFlowApi {
  param(
    [switch]$AllowPreviousComplete
  )
  $endpointKey = "/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=60&live=1"
  $url = "https://fuman-terminal.vercel.app/api/desktop-route-snapshot?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45
  $snapshotPayload = $response.Content | ConvertFrom-Json -AsHashtable
  $payload = $snapshotPayload["endpoints"][$endpointKey]
  if ($response.StatusCode -ne 200 -or -not $payload -or $payload.ok -ne $true -or -not $payload.runId) {
    throw "Warrant flow desktop snapshot verification failed status=$($response.StatusCode) ok=$($payload.ok) runId=$($payload.runId)"
  }  if ([int]$payload.count -le 0) { throw "Warrant flow API empty count=$($payload.count)" }
  $apiUpdatedAtText = [string]($payload.updatedAt ?? $payload.generatedAt)
  if ([string]::IsNullOrWhiteSpace($apiUpdatedAtText)) { throw "Warrant flow API missing updatedAt" }
  $apiUpdatedAt = [DateTimeOffset]::Parse($apiUpdatedAtText)
  $scanStarted = [DateTimeOffset]::Parse($scanStartedAt)
  if (-not $AllowPreviousComplete -and $apiUpdatedAt -lt $scanStarted.AddMinutes(-5)) {
    throw "Warrant flow API did not expose this scan yet: runId=$($payload.runId) updatedAt=$apiUpdatedAtText scanStartedAt=$scanStartedAt"
  }
  "Warrant flow desktop snapshot verified runId=$($payload.runId) count=$($payload.count) cache=$($payload.cacheSource)" >> $log
  return $payload
}

function Invoke-NodeScan($scriptPath, $label) {
  Push-Location "${PSScriptRoot}"
  try {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      "=== $label attempt $attempt $(Get-Date) ===" >> $log
      & $nodeExe $scriptPath >> $log 2>&1
      $exitCode = $LASTEXITCODE
      if ($exitCode -eq 0) { return 0 }
      "$label attempt $attempt failed with exit code $exitCode" >> $log
      if ($attempt -lt 3) {
        "Waiting 60 seconds before retry" >> $log
        Start-Sleep -Seconds 60
      }
    }
    return $exitCode
  } finally {
    Pop-Location
  }
}

"=== Warrant flow scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
. "${PSScriptRoot}\flow-health.ps1"
Invoke-FumanWeekdayGuard -Label "Warrant flow scan" -LogPath $log
. "${PSScriptRoot}\scanner-resource-health.ps1"
$resourceGate = Invoke-ScannerResourceHealthGate -Strategy "warrant" -LogPath $log
if ($resourceGate.PreserveLatest) {
  $reason = "resource health $($resourceGate.Status): $($resourceGate.Reason)"
  "Warrant flow source gate blocked new publish; preserving latest complete run. $reason" >> $log
  $verifiedPayload = Assert-WarrantFlowApi -AllowPreviousComplete
  $snapshotScript = "${PSScriptRoot}\refresh-desktop-route-snapshot.ps1"
  if (Test-Path -LiteralPath $snapshotScript) {
    & $snapshotScript -Source "warrant-flow" -LogPath $log
    if ($LASTEXITCODE -ne 0) {
      "Warrant flow desktop snapshot refresh failed with exit code $LASTEXITCODE" >> $log
      Write-FumanFlowHealth -Scope warrant -Status publish_delayed -Message "Warrant flow latest complete run preserved but desktop snapshot refresh failed" -Detail @{ exitCode = $LASTEXITCODE; log = $log; runId = [string]$verifiedPayload.runId }
      Write-WarrantFlowReceipt "failed" $LASTEXITCODE $false 0 ([string]$verifiedPayload.runId) @("desktop snapshot refresh exit code $LASTEXITCODE") "critical scan failed during desktop snapshot refresh"
      exit $LASTEXITCODE
    }
  }
  Write-WarrantFlowReceipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId) @($reason) $reason
  Write-FumanFlowHealth -Scope warrant -Status source_stale -Message "Warrant flow resource health blocked new publish; preserved latest complete run" -Detail @{ reason = $reason; log = $log; runId = [string]$verifiedPayload.runId; count = [int]$verifiedPayload.count }
  exit 0
}
$scanExit = Invoke-NodeScan "scripts\scan-warrant-flow-cache.js" "Warrant flow scan"
if ($scanExit -ne 0) {
  "Warrant flow scan failed with exit code $scanExit" >> $log
  Write-FumanFlowHealth -Scope warrant -Status scan_failed -Message "Warrant flow scan failed" -Detail @{ exitCode = $scanExit; log = $log }
  Write-WarrantFlowReceipt "failed" $scanExit $false 0 "" @("scanner exit code $scanExit") "critical scan failed with exit code $scanExit"
  exit $scanExit
}

$snapshotScript = "${PSScriptRoot}\refresh-desktop-route-snapshot.ps1"
if (Test-Path -LiteralPath $snapshotScript) {
  & $snapshotScript -Source "warrant-flow" -LogPath $log
  if ($LASTEXITCODE -ne 0) {
    "Warrant flow desktop snapshot refresh failed with exit code $LASTEXITCODE" >> $log
    Write-FumanFlowHealth -Scope warrant -Status publish_delayed -Message "Warrant flow scan succeeded but desktop snapshot refresh failed" -Detail @{ exitCode = $LASTEXITCODE; log = $log }
    Write-WarrantFlowReceipt "failed" $LASTEXITCODE $false 0 "" @("desktop snapshot refresh exit code $LASTEXITCODE") "critical scan failed during desktop snapshot refresh"
    exit $LASTEXITCODE
  }
} else {
  "Warrant flow desktop snapshot refresh skipped; helper not found." >> $log
}

try {
  $verifiedPayload = Assert-WarrantFlowApi
} catch {
  "Warrant flow API verification failed: $($_.Exception.Message)" >> $log
  Write-FumanFlowHealth -Scope warrant -Status publish_delayed -Message "Warrant flow scan succeeded but API verification failed" -Detail @{ error = $_.Exception.Message; log = $log }
  Write-WarrantFlowReceipt "failed" 1 $false 0 "" @($_.Exception.Message) "critical scan failed during API verification"
  exit 1
}
Write-WarrantFlowReceipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId)
Write-FumanFlowHealth -Scope warrant -Status ok -Message "Warrant flow scan completed through API-only terminal pipeline" -Detail @{ log = $log; runId = [string]$verifiedPayload.runId }
"Warrant flow API-only: cache sync and release/freshness gate are disabled; terminal reads Supabase/API plus desktop snapshot." >> $log
"=== Warrant flow scan end $(Get-Date) ===" >> $log
