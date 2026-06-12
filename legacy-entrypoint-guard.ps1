param(
  [string]$Label = "legacy data script"
)

if ($env:FUMAN_LEGACY_SCAN_ONLY -eq "1") {
  return
}

Set-Location -LiteralPath $PSScriptRoot
Write-Host "$Label redirected to npm run freshness:gate"
npm run freshness:gate
exit $LASTEXITCODE
