$ErrorActionPreference = "Stop"
Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:GOOGLE_SHEET_ID = "1UCpEBXmOWNA57eLXH62WffnPrflly6OwmDm242JYhp8"
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
& $nodeExe "scripts\upload-trade-manager-to-google-sheet.js"


