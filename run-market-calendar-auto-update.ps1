param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = if ($env:FUMAN_LOG_DIR) { $env:FUMAN_LOG_DIR } else { "C:\fuman-runtime\logs" }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$log = Join-Path $logDir "market-calendar-auto-update-$stamp.log"

$nodeArgs = @("--use-system-ca", "scripts/update-market-calendar-auto-override.js")
if (-not $DryRun) { $nodeArgs += "--apply" }

"[$(Get-Date -Format o)] Market calendar auto update start dryRun=$DryRun" | Tee-Object -FilePath $log
Push-Location $root
try {
  & node @nodeArgs 2>&1 | Tee-Object -FilePath $log -Append
  $exit = $LASTEXITCODE
  "[$(Get-Date -Format o)] Market calendar auto update end exit=$exit" | Tee-Object -FilePath $log -Append
  exit $exit
} finally {
  Pop-Location
}
