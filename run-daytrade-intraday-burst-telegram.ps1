$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
& node --use-system-ca (Join-Path $root "scripts\run-telegram-three-detectors.js")
exit $LASTEXITCODE
