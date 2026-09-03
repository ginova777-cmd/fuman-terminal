param([ValidateSet("Complete", "Status")][string]$Mode = "Complete")
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath $PSScriptRoot
$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtime
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node.exe" }
$pwshExe = (Get-Process -Id $PID).Path
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("buy-sell-complete-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
function Invoke-Required([string]$Name, [scriptblock]$Action) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Name)
  & $Action 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw ("{0}_failed_exit_{1}" -f $Name, $LASTEXITCODE) }
}
if ($Mode -eq "Status") {
  & $nodeExe "--use-system-ca" "scripts\verify-buy-sell-complete.js"
  exit $LASTEXITCODE
}
. "$PSScriptRoot\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Buy/sell complete" -LogPath $log -AllowAfterFormalSourceWindow
try {
  Invoke-Required "chip source sync" { & $pwshExe -NoProfile -File ".\run-chip-source-sync.ps1" }
  Invoke-Required "institution formal scan" { & $pwshExe -NoProfile -File ".\run-institution.ps1" }
  Invoke-Required "institution E2E closure" { & $nodeExe "--use-system-ca" "scripts\verify-institution-e2e-closure.js" }
  Invoke-Required "business fields" { & $nodeExe "scripts\verify-institution-business-fields.js" }
  Invoke-Required "strategy requirements" { & $nodeExe "scripts\verify-institution-strategy-requirements.js" }
  Invoke-Required "formal payloads" { & $nodeExe "scripts\verify-institution-formal-payloads.js" }
  Invoke-Required "UI display" { & $nodeExe "scripts\verify-institution-ui-display.js" }
  Invoke-Required "buy-sell canonical receipt" { & $nodeExe "--use-system-ca" "scripts\verify-buy-sell-complete.js" "--write-receipt" }
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
