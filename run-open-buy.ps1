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
"=== Open buy full scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Open buy full scan" -LogPath $log

$env:FULL_SCAN = "1"
$env:OPEN_BUY_BATCH_SIZE = "64"
$env:OPEN_BUY_BATCHES_PER_RUN = "999"
$env:OPEN_BUY_USE_MIS = "0"

& $nodeExe "scripts\scan-open-buy-cache.js" >> $log 2>&1
$exitCode = $LASTEXITCODE

Remove-Item Env:FULL_SCAN -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_BATCH_SIZE -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_BATCHES_PER_RUN -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_USE_MIS -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
  "Open buy scan failed with exit code $exitCode" >> $log
  exit $exitCode
}

$verifyUrl = "https://fuman-terminal.vercel.app/api/open-buy-latest?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
"Open buy API-only scan complete; verifying latest complete-run API $verifyUrl" >> $log
try {
  $response = Invoke-WebRequest $verifyUrl -UseBasicParsing
  $payload = $response.Content | ConvertFrom-Json
  if ($response.StatusCode -ne 200 -or $payload.ok -ne $true -or $payload.complete -ne $true -or -not $payload.runId) {
    throw "open-buy API verification failed status=$($response.StatusCode) ok=$($payload.ok) complete=$($payload.complete) runId=$($payload.runId)"
  }
  "Open buy API-only verified runId=$($payload.runId) count=$($payload.count) usedDate=$($payload.usedDate)" >> $log
} catch {
  "Open buy API-only verification failed: $($_.Exception.Message)" >> $log
  exit 1
}
"=== Open buy full scan end $(Get-Date) ===" >> $log

