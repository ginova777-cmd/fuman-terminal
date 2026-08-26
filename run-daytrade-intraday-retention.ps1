param(
  [switch]$Apply,
  [int]$MaxBatches = 60
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$node = "node"
$script = Join-Path $root "scripts\cleanup-daytrade-intraday-retention.js"
if (-not (Test-Path -LiteralPath $script)) { throw "intraday retention script missing: $script" }

$argsList = @("--use-system-ca", $script, "--max-batches=$MaxBatches", "--json")
if ($Apply) { $argsList += "--apply" } else { $argsList += "--dry-run" }
& $node @argsList
if ($LASTEXITCODE -ne 0) { throw "daytrade intraday retention failed with exit code $LASTEXITCODE" }
