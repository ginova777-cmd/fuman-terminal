param([Parameter(Mandatory=$true)][string]$AuthorizationFile, [switch]$Apply)
$ErrorActionPreference = 'Stop'
if (-not $Apply) { throw 'Explicit -Apply required for authorized maintenance' }
& node --use-system-ca (Join-Path $PSScriptRoot 'scripts\run-cleanup-maintenance.js') "--authorization=$AuthorizationFile" --apply
exit $LASTEXITCODE
