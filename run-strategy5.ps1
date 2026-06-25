$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-strategy5.ps1"

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"
$env:STRATEGY5_USE_MIS = "0"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\strategy5-$(Get-Date -Format yyyyMMdd-HHmmss).log"
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
$scanStartedAt = (Get-Date).ToString("o")

function Write-Strategy5Receipt($Status, $ExitCode, $Complete, $Matches, $RunId, $Warnings = @(), $BlockingReason = "") {
  $receipt = [ordered]@{
    strategy = "strategy5"
    label = "strategy5 raw refresh"
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
    payloadPath = "supabase:strategy5_scan_results"
    warnings = @($Warnings)
    blockingReason = $BlockingReason
    log = $log
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptDir "strategy5.json") -Encoding utf8
}

function Assert-Strategy5Api {
  $url = "https://fuman-terminal.vercel.app/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=60&live=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45
  $payload = $response.Content | ConvertFrom-Json
  if ($response.StatusCode -ne 200 -or $payload.ok -ne $true -or -not $payload.runId) {
    throw "Strategy5 API verification failed status=$($response.StatusCode) ok=$($payload.ok) runId=$($payload.runId)"
  }
  if ([int]$payload.count -le 0) { throw "Strategy5 API empty count=$($payload.count)" }
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 API verified runId=$($payload.runId) count=$($payload.count) cache=$($payload.cacheSource)"
  return $payload
}

function Invoke-NodeScan($scriptPath, $label) {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "=== $label attempt $attempt $(Get-Date) ==="
    & $nodeExe $scriptPath 2>&1 | Out-File -LiteralPath $log -Encoding utf8 -Append
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
      return 0
    }
    Add-Content -LiteralPath $log -Encoding utf8 -Value "$label attempt $attempt failed with exit code $exitCode"
    if ($attempt -lt 3) {
      Add-Content -LiteralPath $log -Encoding utf8 -Value "Waiting 60 seconds before retry"
      Start-Sleep -Seconds 60
    }
  }
  return $exitCode
}

"=== Strategy5 scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy5 scan" -LogPath $log

$scanExit = Invoke-NodeScan "scripts\scan-strategy5-cache.js" "Strategy5 scan"
if ($scanExit -ne 0) {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 scan failed with exit code $scanExit"
  Write-Strategy5Receipt "failed" $scanExit $false 0 "" @("scanner exit code $scanExit") "critical scan failed with exit code $scanExit"
  exit $scanExit
}

$strategy5File = Join-Path $env:FUMAN_DATA_DIR "strategy5-latest.json"
if (Test-Path -LiteralPath $strategy5File) {
  try {
    $payload = Get-Content -LiteralPath $strategy5File -Raw -Encoding utf8 | ConvertFrom-Json
    $warningCount = [int]($payload.sourceHealth.warningCount ?? 0)
    if ($warningCount -gt 0 -and $env:STRATEGY5_ALLOW_SOURCE_WARNINGS -ne "1") {
      Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 scan blocked: sourceHealth.warningCount=$warningCount. Set STRATEGY5_ALLOW_SOURCE_WARNINGS=1 only for manual degraded publish."
      Write-Strategy5Receipt "degraded" 2 $true 0 "" @("sourceHealth.warningCount=$warningCount") ""
      exit 2
    }
  } catch {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 scan blocked: unable to validate source health: $($_.Exception.Message)"
    Write-Strategy5Receipt "degraded" 2 $true 0 "" @($_.Exception.Message) ""
    exit 2
  }
}

try {
  $verifiedPayload = Assert-Strategy5Api
} catch {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 API verification failed: $($_.Exception.Message)"
  Write-Strategy5Receipt "failed" 1 $false 0 "" @($_.Exception.Message) "critical scan failed during API verification"
  exit 1
}

$snapshotScript = "${PSScriptRoot}\refresh-desktop-route-snapshot.ps1"
if (Test-Path -LiteralPath $snapshotScript) {
  & $snapshotScript -Source "strategy5" -LogPath $log
  if ($LASTEXITCODE -ne 0) {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 desktop snapshot refresh failed with exit code $LASTEXITCODE"
    Write-Strategy5Receipt "failed" $LASTEXITCODE $false 0 ([string]$verifiedPayload.runId) @("desktop snapshot refresh exit code $LASTEXITCODE") "critical scan failed during desktop snapshot refresh"
    exit $LASTEXITCODE
  }
} else {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 desktop snapshot refresh skipped; helper not found."
}

Write-Strategy5Receipt "complete" 0 $true ([int]$verifiedPayload.count) ([string]$verifiedPayload.runId)
Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 API-only: slim generation and cache sync are disabled; terminal reads Supabase/API plus desktop snapshot."

Remove-Item Env:STRATEGY5_USE_MIS -ErrorAction SilentlyContinue
Add-Content -LiteralPath $log -Encoding utf8 -Value "=== Strategy5 scan end $(Get-Date) ==="


