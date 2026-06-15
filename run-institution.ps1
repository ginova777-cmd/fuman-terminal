$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-institution.ps1"

$runtime = "C:\fuman-runtime"
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"
$env:NODE_OPTIONS = "--use-system-ca"
if (-not $env:INSTITUTION_SLOW_SCAN) { $env:INSTITUTION_SLOW_SCAN = "1" }
if (-not $env:INSTITUTION_REQUEST_DELAY_MS) { $env:INSTITUTION_REQUEST_DELAY_MS = "15000" }
if (-not $env:INSTITUTION_FETCH_RETRIES) { $env:INSTITUTION_FETCH_RETRIES = "4" }
$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("institution-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

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

"=== Institution scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
. "${PSScriptRoot}\flow-health.ps1"
Invoke-FumanWeekdayGuard -Label "Institution scan" -LogPath $log
$scanExit = Invoke-NodeScan "scripts\scan-institution-cache.js" "Institution scan"
if ($scanExit -ne 0) {
  "Institution scan failed with exit code $scanExit" >> $log
  Write-FumanFlowHealth -Scope institution -Status scan_failed -Message "Institution scan failed" -Detail @{ exitCode = $scanExit; log = $log }
  exit $scanExit
}

$publishOk = $false
$syncScript = "${PSScriptRoot}\run-cache-sync.ps1"
if (Test-Path $syncScript) {
  "Institution cache files written locally; starting Git sync now" >> $log
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Scope institution >> $log 2>&1
  $syncExit = $LASTEXITCODE
  if ($syncExit -eq 0) {
    $publishOk = $true
  } else {
    "Cache sync failed with exit code $syncExit; scheduled sync remains as fallback" >> $log
    Write-FumanFlowHealth -Scope institution -Status publish_delayed -Message "Institution scan succeeded but Git publish failed" -Detail @{ exitCode = $syncExit; log = $log }
    exit $syncExit
  }
} else {
  "Institution cache files written locally; Git sync script not found" >> $log
  Write-FumanFlowHealth -Scope institution -Status publish_delayed -Message "Institution scan succeeded but Git sync script was not found" -Detail @{ log = $log }
  exit 1
}

if ($publishOk) {
  Write-FumanFlowHealth -Scope institution -Status ok -Message "Institution scan and publish completed" -Detail @{ log = $log }
}
"=== Institution scan end $(Get-Date) ===" >> $log
