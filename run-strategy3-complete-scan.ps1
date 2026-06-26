$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_DATA_DIR = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $env:FUMAN_RUNTIME_DIR "data" }
$env:FUMAN_CACHE_DIR = if ($env:FUMAN_CACHE_DIR) { $env:FUMAN_CACHE_DIR } else { Join-Path $env:FUMAN_RUNTIME_DIR "cache" }
$env:FUMAN_STATE_DIR = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $env:FUMAN_RUNTIME_DIR "state" }
$env:NODE_OPTIONS = "--use-system-ca"

$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = Join-Path $env:FUMAN_RUNTIME_DIR "logs"
New-Item -ItemType Directory -Force -Path $logDir, $env:FUMAN_DATA_DIR, $env:FUMAN_CACHE_DIR, $env:FUMAN_STATE_DIR | Out-Null
$log = Join-Path $logDir ("strategy3-complete-scan-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
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
}

. "${PSScriptRoot}\schedule-guard.ps1"
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
  $apiCheck = @"
const handler = require("./api/strategy3-latest");
const { captureHandler } = require("./scripts/strategy-api-capture");
captureHandler(handler).then((result) => {
  const payload = result.body || {};
  const count = payload.count ?? (Array.isArray(payload.matches) ? payload.matches.length : 0);
  console.log(JSON.stringify({
    statusCode: result.statusCode,
    body: {
      usedDate: payload.usedDate || "",
      count,
      cacheSource: payload.cacheSource || "",
      runId: payload.runId || "",
      transport: { gate: payload.transport && payload.transport.gate || "" },
    },
  }));
}).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
"@
  $resultText = (& $nodeExe -e $apiCheck) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw "Strategy3 latest API check failed with exit code $LASTEXITCODE" }
  $result = $resultText | ConvertFrom-Json -ErrorAction Stop
  if ([int]$result.statusCode -ne 200) { throw "Strategy3 latest API returned status=$($result.statusCode)" }
  $payload = $result.body
  $today = Get-TaipeiTodayYmd
  $usedDate = Convert-DateTextToYmd $payload.usedDate
  $count = if ($null -ne $payload.count) { [int]$payload.count } else { @($payload.matches).Count }
  if (-not $AllowPreviousComplete -and $usedDate -ne $today) { throw "Strategy3 latest API stale; usedDate=$usedDate today=$today" }
  if ($AllowPreviousComplete -and ([string]::IsNullOrWhiteSpace($usedDate) -or $usedDate -gt $today)) { throw "Strategy3 latest API invalid latest complete date; usedDate=$usedDate today=$today" }
  if ($count -le 0) { throw "Strategy3 latest API empty; count=$count" }
  $cacheSource = [string]$payload.cacheSource
  if ($cacheSource -notin @("supabase-api", "supabase-snapshot")) { throw "Strategy3 latest API did not use Supabase complete-run/snapshot path; cacheSource=$cacheSource" }
  if ([string]::IsNullOrWhiteSpace([string]$payload.runId)) { throw "Strategy3 latest API missing runId" }
  if ($cacheSource -eq "supabase-api" -and [string]$payload.transport.gate -ne "run_id") { throw "Strategy3 latest API did not use run_id gate; gate=$($payload.transport.gate)" }
  Write-Strategy3CompleteLog "Strategy3 complete API verified: usedDate=$usedDate count=$count runId=$($payload.runId) cacheSource=$($payload.cacheSource) gate=$($payload.transport.gate)"
  return $payload
}

function Test-Strategy3ControlledSourceNotReady($Message) {
  $text = [string]$Message
  return $text -match "after1300ReadyCount .* below" -or $text -match "v_strategy3_quote_ready .*statement timeout"
}

Write-Strategy3CompleteLog "Strategy3 complete scan start"
. "${PSScriptRoot}\scanner-resource-health.ps1"
$resourceGate = Invoke-ScannerResourceHealthGate -Strategy "strategy3" -LogPath $log
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
  Write-Strategy3Receipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId) @($reason) $reason
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
  Write-Strategy3Receipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId) @("source not ready; preserved latest complete run: $scannerError")
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

