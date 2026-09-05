param(
  [ValidateSet("Complete", "Status")][string]$Mode = "Complete",
  [switch]$PushLine
)
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
$log = Join-Path $logDir ("strategy3-complete-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
function Invoke-Required([string]$Name, [scriptblock]$Action) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Name)
  & $Action 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw ("{0}_failed_exit_{1}" -f $Name, $LASTEXITCODE) }
}
if ($Mode -eq "Status") {
  & $nodeExe "--use-system-ca" "scripts\finalize-strategy3-complete.js" "--status-only"
  exit $LASTEXITCODE
}
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy3 V2 complete scan"
try {
  Invoke-Required "water metadata contract" { & $nodeExe "--use-system-ca" "scripts\repair-strategy3-v2-water-metadata.js" }
  Invoke-Required "12:30 readiness evidence" { & $pwshExe -NoProfile -File ".\run-strategy3-v2-readiness-guard.ps1" -Phase 1230 }
  Invoke-Required "12:50 readiness evidence" { & $pwshExe -NoProfile -File ".\run-strategy3-v2-readiness-guard.ps1" -Phase 1250 }
  Invoke-Required "12:55 fail-closed evidence" { & $pwshExe -NoProfile -File ".\run-strategy3-v2-1255-first-attempt.ps1" }
  Invoke-Required "formal V2 scan and database apply" { & $nodeExe "--use-system-ca" "scripts\run-strategy3-v2-complete-scan.js" "--apply" }
  Invoke-Required "LINE card contract dry run" { & $nodeExe "--use-system-ca" "scripts\send-strategy3-v2-line-card.js" "--dry-run" }
  if (-not $PushLine) { throw "line_push_authorization_required:rerun_with_-PushLine" }
  Invoke-Required "LINE personal and group push" { & $nodeExe "--use-system-ca" "scripts\send-strategy3-v2-line-card.js" }
  Invoke-Required "desktop snapshot refresh" { & $pwshExe -NoProfile -File ".\refresh-desktop-route-snapshot.ps1" -Source strategy3 }
  Invoke-Required "mobile snapshot refresh" { & $nodeExe "--use-system-ca" "scripts\publish-mobile-fragment-snapshots.js" "--tabs=strategy3" }
  Invoke-Required "water universe verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-water-universe.js" }
  Invoke-Required "three-surface verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-surface-closure.js" }
  Invoke-Required "daily unattended verifier" { & $nodeExe "--use-system-ca" "scripts\verify-strategy3-v2-daily-unattended-closure.js" }
  Invoke-Required "canonical final receipt" { & $nodeExe "--use-system-ca" "scripts\finalize-strategy3-complete.js" }
  exit 0
} catch {
  Write-Error $_.Exception.Message
  & $nodeExe "--use-system-ca" "scripts\finalize-strategy3-complete.js" "--record-failure"
  exit 1
}
