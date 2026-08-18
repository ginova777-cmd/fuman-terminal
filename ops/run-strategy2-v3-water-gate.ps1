[CmdletBinding()]
param(
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"
$env:FUMAN_RUNTIME_DIR = $RuntimeDir

& node --use-system-ca (Join-Path $FumanRoot "scripts\run-strategy2-v3-water-scan.js")
exit $LASTEXITCODE
