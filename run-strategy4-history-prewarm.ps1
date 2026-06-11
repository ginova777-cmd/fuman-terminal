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
$log = Join-Path $logDir ("strategy4-history-prewarm-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))

function Write-Log($message) {
  $message | Tee-Object -FilePath $log -Append | Out-Null
}

Write-Log "=== Strategy4 history prewarm start $(Get-Date) ==="
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy4 history prewarm" -LogPath $log

$env:STRATEGY4_USE_MIS = "0"
if ($null -eq $env:STRATEGY4_PREWARM_BATCH_SIZE -or $env:STRATEGY4_PREWARM_BATCH_SIZE -eq "") { $env:STRATEGY4_PREWARM_BATCH_SIZE = "40" }
if ($null -eq $env:STRATEGY4_PREWARM_BATCHES_PER_RUN -or $env:STRATEGY4_PREWARM_BATCHES_PER_RUN -eq "") { $env:STRATEGY4_PREWARM_BATCHES_PER_RUN = "0" }
if ($null -eq $env:STRATEGY4_PREWARM_SLEEP_MS -or $env:STRATEGY4_PREWARM_SLEEP_MS -eq "") { $env:STRATEGY4_PREWARM_SLEEP_MS = "800" }
if ($null -eq $env:STRATEGY4_PREWARM_MAX_REMAINING_MISS -or $env:STRATEGY4_PREWARM_MAX_REMAINING_MISS -eq "") { $env:STRATEGY4_PREWARM_MAX_REMAINING_MISS = "2000" }

try {
  & $nodeExe "scripts\prewarm-strategy4-history-cache.js" *>&1 | Tee-Object -FilePath $log -Append
  $prewarmExit = $LASTEXITCODE
} finally {
  Remove-Item Env:STRATEGY4_USE_MIS -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_PREWARM_BATCH_SIZE -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_PREWARM_BATCHES_PER_RUN -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_PREWARM_SLEEP_MS -ErrorAction SilentlyContinue
  Remove-Item Env:STRATEGY4_PREWARM_MAX_REMAINING_MISS -ErrorAction SilentlyContinue
}

if ($prewarmExit -ne 0) {
  Write-Log "Strategy4 history prewarm failed with exit code $prewarmExit"
  exit $prewarmExit
}

Write-Log "=== Strategy4 history prewarm end $(Get-Date) ==="
