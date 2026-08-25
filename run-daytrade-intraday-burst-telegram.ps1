$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node (Join-Path $root "scripts\notify-daytrade-intraday-burst-telegram.js")
exit $LASTEXITCODE
