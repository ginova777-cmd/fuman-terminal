param(
  [Parameter(Mandatory=$true)][ValidateSet('12:40','13:15','17:00','21:40')][string]$Slot,
  [string]$ProjectRoot = 'C:\fuman-release-owner\fuman-terminal',
  [string]$RuntimeRoot = 'C:\fuman-runtime'
)
$ErrorActionPreference = 'Stop'
$env:FUMAN_RUNTIME_ROOT = $RuntimeRoot
$script = Join-Path $ProjectRoot 'scripts\collect-terminal-scorecard-88.js'
if (-not (Test-Path -LiteralPath $script)) { throw "collector_missing:$script" }
& node $script "--slot=$Slot"
exit $LASTEXITCODE
