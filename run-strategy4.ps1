$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repo = "C:\fuman-terminal"
$runtime = "C:\fuman-runtime"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$gitPath = "C:\Program Files\Git\cmd"
$env:Path = "$gitPath;C:\Program Files\nodejs;" + $env:Path
$env:NODE_OPTIONS = "--use-system-ca"

Set-Location $repo

$logDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("strategy4-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))

function Write-Log($message) {
  $message | Tee-Object -FilePath $log -Append | Out-Null
}

function Invoke-CacheSyncWithRetry($scriptPath, $maxAttempts = 3) {
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    Write-Log "=== Strategy4 clean cache sync attempt $attempt/$maxAttempts start $(Get-Date) ==="
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath *>&1 | Tee-Object -FilePath $log -Append | Out-Null
    $syncExit = $LASTEXITCODE
    if ($syncExit -eq 0) {
      Write-Log "=== Strategy4 clean cache sync attempt $attempt/$maxAttempts succeeded $(Get-Date) ==="
      return 0
    }

    Write-Log "Strategy4 clean cache sync attempt $attempt/$maxAttempts failed with exit code $syncExit"
    if ($attempt -lt $maxAttempts) {
      $delaySeconds = 30 * $attempt
      Write-Log "Retrying Strategy4 clean cache sync in $delaySeconds seconds."
      Start-Sleep -Seconds $delaySeconds
    }
  }

  return $syncExit
}

Write-Log "=== Strategy4 full scan start $(Get-Date) ==="
. "C:\fuman-terminal\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy4 full scan" -LogPath $log

$env:FULL_SCAN = "1"
$env:STRATEGY4_BATCH_SIZE = "9999"
$env:STRATEGY4_CHUNK_SIZE = "80"
$env:STRATEGY4_SCAN_CONCURRENCY = "6"
$env:STRATEGY4_SYNC_PARTIAL = "1"
$env:STRATEGY4_USE_MIS = "0"

try {
  & $nodeExe "--use-system-ca" "scripts\scan-strategy4-cache.js" *>&1 | Tee-Object -FilePath $log -Append
  $scanExit = $LASTEXITCODE
} finally {
  Remove-Item Env:FULL_SCAN -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_BATCH_SIZE -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_CHUNK_SIZE -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_SCAN_CONCURRENCY -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_SYNC_PARTIAL -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_USE_MIS -ErrorAction SilentlyContinue
}

if ($scanExit -ne 0) {
  Write-Log "Strategy4 scan failed with exit code $scanExit"
  exit $scanExit
}

$runtimeData = Join-Path $runtime "data"
New-Item -ItemType Directory -Force -Path $runtimeData | Out-Null
Copy-Item -LiteralPath (Join-Path $repo "data\strategy4-latest.json") -Destination (Join-Path $runtimeData "strategy4-latest.json") -Force
Copy-Item -LiteralPath (Join-Path $repo "data\strategy4-backup.json") -Destination (Join-Path $runtimeData "strategy4-backup.json") -Force
Write-Log "Strategy4 cache copied to runtime data for clean sync."

$syncScript = Join-Path $repo "run-cache-sync.ps1"
if (Test-Path -LiteralPath $syncScript) {
  Write-Log "=== Strategy4 clean cache sync start $(Get-Date) ==="
  $syncExit = Invoke-CacheSyncWithRetry $syncScript 3
  if ($syncExit -ne 0) {
    Write-Log "Strategy4 clean cache sync failed with exit code $syncExit"
    exit $syncExit
  }
  Write-Log "=== Strategy4 clean cache sync end $(Get-Date) ==="
} else {
  Write-Log "run-cache-sync.ps1 not found; strategy4 files updated locally only."
}

Write-Log "=== Strategy4 full scan end $(Get-Date) ==="
