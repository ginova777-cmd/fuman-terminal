$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-institution.ps1"

$runtime = "C:\fuman-runtime"
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"
$env:NODE_OPTIONS = "--use-system-ca"
if (-not $env:INSTITUTION_SLOW_SCAN) { $env:INSTITUTION_SLOW_SCAN = "0" }
if (-not $env:INSTITUTION_REQUEST_DELAY_MS) { $env:INSTITUTION_REQUEST_DELAY_MS = "1200" }
if (-not $env:INSTITUTION_FETCH_RETRIES) { $env:INSTITUTION_FETCH_RETRIES = "1" }
if (-not $env:INSTITUTION_SOURCE_PROVIDER) { $env:INSTITUTION_SOURCE_PROVIDER = "auto" }
if (-not $env:SHIOAJI_PYTHON) { $env:SHIOAJI_PYTHON = "C:\Users\ginov\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" }
$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("institution-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
$scanStartedAt = (Get-Date).ToString("o")
$script:institutionDiagnosticWarnings = New-Object System.Collections.Generic.List[string]

function Write-InstitutionReceipt($Status, $ExitCode, $Complete, $Matches, $RunId, $Warnings = @(), $BlockingReason = "") {
  $receipt = [ordered]@{
    strategy = "institution"
    label = "institution raw refresh"
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
    payloadPath = "supabase:institution_scan_results"
    warnings = @($Warnings)
    diagnosticWarnings = @($script:institutionDiagnosticWarnings.ToArray())
    blockingReason = $BlockingReason
    log = $log
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptDir "institution.json") -Encoding utf8
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
      $tailText = (Get-Content -LiteralPath $log -ErrorAction SilentlyContinue | Select-Object -Last 80) -join "`n"
      if (Test-InstitutionControlledSourceNotReady $tailText) {
        "$label controlled source-not-ready detected; stop retrying and preserve latest complete run" >> $log
        return $exitCode
      }
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

function Assert-InstitutionApi {
  param(
    [switch]$AllowPreviousComplete
  )
  $url = "https://fuman-terminal.vercel.app/api/institution-latest?canvas=1&compact=1&shell=1&limit=60&live=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45
  $payload = $response.Content | ConvertFrom-Json
  if ($response.StatusCode -ne 200 -or $payload.ok -ne $true -or -not $payload.runId) {
    throw "Institution API verification failed status=$($response.StatusCode) ok=$($payload.ok) runId=$($payload.runId)"
  }
  if ([int]$payload.count -le 0) { throw "Institution API empty count=$($payload.count)" }
  $apiUpdatedAtText = [string]($payload.updatedAt ?? $payload.generatedAt)
  if ([string]::IsNullOrWhiteSpace($apiUpdatedAtText)) { throw "Institution API missing updatedAt" }
  $apiUpdatedAt = [DateTimeOffset]::Parse($apiUpdatedAtText)
  $scanStarted = [DateTimeOffset]::Parse($scanStartedAt)
  if (-not $AllowPreviousComplete -and $apiUpdatedAt -lt $scanStarted.AddMinutes(-5)) {
    throw "Institution API did not expose this scan yet: runId=$($payload.runId) updatedAt=$apiUpdatedAtText scanStartedAt=$scanStartedAt"
  }
  "Institution API verified runId=$($payload.runId) count=$($payload.count) cache=$($payload.cacheSource)" >> $log
  return $payload
}

function Test-InstitutionControlledSourceNotReady($Message) {
  $text = [string]$Message
  return $text -match "too few rows after exclusions" -or $text -match "source freshness" -or $text -match "tpex 5-day metrics failed"
}

function Test-InstitutionTransientResourceHealthFailure($ResourceGate) {
  if ($null -eq $ResourceGate) { return $false }
  if ([string]$ResourceGate.Status -ne "failed" -or [int]$ResourceGate.ExitCode -eq 0) { return $false }
  $text = @(
    [string]$ResourceGate.Reason
    [string]($ResourceGate.Payload.error)
    [string]($ResourceGate.Payload.raw)
  ) -join "`n"
  return $text -match "v_scanner_resource_health HTTP 500" `
    -or $text -match "57014" `
    -or $text -match "statement timeout" `
    -or $text -match "AbortError" `
    -or $text -match "timed out"
}

function Invoke-InstitutionSnapshotRefresh($RunId = "", $Count = 0, $Warning = "") {
  $snapshotScript = "${PSScriptRoot}\refresh-desktop-route-snapshot.ps1"
  if (Test-Path -LiteralPath $snapshotScript) {
    & $snapshotScript -Source "institution" -LogPath $log
    if ($LASTEXITCODE -ne 0) {
      "Institution desktop snapshot refresh failed with exit code $LASTEXITCODE" >> $log
      Write-FumanFlowHealth -Scope institution -Status publish_delayed -Message "Institution latest complete run preserved but desktop snapshot refresh failed" -Detail @{ exitCode = $LASTEXITCODE; log = $log; runId = $RunId }
      Write-InstitutionReceipt "failed" $LASTEXITCODE $false 0 $RunId @("desktop snapshot refresh exit code $LASTEXITCODE") "critical scan failed during desktop snapshot refresh"
      exit $LASTEXITCODE
    }
  } else {
    "Institution desktop snapshot refresh skipped; helper not found." >> $log
  }
  if ($Warning) {
    Write-InstitutionReceipt "complete" 0 $true $Count $RunId @($Warning)
  }
}

"=== Institution scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
. "${PSScriptRoot}\flow-health.ps1"
Invoke-FumanWeekdayGuard -Label "Institution scan" -LogPath $log
. "${PSScriptRoot}\scanner-resource-health.ps1"
$resourceGate = Invoke-ScannerResourceHealthGate -Strategy "institution" -LogPath $log
if (Test-InstitutionTransientResourceHealthFailure $resourceGate) {
  $diagnostic = "resource health diagnostic unavailable: $($resourceGate.Reason)"
  "Institution resource health preflight was transiently unavailable; continuing to scanner/readback gates. $diagnostic" >> $log
  $script:institutionDiagnosticWarnings.Add($diagnostic) | Out-Null
} elseif ($resourceGate.PreserveLatest) {
  $reason = "resource health $($resourceGate.Status): $($resourceGate.Reason)"
  "Institution source gate blocked new publish; preserving latest complete run. $reason" >> $log
  $verifiedPayload = Assert-InstitutionApi -AllowPreviousComplete
  Invoke-InstitutionSnapshotRefresh ([string]$verifiedPayload.runId) ([int]$verifiedPayload.count) $reason
  Write-FumanFlowHealth -Scope institution -Status source_stale -Message "Institution resource health blocked new publish; preserved latest complete run" -Detail @{ reason = $reason; log = $log; runId = [string]$verifiedPayload.runId; count = [int]$verifiedPayload.count }
  exit 0
}
$scanExit = Invoke-NodeScan "scripts\scan-institution-cache.js" "Institution scan"
if ($scanExit -ne 0) {
  "Institution scan failed with exit code $scanExit" >> $log
  $tailText = (Get-Content -LiteralPath $log -ErrorAction SilentlyContinue | Select-Object -Last 80) -join "`n"
  if (Test-InstitutionControlledSourceNotReady $tailText) {
    "Institution source coverage not ready; preserving latest complete run instead of poisoning receipt." >> $log
    try {
      $verifiedPayload = Assert-InstitutionApi -AllowPreviousComplete
      Invoke-InstitutionSnapshotRefresh ([string]$verifiedPayload.runId) ([int]$verifiedPayload.count) "source coverage insufficient; preserved latest complete run"
      Write-FumanFlowHealth -Scope institution -Status source_stale -Message "Institution source coverage insufficient; preserved latest complete run" -Detail @{ log = $log; runId = [string]$verifiedPayload.runId; count = [int]$verifiedPayload.count }
      "Institution deferred complete scan end; preserved runId=$($verifiedPayload.runId) count=$($verifiedPayload.count)" >> $log
      exit 0
    } catch {
      "Institution latest complete preservation failed: $($_.Exception.Message)" >> $log
    }
  }
  Write-FumanFlowHealth -Scope institution -Status scan_failed -Message "Institution scan failed" -Detail @{ exitCode = $scanExit; log = $log }
  Write-InstitutionReceipt "failed" $scanExit $false 0 "" @("scanner exit code $scanExit") "critical scan failed with exit code $scanExit"
  exit $scanExit
}

try {
  $verifiedPayload = Assert-InstitutionApi
} catch {
  "Institution API verification failed: $($_.Exception.Message)" >> $log
  Write-FumanFlowHealth -Scope institution -Status publish_delayed -Message "Institution scan succeeded but API verification failed" -Detail @{ error = $_.Exception.Message; log = $log }
  Write-InstitutionReceipt "failed" 1 $false 0 "" @($_.Exception.Message) "critical scan failed during API verification"
  exit 1
}

Invoke-InstitutionSnapshotRefresh ([string]$verifiedPayload.runId)

Write-InstitutionReceipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId)
Write-FumanFlowHealth -Scope institution -Status ok -Message "Institution scan completed through API-only terminal pipeline" -Detail @{ log = $log; runId = [string]$verifiedPayload.runId }
"Institution API-only: slim generation, local mirror, and cache sync are disabled; terminal reads Supabase/API plus desktop snapshot." >> $log
"=== Institution scan end $(Get-Date) ===" >> $log
