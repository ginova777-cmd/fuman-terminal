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

"CB detect API-only: scanner success reads Supabase snapshot/API plus desktop snapshot." >> $log
"=== CB detect full scan end $(Get-Date) ===" >> $log
exit 0
