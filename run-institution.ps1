$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-institution.ps1"

$runtime = "C:\fuman-runtime"
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"
$env:NODE_OPTIONS = "--use-system-ca"
if (-not $env:INSTITUTION_SLOW_SCAN) { $env:INSTITUTION_SLOW_SCAN = "1" }
if (-not $env:INSTITUTION_REQUEST_DELAY_MS) { $env:INSTITUTION_REQUEST_DELAY_MS = "15000" }
if (-not $env:INSTITUTION_FETCH_RETRIES) { $env:INSTITUTION_FETCH_RETRIES = "4" }
if (-not $env:INSTITUTION_SOURCE_PROVIDER) { $env:INSTITUTION_SOURCE_PROVIDER = "finmind" }
if (-not $env:SHIOAJI_PYTHON) { $env:SHIOAJI_PYTHON = "C:\Users\ginov\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" }
$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("institution-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Invoke-NodeScan($scriptPath, $label) {
  Push-Location "${PSScriptRoot}"
  try {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      "=== $label attempt $attempt $(Get-Date) ===" >> $log
      & $nodeExe $scriptPath >> $log 2>&1
      $exitCode = $LASTEXITCODE
      if ($exitCode -eq 0) { return 0 }
      "$label attempt $attempt failed with exit code $exitCode" >> $log
      if ($attempt -lt 3) {
        "Waiting 60 seconds before retry" >> $log
        Start-Sleep -Seconds 60
      }
    }
    return $exitCode
  } finally {
    Pop-Location
  }
}

function Copy-VerifiedFile($source, $destination, $label) {
  if (-not (Test-Path -LiteralPath $source)) {
    throw "$label source missing: $source"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
  $srcHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  $dstHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
  if ($srcHash -ne $dstHash) {
    throw "$label copy verification failed: $destination"
  }
}

function Sync-InstitutionLocalCache {
  $dataDir = Join-Path $runtime "data"
  $mainDeployRepo = if ($env:FUMAN_MAIN_DEPLOY_REPO) { $env:FUMAN_MAIN_DEPLOY_REPO } else { "C:\fuman-terminal" }
  $targets = @("${PSScriptRoot}", $mainDeployRepo) | Select-Object -Unique
  $files = @(
    "institution-latest.json",
    "institution-summary.json",
    "institution-slim.json",
    "institution-joint-top.json",
    "institution-foreign-top.json",
    "institution-trust-top.json",
    "institution-mobile-top.json",
    "institution-tdcc-breakout.json",
    "institution-tdcc-breakout-top.json",
    "institution-tdcc-breakout.csv",
    "institution-backup.json",
    "data-status-index.json",
    "terminal-home-bundle.json",
    "mobile-home-summary.json"
  )
  foreach ($targetRoot in $targets) {
    foreach ($file in $files) {
      $source = Join-Path $dataDir $file
      if (Test-Path -LiteralPath $source) {
        Copy-VerifiedFile $source (Join-Path $targetRoot "data\$file") "institution local mirror $file"
      }
    }
  }
}

"=== Institution scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
. "${PSScriptRoot}\flow-health.ps1"
Invoke-FumanWeekdayGuard -Label "Institution scan" -LogPath $log
$scanExit = Invoke-NodeScan "scripts\scan-institution-cache.js" "Institution scan"
if ($scanExit -ne 0) {
  "Institution scan failed with exit code $scanExit" >> $log
  Write-FumanFlowHealth -Scope institution -Status scan_failed -Message "Institution scan failed" -Detail @{ exitCode = $scanExit; log = $log }
  exit $scanExit
}

"Institution scan succeeded; refreshing slim/top cache files before publish" >> $log
$slimExit = Invoke-NodeScan "scripts\generate-slim-cache.js" "Institution slim refresh"
if ($slimExit -ne 0) {
  "Institution slim refresh failed with exit code $slimExit" >> $log
  Write-FumanFlowHealth -Scope institution -Status publish_delayed -Message "Institution scan succeeded but slim refresh failed" -Detail @{ exitCode = $slimExit; log = $log }
  exit $slimExit
}

$tdccExit = Invoke-NodeScan "scripts\generate-institution-tdcc-breakout.js" "Institution TDCC breakout refresh"
if ($tdccExit -ne 0) {
  "Institution TDCC breakout refresh failed with exit code $tdccExit" >> $log
  Write-FumanFlowHealth -Scope institution -Status publish_delayed -Message "Institution scan succeeded but TDCC breakout refresh failed" -Detail @{ exitCode = $tdccExit; log = $log }
  exit $tdccExit
}

try {
  Sync-InstitutionLocalCache
  "Institution cache mirrored to local terminal data folders" >> $log
} catch {
  "Institution local mirror failed: $($_.Exception.Message)" >> $log
  Write-FumanFlowHealth -Scope institution -Status publish_delayed -Message "Institution scan succeeded but local mirror failed" -Detail @{ error = $_.Exception.Message; log = $log }
  exit 1
}

$publishOk = $false
$syncScript = "${PSScriptRoot}\run-cache-sync.ps1"
if (Test-Path $syncScript) {
  "Institution cache files written locally; starting Git sync now" >> $log
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Scope institution >> $log 2>&1
  $syncExit = $LASTEXITCODE
  if ($syncExit -eq 0) {
    $publishOk = $true
  } else {
    "Cache sync failed with exit code $syncExit; scheduled sync remains as fallback" >> $log
    Write-FumanFlowHealth -Scope institution -Status publish_delayed -Message "Institution scan succeeded but Git publish failed" -Detail @{ exitCode = $syncExit; log = $log }
    exit $syncExit
  }
} else {
  "Institution cache files written locally; Git sync script not found" >> $log
  Write-FumanFlowHealth -Scope institution -Status publish_delayed -Message "Institution scan succeeded but Git sync script was not found" -Detail @{ log = $log }
  exit 1
}

if ($publishOk) {
  Write-FumanFlowHealth -Scope institution -Status ok -Message "Institution scan and publish completed" -Detail @{ log = $log }
}
"=== Institution scan end $(Get-Date) ===" >> $log
