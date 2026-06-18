$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
# Strategy3 fast path is scan -> Supabase complete run -> no-store API -> frontend polling.
# Do not call cache sync here; official archival publish remains freshness gate/release only.
& "${PSScriptRoot}\run-strategy3-complete-scan.ps1"
exit $LASTEXITCODE

