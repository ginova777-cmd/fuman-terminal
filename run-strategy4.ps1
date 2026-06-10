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
$log = Join-Path $logDir ("strategy4-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$strategy4Stamp = Get-Date -Format yyyyMMdd

function Write-Log($message) {
  $message | Tee-Object -FilePath $log -Append | Out-Null
}

function Invoke-CacheSyncWithRetry($scriptPath, $maxAttempts = 3) {
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    Write-Log "=== Strategy4 clean cache sync attempt $attempt/$maxAttempts start $(Get-Date) ==="
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Scope strategy4 *>&1 | Tee-Object -FilePath $log -Append | Out-Null
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
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy4 full scan" -LogPath $log

$env:FULL_SCAN = "1"
$env:STRATEGY4_BATCH_SIZE = "80"
$env:STRATEGY4_BATCHES_PER_RUN = "999"
$env:STRATEGY4_USE_MIS = "1"
$env:STRATEGY4_FAIL_ON_INCOMPLETE = "1"
$env:STRATEGY4_ALLOW_PARTIAL_PUBLISH = "1"
$env:STRATEGY4_SYNC_PARTIAL = "1"
$env:STRATEGY4_PARTIAL_SYNC_EVERY_CHUNKS = "1"
$env:STRATEGY4_SCAN_STAMP = $strategy4Stamp

try {
  & $nodeExe "scripts\verify-strategy4-data-sources.js" *>&1 | Tee-Object -FilePath $log -Append
  $sourceExit = $LASTEXITCODE
  if ($sourceExit -ne 0) {
    Write-Log "Strategy4 data source verification failed with exit code $sourceExit"
    exit $sourceExit
  }
  & $nodeExe "scripts\verify-strategy4-contract.js" *>&1 | Tee-Object -FilePath $log -Append
  $contractExit = $LASTEXITCODE
  if ($contractExit -ne 0) {
    Write-Log "Strategy4 contract verification failed with exit code $contractExit"
    exit $contractExit
  }
  & $nodeExe "scripts\scan-strategy4-cache.js" *>&1 | Tee-Object -FilePath $log -Append
  $scanExit = $LASTEXITCODE
} finally {
  Remove-Item Env:FULL_SCAN -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_BATCH_SIZE -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_BATCHES_PER_RUN -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_USE_MIS -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_FAIL_ON_INCOMPLETE -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_ALLOW_PARTIAL_PUBLISH -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_SYNC_PARTIAL -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_PARTIAL_SYNC_EVERY_CHUNKS -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_SCAN_STAMP -ErrorAction SilentlyContinue
}

if ($scanExit -ne 0) {
  Write-Log "Strategy4 scan failed with exit code $scanExit"
  exit $scanExit
}

$runtimeData = Join-Path $runtime "data"
New-Item -ItemType Directory -Force -Path $runtimeData | Out-Null
Copy-Item -LiteralPath (Join-Path $repo "data\strategy4-latest.json") -Destination (Join-Path $runtimeData "strategy4-latest.json") -Force
Copy-Item -LiteralPath (Join-Path $repo "data\strategy4-summary.json") -Destination (Join-Path $runtimeData "strategy4-summary.json") -Force
& $nodeExe "scripts\generate-slim-cache.js" *>&1 | Tee-Object -FilePath $log -Append
Copy-Item -LiteralPath (Join-Path $repo "data\strategy4-backup.json") -Destination (Join-Path $runtimeData "strategy4-backup.json") -Force
Write-Log "Strategy4 cache copied to runtime data for clean sync."

$strategy4Output = Get-Content -LiteralPath (Join-Path $repo "data\strategy4-latest.json") -Raw | ConvertFrom-Json
$sheetUploaded = $false

if ($env:STRATEGY4_UPLOAD_SHEET_AFTER_SCAN -ne "0" -and $strategy4Output.complete -eq $true) {
  $uploadScript = Join-Path $repo "run-upload-backtest-google-sheet.ps1"
  if (Test-Path -LiteralPath $uploadScript) {
    Write-Log "=== Strategy4 Google Sheet upload start $(Get-Date) ==="
    $previousOnly = $env:GOOGLE_SHEET_ONLY
    $env:GOOGLE_SHEET_ONLY = "策略4成績單"
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $uploadScript $strategy4Stamp *>&1 | Tee-Object -FilePath $log -Append | Out-Null
      $sheetExit = $LASTEXITCODE
    } finally {
      if ($null -ne $previousOnly) {
        $env:GOOGLE_SHEET_ONLY = $previousOnly
      } else {
        Remove-Item Env:GOOGLE_SHEET_ONLY -ErrorAction SilentlyContinue
      }
    }
    if ($sheetExit -ne 0) {
      Write-Log "Strategy4 Google Sheet upload failed with exit code $sheetExit"
      exit $sheetExit
    }
    $sheetUploaded = $true
    Write-Log "=== Strategy4 Google Sheet upload end $(Get-Date) ==="
  } else {
    Write-Log "Strategy4 Google Sheet upload script not found: $uploadScript"
    exit 1
  }
}

$syncScript = Join-Path $repo "run-cache-sync.ps1"
if (Test-Path -LiteralPath $syncScript) {
  Write-Log "=== Strategy4 clean cache sync start $(Get-Date) ==="
  $syncExit = Invoke-CacheSyncWithRetry $syncScript 3
  if ($syncExit -ne 0) {
    Write-Log "Strategy4 clean cache sync failed with exit code $syncExit"
    $retryScript = Join-Path $repo "run-strategy4-sync-retry.ps1"
    if (Test-Path -LiteralPath $retryScript) {
      Write-Log "Strategy4 sync retry background scan started because cache sync failed."
      Start-Process -FilePath "C:\Program Files\PowerShell\7\pwsh.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $retryScript) -WindowStyle Hidden | Out-Null
    } else {
      Write-Log "Strategy4 sync retry script not found: $retryScript"
    }
  }
  else {
    Write-Log "=== Strategy4 clean cache sync end $(Get-Date) ==="
  }
} else {
  Write-Log "run-cache-sync.ps1 not found; strategy4 files updated locally only."
}

$postflightScript = Join-Path $repo "run-strategy4-postflight.ps1"
if (Test-Path -LiteralPath $postflightScript) {
  Write-Log "=== Strategy4 postflight start $(Get-Date) ==="
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $postflightScript *>&1 | Tee-Object -FilePath $log -Append | Out-Null
  $postflightExit = $LASTEXITCODE
  if ($postflightExit -ne 0) {
    Write-Log "Strategy4 postflight failed with exit code $postflightExit"
    exit $postflightExit
  }
  Write-Log "=== Strategy4 postflight end $(Get-Date) ==="
} else {
  Write-Log "Strategy4 postflight script not found: $postflightScript"
}

if ($env:STRATEGY4_UPLOAD_SHEET_AFTER_SCAN -ne "0" -and $strategy4Output.complete -eq $true -and -not $sheetUploaded) {
  $uploadScript = Join-Path $repo "run-upload-backtest-google-sheet.ps1"
  if (Test-Path -LiteralPath $uploadScript) {
    Write-Log "=== Strategy4 Google Sheet upload start $(Get-Date) ==="
    $previousOnly = $env:GOOGLE_SHEET_ONLY
    $env:GOOGLE_SHEET_ONLY = "策略4成績單"
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $uploadScript $strategy4Stamp *>&1 | Tee-Object -FilePath $log -Append | Out-Null
      $sheetExit = $LASTEXITCODE
    } finally {
      if ($null -ne $previousOnly) {
        $env:GOOGLE_SHEET_ONLY = $previousOnly
      } else {
        Remove-Item Env:GOOGLE_SHEET_ONLY -ErrorAction SilentlyContinue
      }
    }
    if ($sheetExit -ne 0) {
      Write-Log "Strategy4 Google Sheet upload failed with exit code $sheetExit"
      exit $sheetExit
    }
    Write-Log "=== Strategy4 Google Sheet upload end $(Get-Date) ==="
  } else {
    Write-Log "Strategy4 Google Sheet upload script not found: $uploadScript"
    exit 1
  }
} else {
  if ($strategy4Output.complete -ne $true) {
    Write-Log "Strategy4 Google Sheet upload skipped because scan is incomplete: scanned=$($strategy4Output.scannedThisRun)/$($strategy4Output.total), noData=$($strategy4Output.noDataCount), errors=$($strategy4Output.errorCount)."
    $resumeScript = Join-Path $repo "run-strategy4-resume.ps1"
    if (Test-Path -LiteralPath $resumeScript) {
      Write-Log "Strategy4 resume background scan started because scan is incomplete."
      Start-Process -FilePath "C:\Program Files\PowerShell\7\pwsh.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $resumeScript) -WindowStyle Hidden | Out-Null
    } else {
      Write-Log "Strategy4 resume script not found: $resumeScript"
    }
  } else {
    Write-Log "Strategy4 Google Sheet upload skipped because STRATEGY4_UPLOAD_SHEET_AFTER_SCAN=0."
  }
}

Write-Log "=== Strategy4 full scan end $(Get-Date) ==="


