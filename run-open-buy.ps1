$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\open-buy-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"=== Open buy full scan start $(Get-Date) ===" | Out-File $log -Encoding utf8

$env:FULL_SCAN = "1"
$env:OPEN_BUY_CHUNK_SIZE = "48"
$env:OPEN_BUY_USE_MIS = "0"

& $nodeExe "scripts\scan-open-buy-cache.js" >> $log 2>&1
$exitCode = $LASTEXITCODE

Remove-Item Env:FULL_SCAN -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_CHUNK_SIZE -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_USE_MIS -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
  "Open buy scan failed with exit code $exitCode" >> $log
  exit $exitCode
}

"Open buy cache files written locally; starting cache sync" >> $log
$syncScript = Join-Path $PWD "run-cache-sync.ps1"
if (Test-Path $syncScript) {
  $sourceFile = "C:\fuman-runtime\data\open-buy-latest.json"
  $localFile = "C:\fuman-terminal\data\open-buy-latest.json"
  $synced = $false
  for ($attempt = 1; $attempt -le 4; $attempt++) {
    "Open buy cache sync attempt $attempt/4" >> $log
    & $syncScript >> $log 2>&1
    $syncExitCode = $LASTEXITCODE
    if ($syncExitCode -ne 0) {
      "Open buy cache sync failed with exit code $syncExitCode" >> $log
      exit $syncExitCode
    }
    if ((Test-Path $sourceFile) -and (Test-Path $localFile)) {
      $sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
      $localHash = (Get-FileHash -LiteralPath $localFile -Algorithm SHA256).Hash
      if ($sourceHash -eq $localHash) {
        $synced = $true
        break
      }
      "Open buy cache sync hash mismatch after attempt $attempt; retrying" >> $log
    }
    Start-Sleep -Seconds 30
  }
  if (-not $synced) {
    "Open buy cache sync did not update local terminal data after retries" >> $log
    exit 1
  }
  "Open buy cache sync completed" >> $log
}
"=== Open buy full scan end $(Get-Date) ===" >> $log



