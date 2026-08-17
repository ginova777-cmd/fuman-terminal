$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = Join-Path $env:FUMAN_RUNTIME_DIR "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("strategy3-v2-complete-scan-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
& $nodeExe "--use-system-ca" "scripts\run-strategy3-v2-complete-scan.js" "--apply" *>&1 | Tee-Object -FilePath $log -Append
exit $LASTEXITCODE