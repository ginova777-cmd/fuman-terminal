param([string[]]$Symbols=@('2408','2455','3231'))
$repo=Split-Path -Parent $PSScriptRoot
node --use-system-ca (Join-Path $repo 'scripts\verify-daytrade-intraday-5m-readback.js') ("--symbols=" + ($Symbols -join ','))
exit $LASTEXITCODE
