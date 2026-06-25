$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repo = "${PSScriptRoot}"
$runtime = "C:\fuman-runtime"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$gitPath = "C:\Program Files\Git\cmd"
$env:Path = "$gitPath;C:\Program Files\nodejs;" + $env:Path
$env:NODE_OPTIONS = "--use-system-ca"
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"

Set-Location $repo

$logDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("strategy4-resume-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))

function Write-Log($message) {
  $message | Tee-Object -FilePath $log -Append | Out-Null
}

Write-Log "=== Strategy4 resume scan start $(Get-Date) ==="
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy4 resume scan" -LogPath $log

$latestPath = Join-Path $repo "data\strategy4-latest.json"
if (-not (Test-Path -LiteralPath $latestPath)) {
  Write-Log "No strategy4-latest.json found; resume skipped."
  exit 0
}

$before = Get-Content -LiteralPath $latestPath -Raw | ConvertFrom-Json
if ($before.complete -eq $true) {
  Write-Log "Strategy4 already complete; resume skipped."
  exit 0
}

$maxAttempts = if ($env:STRATEGY4_RESUME_MAX_ATTEMPTS) { [int]$env:STRATEGY4_RESUME_MAX_ATTEMPTS } else { 18 }
$sleepSeconds = if ($env:STRATEGY4_RESUME_SLEEP_SECONDS) { [int]$env:STRATEGY4_RESUME_SLEEP_SECONDS } else { 1800 }

for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  $before = Get-Content -LiteralPath $latestPath -Raw | ConvertFrom-Json
  if ($before.complete -eq $true) {
    Write-Log "Strategy4 already complete; resume finished."
    exit 0
  }

  Write-Log "=== Strategy4 resume attempt $attempt/$maxAttempts pending=$($before.pendingCount) noData=$($before.noDataCount) ==="
  $env:FULL_SCAN = "0"
  $env:STRATEGY4_BATCH_SIZE = if ($env:STRATEGY4_RESUME_BATCH_SIZE) { $env:STRATEGY4_RESUME_BATCH_SIZE } else { "40" }
  $env:STRATEGY4_BATCHES_PER_RUN = if ($env:STRATEGY4_RESUME_BATCHES_PER_RUN) { $env:STRATEGY4_RESUME_BATCHES_PER_RUN } else { "3" }
  $env:STRATEGY4_USE_MIS = "1"
  $env:STRATEGY4_FAIL_ON_INCOMPLETE = "0"
  $env:STRATEGY4_ALLOW_PARTIAL_PUBLISH = "1"
  $env:STRATEGY4_SCAN_STAMP = if ($before.scanStamp) { $before.scanStamp } else { Get-Date -Format yyyyMMdd }

  try {
    & $nodeExe "scripts\scan-strategy4-cache.js" *>&1 | Tee-Object -FilePath $log -Append
    $scanExit = $LASTEXITCODE
  } finally {
    Remove-Item Env:FULL_SCAN -ErrorAction SilentlyContinue
    Remove-Item Env:STRATEGY4_BATCH_SIZE -ErrorAction SilentlyContinue
    Remove-Item Env:STRATEGY4_BATCHES_PER_RUN -ErrorAction SilentlyContinue
    Remove-Item Env:STRATEGY4_USE_MIS -ErrorAction SilentlyContinue
    Remove-Item Env:STRATEGY4_FAIL_ON_INCOMPLETE -ErrorAction SilentlyContinue
    Remove-Item Env:STRATEGY4_ALLOW_PARTIAL_PUBLISH -ErrorAction SilentlyContinue
    Remove-Item Env:STRATEGY4_SCAN_STAMP -ErrorAction SilentlyContinue
  }

  if ($scanExit -ne 0) {
    Write-Log "Strategy4 resume scan failed with exit code $scanExit"
    exit $scanExit
  }

  $runtimeData = Join-Path $runtime "data"
  New-Item -ItemType Directory -Force -Path $runtimeData | Out-Null
  Copy-Item -LiteralPath (Join-Path $repo "data\strategy4-latest.json") -Destination (Join-Path $runtimeData "strategy4-latest.json") -Force
  Copy-Item -LiteralPath (Join-Path $repo "data\strategy4-backup.json") -Destination (Join-Path $runtimeData "strategy4-backup.json") -Force
  Write-Log "Strategy4 resume cache copied to runtime data."

  $syncScript = Join-Path $repo "run-cache-sync.ps1"
  if (Test-Path -LiteralPath $syncScript) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Scope strategy4 *>&1 | Tee-Object -FilePath $log -Append | Out-Null
    $syncExit = $LASTEXITCODE
    if ($syncExit -ne 0) {
      Write-Log "Strategy4 resume cache sync failed with exit code $syncExit"
      exit $syncExit
    }
  }

  $after = Get-Content -LiteralPath $latestPath -Raw | ConvertFrom-Json
  if ($after.complete -eq $true) {
    Write-Log "Strategy4 resume Google Sheet upload skipped: retired."
    Write-Log "=== Strategy4 resume scan end $(Get-Date) complete=$($after.complete) pending=$($after.pendingCount) noData=$($after.noDataCount) ==="
    exit 0
  }

  Write-Log "Strategy4 resume attempt $attempt incomplete: complete=$($after.complete) pending=$($after.pendingCount) noData=$($after.noDataCount)"
  if ($attempt -lt $maxAttempts) {
    Write-Log "Strategy4 resume sleeping $sleepSeconds seconds before next attempt."
    Start-Sleep -Seconds $sleepSeconds
  }
}

Write-Log "Strategy4 resume exhausted $maxAttempts attempts."
exit 1
