param([Parameter(Mandatory=$true)][string]$Symbols)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root
& node --use-system-ca scripts\run-daytrade-intraday-5m-complete.js "--symbols=$Symbols"
if ($LASTEXITCODE -ne 0) { throw "5m runner/verifier/receipt closure failed (exit=$LASTEXITCODE)" }
