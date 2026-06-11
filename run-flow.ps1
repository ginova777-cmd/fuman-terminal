$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = "C:\fuman-runtime\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("flow-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Write-FlowLog($message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Invoke-NodeScan($scriptPath, $label, $attempts = 3, $delaySeconds = 60) {
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    Write-FlowLog "=== $label attempt $attempt/$attempts $(Get-Date) ==="
    & $nodeExe $scriptPath >> $log 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
      Write-FlowLog "$label succeeded on attempt $attempt"
      return 0
    }
    Write-FlowLog "$label failed with exit code $exitCode"
    if ($attempt -lt $attempts) {
      Write-FlowLog "Waiting $delaySeconds seconds before retry"
      Start-Sleep -Seconds $delaySeconds
    }
  }
  return $exitCode
}

function Read-Json($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try { return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { return $null }
}

function Write-FlowHealth($scope, $status, $message, $detail = @{}) {
  try {
    Write-FumanFlowHealth -Scope $scope -Status $status -Message $message -Detail $detail
  } catch {
    Write-FlowLog "Flow health write failed scope=$scope status=$status error=$($_.Exception.Message)"
  }
}

function Invoke-FlowFreshnessVerification {
  Write-FlowLog "Running data freshness verification before publish success"
  & $nodeExe "scripts\verify-data-freshness.js" >> $log 2>&1
  return $LASTEXITCODE
}

function Invoke-AfterhoursSupabaseVerification {
  Write-FlowLog "Running afterhours Supabase JSON/readback verification"
  & $nodeExe "scripts\sync-afterhours-supabase-status.js" "--source=fuman_afterhours_flow" "--require=institution,warrant" "--optional=cb" >> $log 2>&1
  return $LASTEXITCODE
}

Write-FlowLog "=== Flow and warrant scan start $(Get-Date) ==="
. "${PSScriptRoot}\schedule-guard.ps1"
. "${PSScriptRoot}\flow-health.ps1"
Invoke-FumanWeekdayGuard -Label "Flow and warrant scan" -LogPath $log

$institutionExit = Invoke-NodeScan "scripts\scan-institution-cache.js" "Institution scan" 3 60
if ($institutionExit -ne 0) {
  Write-FlowLog "Institution scan failed after retries with exit code $institutionExit"
  Write-FlowHealth "institution" "failed" "Institution scan failed after retries" @{ exitCode = $institutionExit; log = $log }
  Write-FlowHealth "flow" "failed" "Flow stopped at institution scan" @{ stage = "institution"; exitCode = $institutionExit; log = $log }
  exit $institutionExit
}
Write-FlowHealth "institution" "ok" "Institution scan completed" @{ exitCode = 0; log = $log }

$warrantExit = Invoke-NodeScan "scripts\scan-warrant-flow-cache.js" "Warrant flow scan" 3 60
if ($warrantExit -ne 0) {
  Write-FlowLog "Warrant flow scan failed after retries with exit code $warrantExit"
  Write-FlowHealth "warrant" "failed" "Warrant flow scan failed after retries" @{ exitCode = $warrantExit; log = $log }
  Write-FlowHealth "flow" "failed" "Flow stopped at warrant scan" @{ stage = "warrant"; exitCode = $warrantExit; log = $log }
  exit $warrantExit
}
Write-FlowHealth "warrant" "ok" "Warrant flow scan completed" @{ exitCode = 0; log = $log }

$syncScript = "${PSScriptRoot}\run-cache-sync.ps1"
if (-not (Test-Path -LiteralPath $syncScript)) {
  Write-FlowLog "Cache sync script not found: $syncScript"
  Write-FlowHealth "publish" "failed" "Cache sync script not found" @{ path = $syncScript; log = $log }
  Write-FlowHealth "flow" "failed" "Flow stopped before publish" @{ stage = "publish"; path = $syncScript; log = $log }
  exit 1
}

Write-FlowLog "Flow cache files written locally; publishing to terminal now"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Scope flow >> $log 2>&1
$syncExit = $LASTEXITCODE
if ($syncExit -ne 0) {
  Write-FlowLog "Flow cache publish failed with exit code $syncExit"
  Write-FlowHealth "publish" "failed" "Flow cache publish failed" @{ exitCode = $syncExit; log = $log }
  Write-FlowHealth "flow" "failed" "Flow stopped at publish" @{ stage = "publish"; exitCode = $syncExit; log = $log }
  exit $syncExit
}
Write-FlowHealth "publish" "ok" "Flow cache published to terminal source" @{ exitCode = 0; log = $log }

$freshnessExit = Invoke-FlowFreshnessVerification
if ($freshnessExit -ne 0) {
  Write-FlowLog "Data freshness verification failed with exit code $freshnessExit"
  Write-FlowHealth "freshness" "failed" "Data freshness verification failed after flow publish" @{ exitCode = $freshnessExit; log = $log }
  Write-FlowHealth "flow" "failed" "Flow stopped at freshness verification" @{ stage = "freshness"; exitCode = $freshnessExit; log = $log }
  exit $freshnessExit
}
Write-FlowHealth "freshness" "ok" "Data freshness verification passed" @{ exitCode = 0; log = $log }

$supabaseExit = Invoke-AfterhoursSupabaseVerification
if ($supabaseExit -ne 0) {
  Write-FlowLog "Afterhours Supabase verification failed with exit code $supabaseExit"
  Write-FlowHealth "supabase" "failed" "Afterhours Supabase verification failed" @{ exitCode = $supabaseExit; log = $log }
  Write-FlowHealth "flow" "failed" "Flow stopped at Supabase verification" @{ stage = "supabase"; exitCode = $supabaseExit; log = $log }
  exit $supabaseExit
}
Write-FlowHealth "supabase" "ok" "Afterhours Supabase verification passed" @{ exitCode = 0; log = $log }

$institution = Read-Json "C:\fuman-runtime\data\institution-latest.json"
$warrant = Read-Json "C:\fuman-runtime\data\warrant-flow-latest.json"
$usedDate = if ($institution.usedDate) { $institution.usedDate } else { "--" }
$institutionCount = if ($institution.count) { $institution.count } else { 0 }
$warrantCount = if ($warrant.count) { $warrant.count } else { 0 }

Write-FlowLog "FLOW_PUBLISH_SUCCESS time=$(Get-Date -Format o) institutionUsedDate=$usedDate institutionRows=$institutionCount warrantMatches=$warrantCount"
Write-FlowHealth "flow" "ok" "Flow scan, publish and freshness completed" @{ institutionUsedDate = $usedDate; institutionRows = $institutionCount; warrantMatches = $warrantCount; log = $log }
Write-FlowLog "=== Flow and warrant scan end $(Get-Date) ==="
