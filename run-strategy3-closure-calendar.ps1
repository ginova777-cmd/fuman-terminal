$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
& (Join-Path $PSScriptRoot 'scripts\invoke-market-status-guard.ps1') -Stage 'strategy3-closure' -ExecutionMode 'natural'
if ($LASTEXITCODE -eq 10) { exit 0 }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& 'C:\Program Files\nodejs\node.exe' --use-system-ca (Join-Path $PSScriptRoot 'scripts\verify-strategy3-v2-daily-unattended-closure.js')
exit $LASTEXITCODE
