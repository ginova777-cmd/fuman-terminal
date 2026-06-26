param(
  [switch]$Refresh,
  [string]$Source = "post-scan-immediate-display",
  [int]$MaxAgeSeconds = 600
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location -LiteralPath "C:\fuman-terminal"

$env:FUMAN_RUNTIME_DIR = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$logDir = Join-Path $env:FUMAN_RUNTIME_DIR "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("post-scan-snapshot-refresh-verify-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))

if ($Refresh) {
  $snapshotScript = Join-Path $PSScriptRoot "refresh-desktop-route-snapshot.ps1"
  if (-not (Test-Path -LiteralPath $snapshotScript)) {
    throw "Missing refresh-desktop-route-snapshot.ps1"
  }
  & $snapshotScript -Source $Source -SkipVerify 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop route snapshot refresh failed with exit code $LASTEXITCODE; log=$log"
  }
}

$maxAgeMs = [Math]::Max(0, $MaxAgeSeconds * 1000)
node scripts\verify-post-scan-snapshot-refresh-contract.js "--max-age-ms=$maxAgeMs" 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) {
  throw "Post-scan snapshot refresh contract failed with exit code $LASTEXITCODE; log=$log"
}
