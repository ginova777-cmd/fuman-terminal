param(
  [Parameter(Mandatory=$true)][ValidateSet('12:40','13:15','17:00','21:40')][string]$Slot,
  [string]$ProjectRoot = 'C:\fuman-release-owner\fuman-terminal',
  [string]$RuntimeRoot = 'C:\fuman-runtime'
)
$ErrorActionPreference = 'Stop'
$env:FUMAN_RUNTIME_ROOT = $RuntimeRoot
$env:FUMAN_RUNTIME_DIR = $RuntimeRoot
$surfaceEvidence = Join-Path $ProjectRoot 'scripts\collect-scorecard88-terminal-surface-evidence.js'
$script = Join-Path $ProjectRoot 'scripts\collect-terminal-scorecard-88.js'
if (-not (Test-Path -LiteralPath $surfaceEvidence)) { throw "surface_evidence_collector_missing:$surfaceEvidence" }
if (-not (Test-Path -LiteralPath $script)) { throw "collector_missing:$script" }
& node $surfaceEvidence "--slot=$Slot"
$surfaceEvidenceExit = $LASTEXITCODE
& node $script "--slot=$Slot"
$collectorExit = $LASTEXITCODE
if ($collectorExit -notin @(0,3)) { exit $collectorExit }
if ($surfaceEvidenceExit -notin @(0,3)) { exit $surfaceEvidenceExit }
if ($collectorExit -eq 3 -or $surfaceEvidenceExit -eq 3) { exit 3 }
exit 0
