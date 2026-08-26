$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
node scripts\refresh-strategy3-ready-snapshot.js
