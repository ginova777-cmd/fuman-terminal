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

function Invoke-Strategy5InlineTerminalVerify {
  $outDir = Join-Path $env:FUMAN_DATA_DIR "strategy5-88-data-chain"
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $previousRoot = $env:FUMAN_TERMINAL_ROOT
  $previousRuntime = $env:FUMAN_RUNTIME_DIR
  $previousAuditBase = $env:FUMAN_AUDIT_BASE_URL
  try {
    $env:FUMAN_TERMINAL_ROOT = $PSScriptRoot
    $env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
    $env:FUMAN_AUDIT_BASE_URL = "https://fuman-terminal.vercel.app"
    Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 inline terminal/sourceReports verify start"
    & npm.cmd run verify:strategy5-88-data-chain -- --out=$outDir *>&1 | Tee-Object -FilePath $log -Append
    $verifyExit = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
    if ($verifyExit -ne 0) { throw "strategy5 terminal chain verifier exit=$verifyExit" }
    $reportPath = Join-Path $outDir "strategy5-88-data-chain.json"
    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    if ($report.ok -ne $true) { throw "strategy5 terminal chain verifier ok=false issues=$($report.issues | ConvertTo-Json -Compress)" }
    if ([string]::IsNullOrWhiteSpace([string]$report.runId)) { throw "strategy5 terminal chain verifier missing runId" }
    Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 inline terminal/sourceReports verify ok runId=$($report.runId) resultCount=$($report.resultCount) readbackCount=$($report.readbackCount)"
    return [pscustomobject]@{
      runId = [string]$report.runId
      count = [int]($report.resultCount ?? $report.readbackCount ?? 0)
      cacheSource = "internal-terminal-sourceReports-readback"
    }
  } finally {
    if ($null -ne $previousRoot) { $env:FUMAN_TERMINAL_ROOT = $previousRoot } else { Remove-Item Env:FUMAN_TERMINAL_ROOT -ErrorAction SilentlyContinue }
    if ($null -ne $previousRuntime) { $env:FUMAN_RUNTIME_DIR = $previousRuntime } else { Remove-Item Env:FUMAN_RUNTIME_DIR -ErrorAction SilentlyContinue }
    if ($null -ne $previousAuditBase) { $env:FUMAN_AUDIT_BASE_URL = $previousAuditBase } else { Remove-Item Env:FUMAN_AUDIT_BASE_URL -ErrorAction SilentlyContinue }
  }
}
function Get-Strategy5ScanBlockedReason {
  try {
    $text = Get-Content -LiteralPath $log -Raw -ErrorAction Stop
    $match = [regex]::Match($text, "strategy5 complete run blocked: (?<reason>[^\r\n]+)")
    if ($match.Success) { return $match.Groups["reason"].Value.Trim() }
  } catch {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 blocked reason scan failed: $($_.Exception.Message)"
  }
  return ""
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

function Invoke-Strategy5SnapshotRefresh($RunId = "", $Count = 0, $Warning = "") {
  $snapshotScript = "${PSScriptRoot}\refresh-desktop-route-snapshot.ps1"
  if (Test-Path -LiteralPath $snapshotScript) {
    & $snapshotScript -Source "strategy5" -LogPath $log
    if ($LASTEXITCODE -ne 0) {
      Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 desktop snapshot refresh failed with exit code $LASTEXITCODE"
      Write-Strategy5Receipt "failed" $LASTEXITCODE $false 0 $RunId @("desktop snapshot refresh exit code $LASTEXITCODE") "critical scan failed during desktop snapshot refresh"
      exit $LASTEXITCODE
    }
  } else {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 desktop snapshot refresh skipped; helper not found."
  }
  if ($Warning) {
    Write-Strategy5Receipt "complete" 0 $true $Count $RunId @($Warning) $Warning
  }
}

"=== Strategy5 scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy5 scan" -LogPath $log
. "${PSScriptRoot}\scanner-resource-health.ps1"
$resourceGate = Invoke-ScannerResourceHealthGate -Strategy "strategy5" -LogPath $log
if ($resourceGate.PreserveLatest) {
  $reason = "resource health $($resourceGate.Status): $($resourceGate.Reason)"
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 source gate blocked new publish; preserving latest complete run. $reason"
  $verifiedPayload = Invoke-Strategy5InlineTerminalVerify
  Invoke-Strategy5SnapshotRefresh ([string]$verifiedPayload.runId) ([int]$verifiedPayload.count) $reason
  exit 0
}

$scanExit = Invoke-NodeScan "scripts\scan-strategy5-cache.js" "Strategy5 scan"
if ($scanExit -ne 0) {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 scan failed with exit code $scanExit"
  Write-Strategy5Receipt "failed" $scanExit $false 0 "" @("scanner exit code $scanExit") "critical scan failed with exit code $scanExit"
  exit $scanExit
}

$scanBlockedReason = Get-Strategy5ScanBlockedReason
if (-not [string]::IsNullOrWhiteSpace($scanBlockedReason)) {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 scanner completed but formal publish blocked; preserving previous good. reason=$scanBlockedReason"
  Write-Strategy5Receipt "blocked" 0 $false 0 "" @("formal publish blocked: $scanBlockedReason") $scanBlockedReason
  exit 0
}

try {
  $verifiedPayload = Invoke-Strategy5InlineTerminalVerify
} catch {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 terminal/sourceReports verification failed after scanner success: $($_.Exception.Message)"
  Write-Strategy5Receipt "failed" 1 $false 0 "" @($_.Exception.Message) "scanner finished but terminal/sourceReports readback failed"
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
Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 API-only: scanner success verifies /api/strategy5-latest through scorecard source report; terminal reads Supabase/API plus desktop snapshot."

Remove-Item Env:STRATEGY5_USE_MIS -ErrorAction SilentlyContinue
Add-Content -LiteralPath $log -Encoding utf8 -Value "=== Strategy5 scan end $(Get-Date) ==="
