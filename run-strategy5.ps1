$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

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

Remove-Item Env:STRATEGY5_USE_MIS -ErrorAction SilentlyContinue
$syncAfterOutput = "${PSScriptRoot}\run-sync-after-output.ps1"
if (Test-Path -LiteralPath $syncAfterOutput) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncAfterOutput -Label "Strategy5 cache" -LogPath $log -Scope strategy5
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "Strategy5 cache files written locally; sync helper not found."
}
Add-Content -LiteralPath $log -Encoding utf8 -Value "=== Strategy5 scan end $(Get-Date) ==="


