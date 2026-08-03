[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$Final,
  [switch]$Synthesize,
  [string]$TradeDate = "",
  [int]$MaxSymbols = 2000
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$WriterScript = Join-Path $RepoRoot "scripts\repair-daytrade-intraday-1m-gaps.js"
$ApprovalFile = "C:\fuman-runtime\config\daytrade-source-host-approval.json"
if (-not $Apply) {
  Write-Host "DRY RUN only. Re-run with -Apply on the approved daytrade writer host."
}
if ($Apply) {
  if (-not (Test-Path -LiteralPath $ApprovalFile)) { throw "missing approved source-host file: $ApprovalFile" }
  $approval = Get-Content -LiteralPath $ApprovalFile -Raw | ConvertFrom-Json
  if (-not $approval.approved -or $approval.sourceRole -ne "writer" -or $approval.hostId -ne $env:COMPUTERNAME) {
    throw "source writer host approval mismatch"
  }
}
$nodeArgs = @($WriterScript, "--max-symbols=$MaxSymbols")
if ($Apply) { $nodeArgs += "--apply" }
if ($Final) { $nodeArgs += "--final" }
if ($Synthesize) { $nodeArgs += "--synthesize" }
if ($TradeDate) { $nodeArgs += "--trade-date=$TradeDate" }
& node --use-system-ca @nodeArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
