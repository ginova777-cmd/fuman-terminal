$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($env:FUMAN_LOCAL_PORT) { $env:FUMAN_LOCAL_PORT } else { "8787" }
$node = "node"

Set-Location -LiteralPath $root
Write-Host "[local-api-only] starting http://127.0.0.1:$port"
& $node ".\scripts\local-api-only-server.js"
