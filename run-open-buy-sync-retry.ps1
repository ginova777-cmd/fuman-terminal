$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:NODE_OPTIONS = "--use-system-ca"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs","C:\fuman-runtime\state" | Out-Null
$log = "C:\fuman-runtime\logs\open-buy-sync-retry-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"=== Open buy sync retry start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Open buy sync retry" -LogPath $log

$statusFile = "C:\fuman-runtime\state\open-buy-sync-status.json"
$latestFile = "C:\fuman-runtime\data\open-buy-latest.json"
$syncScript = "${PSScriptRoot}\run-cache-sync.ps1"

function Read-JsonOrNull($path) {
  try {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    return Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
  } catch {
    return $null
  }
}

if (-not (Test-Path -LiteralPath $latestFile)) {
  "Missing latest file; nothing to retry: $latestFile" >> $log
  exit 0
}

$latestWrite = (Get-Item -LiteralPath $latestFile).LastWriteTimeUtc
$status = Read-JsonOrNull $statusFile
$statusTime = $null
if ($status -and $status.updatedAt) {
  try { $statusTime = ([DateTimeOffset]::Parse([string]$status.updatedAt)).UtcDateTime } catch {}
}

$needsRetry = $true
if ($status -and $status.status -eq "success" -and $statusTime -and $statusTime -ge $latestWrite) {
  $needsRetry = $false
}

if (-not $needsRetry) {
  "Open buy sync retry skipped; last success covers latest file. statusUpdatedAt=$($status.updatedAt), latestWrite=$latestWrite" >> $log
  exit 0
}

"Open buy sync retry needed. status=$($status.status), statusUpdatedAt=$($status.updatedAt), latestWrite=$latestWrite" >> $log
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Scope openBuy >> $log 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -eq 0) {
  @{
    status = "success"
    attempt = 1
    exitCode = 0
    message = "openBuy retry sync completed"
    updatedAt = (Get-Date).ToString("o")
    log = $log
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusFile -Encoding utf8
  "Open buy sync retry completed" >> $log
  exit 0
}

@{
  status = "failed"
  attempt = 1
  exitCode = $exitCode
  message = "openBuy retry sync failed"
  updatedAt = (Get-Date).ToString("o")
  log = $log
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusFile -Encoding utf8
"Open buy sync retry failed with exit code $exitCode" >> $log
exit $exitCode

