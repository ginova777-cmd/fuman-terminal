$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-open-buy.ps1"

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\open-buy-$(Get-Date -Format yyyyMMdd-HHmmss).log"
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
$scanStartedAt = (Get-Date).ToString("o")
"=== Open buy full scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Open buy full scan" -LogPath $log

$env:FULL_SCAN = "1"
$env:OPEN_BUY_BATCH_SIZE = "64"
$env:OPEN_BUY_BATCHES_PER_RUN = "999"
$env:OPEN_BUY_USE_MIS = "0"
$script:OpenBuyVerifiedRunId = ""
$script:OpenBuyVerifiedCount = 0
$script:OpenBuyReceiptWarnings = @()

function Write-OpenBuyReceipt($Status, $ExitCode, $Complete, $Matches, $RunId, $Warnings = @(), $BlockingReason = "") {
  $receipt = [ordered]@{
    strategy = "open-buy"
    label = "open buy raw refresh"
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
    payloadPath = (Join-Path $env:FUMAN_DATA_DIR "open-buy-latest.json")
    warnings = @($Warnings)
    blockingReason = $BlockingReason
    log = $log
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptDir "open-buy.json") -Encoding utf8
}

& $nodeExe "scripts\scan-open-buy-cache.js" >> $log 2>&1
$exitCode = $LASTEXITCODE

Remove-Item Env:FULL_SCAN -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_BATCH_SIZE -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_BATCHES_PER_RUN -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_USE_MIS -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
  "Open buy scan failed with exit code $exitCode" >> $log
  Write-OpenBuyReceipt "failed" $exitCode $false 0 "" @("scanner exit code $exitCode") "critical scan failed with exit code $exitCode"
  exit $exitCode
}

$scanRunId = ""
$scanMatches = 0
$runLine = Select-String -LiteralPath $log -Pattern "open-buy supabase run_id gate ok:\s*([^,]+),\s*matches\s+(\d+)" | Select-Object -Last 1
if ($runLine -and $runLine.Matches.Count -gt 0) {
  $scanRunId = [string]$runLine.Matches[0].Groups[1].Value
  $scanMatches = [int]$runLine.Matches[0].Groups[2].Value
}

$verifyUrl = "https://fuman-terminal.vercel.app/api/open-buy-latest?canvas=1&compact=1&shell=1&limit=60&live=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
"Open buy API-only scan complete; verifying terminal compact complete-run API $verifyUrl" >> $log
try {
  $response = Invoke-WebRequest $verifyUrl -UseBasicParsing
  $payload = $response.Content | ConvertFrom-Json
  if ($response.StatusCode -ne 200 -or $payload.ok -ne $true -or $payload.complete -ne $true -or -not $payload.runId) {
    $isControlledWaiting = $response.StatusCode -eq 200 -and $payload.ok -eq $true -and $payload.decisionReady -eq $false -and [string]$payload.error -eq "strategy1_decision_not_ready" -and -not [string]::IsNullOrWhiteSpace($scanRunId)
    if (-not $isControlledWaiting) {
      throw "open-buy API verification failed status=$($response.StatusCode) ok=$($payload.ok) complete=$($payload.complete) runId=$($payload.runId)"
    }
    $script:OpenBuyVerifiedRunId = $scanRunId
    $script:OpenBuyVerifiedCount = $scanMatches
    $pendingDetail = [string]$payload.detail
    if ([string]::IsNullOrWhiteSpace($pendingDetail)) { $pendingDetail = [string]$payload.reason }
    if ([string]::IsNullOrWhiteSpace($pendingDetail)) { $pendingDetail = [string]$payload.error }
    $script:OpenBuyReceiptWarnings = @("decision pending: $pendingDetail")
    "Open buy compact API is in controlled waiting state; scanner readback runId=$scanRunId count=$scanMatches decisionReady=$($payload.decisionReady) detail=$($payload.detail)" >> $log
  } else {
    $script:OpenBuyVerifiedRunId = [string]$payload.runId
    $script:OpenBuyVerifiedCount = [int]$payload.count
    "Open buy terminal compact API verified runId=$($payload.runId) count=$($payload.count) usedDate=$($payload.usedDate) decisionReady=$($payload.decisionReady)" >> $log
  }
} catch {
  "Open buy API-only verification failed: $($_.Exception.Message)" >> $log
  Write-OpenBuyReceipt "failed" 1 $false 0 "" @($_.Exception.Message) "critical scan failed during API verification"
  exit 1
}

$snapshotScript = "${PSScriptRoot}\refresh-desktop-route-snapshot.ps1"
if (Test-Path -LiteralPath $snapshotScript) {
  & $snapshotScript -Source "open-buy" -LogPath $log
  if ($LASTEXITCODE -ne 0) {
    "Open buy desktop snapshot refresh failed with exit code $LASTEXITCODE" >> $log
    exit $LASTEXITCODE
  }
} else {
  "Open buy desktop snapshot refresh skipped; helper not found." >> $log
}

Write-OpenBuyReceipt "complete" 0 $true $script:OpenBuyVerifiedCount $script:OpenBuyVerifiedRunId $script:OpenBuyReceiptWarnings
"=== Open buy full scan end $(Get-Date) ===" >> $log
