$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = "C:\fuman-runtime\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("warrant-flow-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Invoke-NodeScan($scriptPath, $label) {
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
}

"=== Warrant flow scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
$scanExit = Invoke-NodeScan "scripts\scan-warrant-flow-cache.js" "Warrant flow scan"
if ($scanExit -ne 0) {
  "Warrant flow scan failed with exit code $scanExit" >> $log
  exit $scanExit
}
$syncScript = "C:\fuman-terminal\run-cache-sync.ps1"
if (Test-Path $syncScript) {
  "Warrant flow cache files written locally; starting Git sync now" >> $log
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript >> $log 2>&1
  $syncExit = $LASTEXITCODE
  if ($syncExit -ne 0) {
    "Cache sync failed with exit code $syncExit; scheduled sync remains as fallback" >> $log
  }
} else {
  "Warrant flow cache files written locally; Git sync script not found" >> $log
}
"=== Warrant flow scan end $(Get-Date) ===" >> $log
