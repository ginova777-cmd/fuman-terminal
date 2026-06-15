param(
  [switch]$SkipReceiptCheck
)

$ErrorActionPreference = "Stop"
$syncRoot = $PSScriptRoot
$nodeExe = "C:\Program Files\nodejs\node.exe"

& (Join-Path $syncRoot "run-full-scan.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Push-Location $syncRoot
try {
  & $nodeExe "scripts\generate-slim-cache.js"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

if ($SkipReceiptCheck) {
  & (Join-Path $syncRoot "run-publish-gate.ps1") -SkipReceiptCheck
} else {
  & (Join-Path $syncRoot "run-publish-gate.ps1")
}
exit $LASTEXITCODE
