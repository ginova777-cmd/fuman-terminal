$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

& "${PSScriptRoot}\run-strategy1-preopen-common.ps1" -Mode "Final"
exit $LASTEXITCODE
