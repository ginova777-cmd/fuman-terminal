$ErrorActionPreference = "Stop"

# FUMAN_MARKET_CLOSED_RUNNER_GUARD_V1
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "STAR preopen watch"
$PSNativeCommandUseErrorActionPreference = $false

& "${PSScriptRoot}\run-strategy1-preopen-common.ps1" -Mode "Watch"
exit $LASTEXITCODE
