$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

& "${PSScriptRoot}\run-strategy1-preopen-common.ps1" -Mode "Prepare"
exit $LASTEXITCODE
