$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$runtime = "C:\fuman-runtime"
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("warrant-flow-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

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

"=== Warrant flow scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
. "${PSScriptRoot}\flow-health.ps1"
Invoke-FumanWeekdayGuard -Label "Warrant flow scan" -LogPath $log
$scanExit = Invoke-NodeScan "scripts\scan-warrant-flow-cache.js" "Warrant flow scan"
if ($scanExit -ne 0) {
  "Warrant flow scan failed with exit code $scanExit" >> $log
  Write-FumanFlowHealth -Scope warrant -Status scan_failed -Message "Warrant flow scan failed" -Detail @{ exitCode = $scanExit; log = $log }
  exit $scanExit
}

$publishOk = $false
$syncScript = "${PSScriptRoot}\run-cache-sync.ps1"
if (Test-Path $syncScript) {
  "Warrant flow cache files written locally; starting Git sync now" >> $log
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Scope warrant >> $log 2>&1
  $syncExit = $LASTEXITCODE
  if ($syncExit -eq 0) {
    $publishOk = $true
  } else {
    "Cache sync failed with exit code $syncExit; scheduled sync remains as fallback" >> $log
    Write-FumanFlowHealth -Scope warrant -Status publish_delayed -Message "Warrant flow scan succeeded but Git publish failed" -Detail @{ exitCode = $syncExit; log = $log }
  }
} else {
  "Warrant flow cache files written locally; Git sync script not found" >> $log
  Write-FumanFlowHealth -Scope warrant -Status publish_delayed -Message "Warrant flow scan succeeded but Git sync script was not found" -Detail @{ log = $log }
}

if ($publishOk) {
  Write-FumanFlowHealth -Scope warrant -Status ok -Message "Warrant flow scan and publish completed" -Detail @{ log = $log }
}
"=== Warrant flow scan end $(Get-Date) ===" >> $log
