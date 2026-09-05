param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$suffix = if ($Apply) { @('--apply', '--json') } else { @('--json') }
if ($Apply) {
  . (Join-Path $root 'schedule-guard.ps1')
  Invoke-FumanWeekdayGuard -Label "Daily retention maintenance"
}

& $node (Join-Path $root 'scripts\cleanup-runtime-retention.js') @suffix
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }


& $node (Join-Path $root 'scripts\cleanup-daytrade-stale-priority-cache.js') @suffix
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $node '--use-system-ca' (Join-Path $root 'scripts\cleanup-source-observability-retention.js') @suffix
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Produce the daily readback only after both cleanup receipts are safely written.
& $node '--use-system-ca' (Join-Path $root 'scripts\verify-daily-retention-maintenance.js')
exit $LASTEXITCODE

