param(
  [string]$Label = "legacy data script"
)

if ($env:FUMAN_LEGACY_SCAN_ONLY -eq "1") {
  return
}

$directScanLabels = @(
  "run-open-buy.ps1",
  "run-open-buy-preopen-prepare.ps1",
  "run-open-buy-preopen.ps1",
  "run-star-preopen-watch.ps1",
  "run-strategy1-preopen-common.ps1",
  "run-open-buy-sync-retry.ps1",
  "run-strategy2-intraday.ps1",
  "run-realtime-radar.ps1",
  "run-strategy5.ps1",
  "run-institution.ps1",
  "run-warrant-flow.ps1"
)
if ($directScanLabels -contains $Label) {
  return
}

Set-Location -LiteralPath $PSScriptRoot
$gateScript = if ($env:FUMAN_LEGACY_GATE_SCRIPT) { $env:FUMAN_LEGACY_GATE_SCRIPT } else { "freshness:gate:fast" }
Write-Host "$Label redirected to npm run $gateScript"
npm run $gateScript
exit $LASTEXITCODE


