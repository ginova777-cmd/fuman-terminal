$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = "C:\fuman-runtime\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("flow-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Write-FlowLog($message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Invoke-NodeScan($scriptPath, $label, $attempts = 3, $delaySeconds = 60) {
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    Write-FlowLog "=== $label attempt $attempt/$attempts $(Get-Date) ==="
    & $nodeExe $scriptPath >> $log 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
      Write-FlowLog "$label succeeded on attempt $attempt"
      return 0
    }
    Write-FlowLog "$label failed with exit code $exitCode"
    if ($attempt -lt $attempts) {
      Write-FlowLog "Waiting $delaySeconds seconds before retry"
      Start-Sleep -Seconds $delaySeconds
    }
  }
  return $exitCode
}

function Read-Json($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try { return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { return $null }
}

Write-FlowLog "=== Flow and warrant scan start $(Get-Date) ==="
. "C:\fuman-terminal\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Flow and warrant scan" -LogPath $log

$institutionExit = Invoke-NodeScan "scripts\scan-institution-cache.js" "Institution scan" 3 60
if ($institutionExit -ne 0) {
  Write-FlowLog "Institution scan failed after retries with exit code $institutionExit"
  exit $institutionExit
}

$warrantExit = Invoke-NodeScan "scripts\scan-warrant-flow-cache.js" "Warrant flow scan" 3 60
if ($warrantExit -ne 0) {
  Write-FlowLog "Warrant flow scan failed after retries with exit code $warrantExit"
  exit $warrantExit
}

$syncScript = "C:\fuman-terminal\run-cache-sync.ps1"
if (-not (Test-Path -LiteralPath $syncScript)) {
  Write-FlowLog "Cache sync script not found: $syncScript"
  exit 1
}

Write-FlowLog "Flow cache files written locally; publishing to terminal now"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Scope flow >> $log 2>&1
$syncExit = $LASTEXITCODE
if ($syncExit -ne 0) {
  Write-FlowLog "Flow cache publish failed with exit code $syncExit"
  exit $syncExit
}

$institution = Read-Json "C:\fuman-runtime\data\institution-latest.json"
$warrant = Read-Json "C:\fuman-runtime\data\warrant-flow-latest.json"
$usedDate = if ($institution.usedDate) { $institution.usedDate } else { "--" }
$institutionCount = if ($institution.count) { $institution.count } else { 0 }
$warrantCount = if ($warrant.count) { $warrant.count } else { 0 }

Write-FlowLog "FLOW_PUBLISH_SUCCESS time=$(Get-Date -Format o) institutionUsedDate=$usedDate institutionRows=$institutionCount warrantMatches=$warrantCount"
Write-FlowLog "=== Flow and warrant scan end $(Get-Date) ==="