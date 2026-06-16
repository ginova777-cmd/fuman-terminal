param(
  [string]$Label = "legacy data script"
)

if ($env:FUMAN_LEGACY_SCAN_ONLY -eq "1") {
  return
}

$directScanLabels = @("run-open-buy.ps1", "run-open-buy-sync-retry.ps1", "run-strategy2-intraday.ps1")
if ($directScanLabels -contains $Label) {
  return
}

Set-Location -LiteralPath $PSScriptRoot
$gateScript = if ($env:FUMAN_LEGACY_GATE_SCRIPT) { $env:FUMAN_LEGACY_GATE_SCRIPT } else { "freshness:gate:fast" }
Write-Host "$Label redirected to npm run $gateScript"
npm run $gateScript
exit $LASTEXITCODE


