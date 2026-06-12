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

$syncScript = "${PSScriptRoot}\run-cache-sync.ps1"
$syncStatusFile = "C:\fuman-runtime\state\open-buy-sync-status.json"
New-Item -ItemType Directory -Force -Path (Split-Path $syncStatusFile -Parent) | Out-Null

function Write-OpenBuySyncStatus($status, $attempt, $exitCode, $message) {
  @{
    status = $status
    attempt = $attempt
    exitCode = $exitCode
    message = $message
    updatedAt = (Get-Date).ToString("o")
    log = $log
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $syncStatusFile -Encoding utf8
}

if (Test-Path -LiteralPath $syncScript) {
  $syncAttempts = 4
  $parsedSyncAttempts = 0
  if ([int]::TryParse($env:OPEN_BUY_SYNC_ATTEMPTS, [ref]$parsedSyncAttempts) -and $parsedSyncAttempts -gt 0) {
    $syncAttempts = $parsedSyncAttempts
  }
  $syncExitCode = 1
  for ($attempt = 1; $attempt -le $syncAttempts; $attempt++) {
    "Open buy cache files written locally; starting isolated openBuy Git sync attempt $attempt/$syncAttempts" >> $log
    Write-OpenBuySyncStatus "running" $attempt $null "isolated openBuy Git sync running"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Scope openBuy >> $log 2>&1
    $syncExitCode = $LASTEXITCODE
    if ($syncExitCode -eq 0) {
      Write-OpenBuySyncStatus "success" $attempt 0 "isolated openBuy Git sync completed"
      "Open buy isolated Git sync completed on attempt $attempt/$syncAttempts" >> $log
      break
    }
    "Open buy isolated Git sync attempt $attempt/$syncAttempts failed with exit code $syncExitCode" >> $log
    if ($attempt -lt $syncAttempts) {
      $sleepSeconds = [math]::Min(300, 30 * [math]::Pow(2, $attempt - 1))
      Write-OpenBuySyncStatus "retry_wait" $attempt $syncExitCode "retrying after $sleepSeconds seconds"
      "Open buy isolated Git sync retrying after $sleepSeconds seconds" >> $log
      Start-Sleep -Seconds $sleepSeconds
    }
  }
  if ($syncExitCode -ne 0) {
    Write-OpenBuySyncStatus "failed" $syncAttempts $syncExitCode "isolated openBuy Git sync failed after retries"
    "Open buy isolated Git sync failed after $syncAttempts attempts with exit code $syncExitCode" >> $log
    exit $syncExitCode
  }
} else {
  Write-OpenBuySyncStatus "skipped" 0 $null "missing $syncScript"
  "Open buy isolated Git sync skipped; missing $syncScript" >> $log
}
"=== Open buy full scan end $(Get-Date) ===" >> $log

