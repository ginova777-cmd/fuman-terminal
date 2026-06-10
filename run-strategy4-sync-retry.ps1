$ErrorActionPreference = "Continue"

$script = "${PSScriptRoot}\run-strategy4-partial-sync.ps1"
$logDir = "${PSScriptRoot}\logs"
$log = Join-Path $logDir ("strategy4-sync-retry-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$maxAttempts = if ($env:STRATEGY4_SYNC_RETRY_ATTEMPTS) { [int]$env:STRATEGY4_SYNC_RETRY_ATTEMPTS } else { 30 }
$sleepSeconds = if ($env:STRATEGY4_SYNC_RETRY_SECONDS) { [int]$env:STRATEGY4_SYNC_RETRY_SECONDS } else { 60 }

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log($message) {
  $message | Tee-Object -FilePath $log -Append
}

for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  Write-Log "=== Strategy4 sync retry attempt $attempt/$maxAttempts $(Get-Date) ==="
  & $script *>&1 | Tee-Object -FilePath $log -Append
  $exit = $LASTEXITCODE
  if ($exit -eq 0) {
    Write-Log "Strategy4 sync retry succeeded."
    exit 0
  }
  Write-Log "Strategy4 sync retry failed with exit code $exit; sleeping $sleepSeconds seconds."
  Start-Sleep -Seconds $sleepSeconds
}

Write-Log "Strategy4 sync retry exhausted all attempts."
exit 1
