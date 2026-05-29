$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$env:NODE_OPTIONS = "--use-system-ca"

New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\strategy3-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"=== Strategy3 scan start $(Get-Date) ===" | Out-File $log -Encoding utf8
. "C:\fuman-terminal\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy3 scan" -LogPath $log

function Write-Strategy3Log($message) {
  $message >> $log
}

function Invoke-WithRetry($label, [scriptblock]$action, $maxAttempts = 3, $sleepSeconds = 30) {
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    Write-Strategy3Log "$label attempt $attempt/$maxAttempts start $(Get-Date)"
    try {
      & $action
      $exitCode = $LASTEXITCODE
      if ($null -eq $exitCode) { $exitCode = 0 }
      if ($exitCode -eq 0) {
        Write-Strategy3Log "$label attempt $attempt succeeded"
        return
      }
      Write-Strategy3Log "$label attempt $attempt failed with exit code $exitCode"
    } catch {
      Write-Strategy3Log "$label attempt $attempt threw: $($_.Exception.Message)"
    }
    if ($attempt -lt $maxAttempts) {
      Start-Sleep -Seconds $sleepSeconds
    }
  }
  throw "$label failed after $maxAttempts attempts"
}

Invoke-WithRetry "Strategy3 scan" {
  & $nodeExe "scripts\scan-strategy3-cache.js" >> $log 2>&1
} 3 20

$runtimeStrategy3 = "C:\fuman-runtime\data\strategy3-latest.json"
$syncStrategy3 = "C:\fuman-terminal-sync\data\strategy3-latest.json"
if (-not (Test-Path -LiteralPath $runtimeStrategy3)) {
  throw "Strategy3 runtime file missing after scan: $runtimeStrategy3"
}

Invoke-WithRetry "Strategy3 cache sync" {
  & "C:\fuman-terminal\run-cache-sync.ps1" -Scope strategy3 >> $log 2>&1
  if ($LASTEXITCODE -ne 0) { throw "cache sync exited with code $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $syncStrategy3)) {
    throw "Strategy3 sync file missing after cache sync: $syncStrategy3"
  }
  $runtimeHash = (Get-FileHash -LiteralPath $runtimeStrategy3 -Algorithm SHA256).Hash
  $syncHash = (Get-FileHash -LiteralPath $syncStrategy3 -Algorithm SHA256).Hash
  if ($runtimeHash -ne $syncHash) {
    throw "Strategy3 sync verification failed; runtime/sync SHA256 mismatch. runtime=$runtimeHash sync=$syncHash"
  }
  Write-Strategy3Log "Strategy3 cache sync verified: $runtimeHash"
} 3 45

Write-Strategy3Log "=== Strategy3 scan end $(Get-Date) ==="

