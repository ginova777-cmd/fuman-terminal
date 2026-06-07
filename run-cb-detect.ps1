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
$log = Join-Path $logDir ("cb-detect-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

"=== CB detect full scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
Push-Location "C:\fuman-terminal"
try {
  & $nodeExe "scripts\generate-cb-detect.js" >> $log 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    "CB detect full scan failed with exit code $exitCode" >> $log
    exit $exitCode
  }
} finally {
  Pop-Location
}

$syncScript = "C:\fuman-terminal\run-cache-sync.ps1"
if (Test-Path -LiteralPath $syncScript) {
  "CB detect full scan completed; starting Git sync" >> $log
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Scope cb >> $log 2>&1
  if ($LASTEXITCODE -ne 0) {
    "CB detect Git sync failed with exit code $LASTEXITCODE" >> $log
    exit $LASTEXITCODE
  }
} else {
  "CB detect sync skipped; run-cache-sync.ps1 not found." >> $log
}

"=== CB detect full scan end $(Get-Date) ===" >> $log
