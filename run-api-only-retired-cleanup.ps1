param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$logDir = Join-Path $runtimeRoot "logs"
$lockFile = Join-Path $runtimeRoot "locks\api-only-retired-cleanup.lock"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$script = Join-Path $root "scripts\cleanup-api-only-retired-artifacts.js"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lockFile) | Out-Null
$log = Join-Path $logDir ("api-only-retired-cleanup-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Write-CleanupLog($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Test-LockAlive {
  if (-not (Test-Path -LiteralPath $lockFile)) { return $false }
  try {
    $raw = Get-Content -LiteralPath $lockFile -Raw
    $info = $raw | ConvertFrom-Json
    $pidValue = [int]$info.pid
    if ($pidValue -gt 0 -and (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) { return $true }
  } catch {}
  return $false
}

if (Test-LockAlive) {
  Write-CleanupLog "Another API-only cleanup is already running; skip."
  exit 0
}

@{
  pid = $PID
  startedAt = (Get-Date).ToString("o")
  log = $log
} | ConvertTo-Json -Compress | Set-Content -LiteralPath $lockFile -Encoding utf8

try {
  $args = @($script, "--root", "C:\fuman-terminal", "--root", "C:\fuman-terminal-sync", "--runtime-root", $runtimeRoot)
  if ($DryRun) { $args += "--dry-run" }
  Write-CleanupLog "START node cleanup dryRun=$DryRun"
  & $nodeExe @args *>&1 | ForEach-Object {
    $text = [string]$_
    Write-Host $text
    Add-Content -LiteralPath $log -Value $text -Encoding utf8
  }
  if ($LASTEXITCODE -ne 0) { throw "cleanup failed with exit code $LASTEXITCODE" }
  Write-CleanupLog "END cleanup ok"
} finally {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
