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

function Write-CbDetectReceipt($Status, $ExitCode, $Complete, $Matches, $RunId, $Warnings = @(), $BlockingReason = "") {
  $receipt = [ordered]@{
    strategy = "cb-detect"
    label = "CB detect full scan"
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
    payloadPath = "supabase-snapshot:cb_detect_latest"
    warnings = @($Warnings)
    blockingReason = $BlockingReason
    log = $log
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptDir "cb-detect.json") -Encoding utf8
}

function Assert-CbDetectApi {
  $url = "https://fuman-terminal.vercel.app/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=60&live=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45
  $payload = $response.Content | ConvertFrom-Json
  if ($response.StatusCode -ne 200 -or $payload.ok -ne $true -or -not $payload.runId) {
    throw "CB detect API verification failed status=$($response.StatusCode) ok=$($payload.ok) runId=$($payload.runId)"
  }
  if ([int]$payload.count -le 0) { throw "CB detect API empty count=$($payload.count)" }
  $apiUpdatedAtRaw = $payload.updatedAt ?? $payload.generatedAt
  $apiUpdatedAtText = if ($apiUpdatedAtRaw -is [DateTime]) { ([DateTime]$apiUpdatedAtRaw).ToUniversalTime().ToString("o") } else { [string]$apiUpdatedAtRaw }
  if ([string]::IsNullOrWhiteSpace($apiUpdatedAtText)) { throw "CB detect API missing updatedAt" }
  $apiUpdatedAt = [DateTimeOffset]::Parse($apiUpdatedAtText, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal)
  $scanStarted = [DateTimeOffset]::Parse($scanStartedAt)
  if ($apiUpdatedAt -lt $scanStarted.AddMinutes(-5)) {
    throw "CB detect API did not expose this scan yet: runId=$($payload.runId) updatedAt=$apiUpdatedAtText scanStartedAt=$scanStartedAt"
  }
  "CB detect API verified runId=$($payload.runId) count=$($payload.count) cache=$($payload.cacheSource)" >> $log
  return $payload
}

"=== CB detect full scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
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
    if ($LASTEXITCODE -ne 0) {
      "CB detect desktop snapshot refresh warning with exit code $LASTEXITCODE" >> $log
      $warnings += "desktop snapshot refresh exit code $LASTEXITCODE"
    }
  } else {
    "CB detect desktop snapshot refresh skipped; helper not found." >> $log
    $warnings += "desktop snapshot refresh helper not found"
  }
  Write-CbDetectReceipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId) $warnings
} finally {
  Pop-Location
}

"CB detect API-only: cache sync, afterhours static status, and release/freshness gate are disabled; terminal reads Supabase snapshot/API plus desktop snapshot." >> $log
"=== CB detect full scan end $(Get-Date) ===" >> $log
$global:LASTEXITCODE = 0
exit 0
