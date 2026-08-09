[CmdletBinding()]
param(
  [switch]$StaticOnly,
  [switch]$RequireLive
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$args = @('--use-system-ca', (Join-Path $repo 'scripts\verify-daytrade-source-acceptance.js'))
if ($RequireLive -or -not $StaticOnly) { $args += '--require-live' }

& node @args
if ($LASTEXITCODE -ne 0) {
  Write-Host 'FINAL: observe/preserve only' -ForegroundColor Yellow
  exit $LASTEXITCODE
}
Write-Host 'FINAL: PASS' -ForegroundColor Green
