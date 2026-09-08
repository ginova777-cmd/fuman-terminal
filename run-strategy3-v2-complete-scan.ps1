param(
  [ValidateSet("Complete", "Status")][string]$Mode = "Complete",
  [switch]$PushLine,
  [switch]$Recovery
)
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath $PSScriptRoot
$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtime
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node.exe" }
$pwshExe = (Get-Process -Id $PID).Path
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("strategy3-complete-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
function Invoke-Required([string]$Name, [scriptblock]$Action) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Name)
  & $Action 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw ("{0}_failed_exit_{1}" -f $Name, $LASTEXITCODE) }
}
if ($Mode -eq "Status") {
  & $nodeExe "--use-system-ca" "scripts\finalize-strategy3-complete.js" "--status-only"
  exit $LASTEXITCODE
}
. "${PSScriptRoot}\schedule-guard.ps1"
if (-not $Recovery) {
  Invoke-FumanWeekdayGuard -Label "Strategy3 V2 complete scan"
}
function Invoke-Strategy3ScorecardPrepare([string]$RunId, [int]$ExpectedCount) {
  $previousRefreshKey = $env:FUMAN_SCORECARD_REFRESH_KEY
  $previousRefreshRunId = $env:FUMAN_SCORECARD_REFRESH_RUN_ID
  try {
    $env:FUMAN_SCORECARD_REFRESH_KEY = "strategy3"
    $env:FUMAN_SCORECARD_REFRESH_RUN_ID = $RunId
    Invoke-Required "Strategy3 scorecard 13:15 source prepare" { & npm.cmd run scorecard:terminal-source }
  } finally {
    if ($null -ne $previousRefreshKey) { $env:FUMAN_SCORECARD_REFRESH_KEY = $previousRefreshKey } else { Remove-Item Env:FUMAN_SCORECARD_REFRESH_KEY -ErrorAction SilentlyContinue }
    if ($null -ne $previousRefreshRunId) { $env:FUMAN_SCORECARD_REFRESH_RUN_ID = $previousRefreshRunId } else { Remove-Item Env:FUMAN_SCORECARD_REFRESH_RUN_ID -ErrorAction SilentlyContinue }
  }
  $scorecardPath = Join-Path $runtime "data\scorecard-terminal-current.json"
  $scorecard = Get-Content -LiteralPath $scorecardPath -Raw | ConvertFrom-Json
  $report = @($scorecard.sourceReports | Where-Object { $_.key -eq "strategy3" }) | Select-Object -First 1
  $rows = @($scorecard.records | Where-Object { $_.strategy -eq "策略3隔日沖成績單" -and $_.record_date -eq (Get-Date -Format "yyyy-MM-dd") })
  if ([string]$report.runId -ne $RunId -or $report.ok -ne $true -or $rows.Count -ne $ExpectedCount) { throw "strategy3_scorecard_source_prepare_mismatch:runId=$($report.runId):rows=$($rows.Count):expected=$ExpectedCount" }
}
try {
  if ($Recovery) {
    $compactDate = Get-Date -Format "yyyyMMdd"
    $scanPath = Join-Path $runtime "data\scan-receipts\strategy3-v2-complete-scan-$compactDate.json"
    $linePath = Join-Path $runtime "data\line-cards\strategy3-v2-line-card-$compactDate.json"
    if (-not (Test-Path -LiteralPath $scanPath)) { throw "strategy3_recovery_scan_receipt_missing:$scanPath" }
    if (-not (Test-Path -LiteralPath $linePath)) { throw "strategy3_recovery_line_receipt_missing:$linePath" }
    $scanReceipt = Get-Content -LiteralPath $scanPath -Raw | ConvertFrom-Json
    $lineReceipt = Get-Content -LiteralPath $linePath -Raw | ConvertFrom-Json
    if ($scanReceipt.ok -ne $true -or [string]$scanReceipt.status -ne "COMPLETE" -or $scanReceipt.apply -ne $true) { throw "strategy3_recovery_requires_complete_applied_scan" }
    if ($lineReceipt.ok -ne $true -or [string]$lineReceipt.status -ne "PUSHED" -or $lineReceipt.line_push_personal_ok -ne $true -or $lineReceipt.line_push_group_ok -ne $true) { throw "strategy3_recovery_requires_delivered_line_evidence" }
    if ([string]$scanReceipt.run_id -ne [string]$lineReceipt.run_id) { throw "strategy3_recovery_runid_mismatch" }
    if ([int]$scanReceipt.result_count -ne [int]$lineReceipt.count) { throw "strategy3_recovery_count_mismatch" }
    Write-Host ("Recovery reuses runId={0} count={1}; scan and LINE push are not repeated." -f $scanReceipt.run_id, $scanReceipt.result_count)
    Invoke-Required "water universe verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-water-universe.js" }
    Invoke-Strategy3ScorecardPrepare -RunId ([string]$scanReceipt.run_id) -ExpectedCount ([int]$scanReceipt.result_count)
    . "${PSScriptRoot}\verify-post-scan-tri-surface.ps1"
    Invoke-Required "strict API/desktop/mobile/scorecard closure" { Assert-PostScanTriSurfaceClosure -Route "strategy3" -RunId ([string]$scanReceipt.run_id) -LogPath $log | Out-Null }
    Invoke-Required "daily unattended verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-daily-unattended-closure.js" }
    Invoke-Required "canonical final receipt" { & $nodeExe "--use-system-ca" "scripts\finalize-strategy3-complete.js" }
    exit 0
  }
  Invoke-Required "12:30 readiness evidence" { & $pwshExe -NoProfile -File ".\run-strategy3-v2-readiness-guard.ps1" -Phase 1230 }
  Invoke-Required "12:50 readiness evidence" { & $pwshExe -NoProfile -File ".\run-strategy3-v2-readiness-guard.ps1" -Phase 1250 }
  Invoke-Required "12:55 fail-closed evidence" { & $pwshExe -NoProfile -File ".\run-strategy3-v2-1255-first-attempt.ps1" }
  Invoke-Required "formal V2 scan and database apply" { & $nodeExe "--use-system-ca" "scripts\run-strategy3-v2-complete-scan.js" "--apply" }
  Invoke-Required "water universe verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-water-universe.js" }
  Invoke-Required "desktop snapshot refresh" { & $pwshExe -NoProfile -File ".\refresh-desktop-route-snapshot.ps1" -Source strategy3 }
  Invoke-Required "mobile snapshot refresh" { & $nodeExe "--use-system-ca" "scripts\publish-mobile-fragment-snapshots.js" "--tabs=strategy3" }
  Invoke-Required "three-surface verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-surface-closure.js" }
  Invoke-Required "LINE card contract dry run" { & $nodeExe "--use-system-ca" "scripts\send-strategy3-v2-line-card.js" "--dry-run" }
  if (-not $PushLine) { throw "line_push_authorization_required:rerun_with_-PushLine" }
  Invoke-Required "LINE personal and group push" { & $nodeExe "--use-system-ca" "scripts\send-strategy3-v2-line-card.js" }
  Invoke-Required "daily unattended verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-daily-unattended-closure.js" }
  $scanReceipt = Get-Content -LiteralPath (Join-Path $runtime ("data\scan-receipts\strategy3-v2-complete-scan-{0}.json" -f (Get-Date -Format "yyyyMMdd"))) -Raw | ConvertFrom-Json
  Invoke-Strategy3ScorecardPrepare -RunId ([string]$scanReceipt.run_id) -ExpectedCount ([int]$scanReceipt.result_count)
  Invoke-Required "canonical receipt awaiting fixed 13:15 scorecard collection" { & $nodeExe "--use-system-ca" "scripts\finalize-strategy3-complete.js" "--awaiting-scorecard" }
  exit 0
} catch {
  Write-Error $_.Exception.Message
  & $nodeExe "--use-system-ca" "scripts\finalize-strategy3-complete.js" "--record-failure"
  exit 1
}
