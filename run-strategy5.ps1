$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-strategy5.ps1"

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"
$env:STRATEGY5_USE_MIS = "0"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\strategy5-$(Get-Date -Format yyyyMMdd-HHmmss).log"

function Invoke-NodeScan($scriptPath, $label) {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "=== $label attempt $attempt $(Get-Date) ==="
    & $nodeExe $scriptPath 2>&1 | Out-File -LiteralPath $log -Encoding utf8 -Append
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
      return 0
    }
    Add-Content -LiteralPath $log -Encoding utf8 -Value "$label attempt $attempt failed with exit code $exitCode"
    if ($attempt -lt 3) {
      Add-Content -LiteralPath $log -Encoding utf8 -Value "Waiting 60 seconds before retry"
      Start-Sleep -Seconds 60
    }
  }
  return $exitCode
}

"=== Strategy5 scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy5 scan" -LogPath $log

$scanExit = Invoke-NodeScan "scripts\scan-strategy5-cache.js" "Strategy5 scan"
if ($scanExit -ne 0) {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 scan failed with exit code $scanExit"
  exit $scanExit
}

$strategy5File = "C:\fuman-runtime\data\strategy5-latest.json"
if (Test-Path -LiteralPath $strategy5File) {
  try {
    $payload = Get-Content -LiteralPath $strategy5File -Raw -Encoding utf8 | ConvertFrom-Json
    $warningCount = [int]($payload.sourceHealth.warningCount ?? 0)
    if ($warningCount -gt 0 -and $env:STRATEGY5_ALLOW_SOURCE_WARNINGS -ne "1") {
      Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 scan blocked: sourceHealth.warningCount=$warningCount. Set STRATEGY5_ALLOW_SOURCE_WARNINGS=1 only for manual degraded publish."
      exit 2
    }
  } catch {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 scan blocked: unable to validate source health: $($_.Exception.Message)"
    exit 2
  }
}

$snapshotScript = "${PSScriptRoot}\refresh-desktop-route-snapshot.ps1"
if (Test-Path -LiteralPath $snapshotScript) {
  & $snapshotScript -Source "strategy5" -LogPath $log
  if ($LASTEXITCODE -ne 0) {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 desktop snapshot refresh failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
  }
} else {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 desktop snapshot refresh skipped; helper not found."
}

$slimScript = "scripts\generate-slim-cache.js"
if (Test-Path -LiteralPath $slimScript) {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "=== Strategy5 index regeneration start $(Get-Date) ==="
  & $nodeExe $slimScript 2>&1 | Out-File -LiteralPath $log -Encoding utf8 -Append
  if ($LASTEXITCODE -ne 0) {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 index regeneration failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
  }
  Add-Content -LiteralPath $log -Encoding utf8 -Value "=== Strategy5 index regeneration end $(Get-Date) ==="
}

Remove-Item Env:STRATEGY5_USE_MIS -ErrorAction SilentlyContinue
$syncAfterOutput = "${PSScriptRoot}\run-sync-after-output.ps1"
if (Test-Path -LiteralPath $syncAfterOutput) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncAfterOutput -Label "Strategy5 cache" -LogPath $log -Scope strategy5
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 cache files written locally; sync helper not found."
}
Add-Content -LiteralPath $log -Encoding utf8 -Value "=== Strategy5 scan end $(Get-Date) ==="


