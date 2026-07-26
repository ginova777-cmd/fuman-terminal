param(
  [string]$Root = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"
$startedAt = Get-Date
$logDir = Join-Path $RuntimeDir "logs"
$stateDir = Join-Path $RuntimeDir "state\daytrade-warmup-nine-day"
$receiptFile = Join-Path $RuntimeDir "state\daytrade-warmup-nine-day-audit-latest.json"
$logFile = Join-Path $logDir ("daytrade-warmup-nine-day-audit-{0}.log" -f $startedAt.ToString("yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $logDir,$stateDir | Out-Null

$record = [ordered]@{
  contract = "daytrade-warmup-nine-day-audit-task-v1"
  checkedAt = $startedAt.ToString("o")
  taskResult = "AUDIT_EXECUTED"
  ok = $false
  status = "ERROR"
  blockingReasons = @()
  report = ""
  logFile = $logFile
}

try {
  Push-Location -LiteralPath $Root
  try {
    $raw = (& node --use-system-ca "scripts\verify-daytrade-warmup-nine-day-window.js" 2>&1 | Out-String).Trim()
    $exitCode = $LASTEXITCODE
  }
  finally {
    Pop-Location
  }
  Set-Content -LiteralPath $logFile -Value $raw -Encoding UTF8
  $payload = $raw | ConvertFrom-Json -ErrorAction Stop
  $record.ok = ($payload.ok -eq $true)
  $record.status = [string]$payload.status
  $record.blockingReasons = @($payload.blockingReasons)
  $record.report = [string]$payload.output
  $record.verifierExitCode = $exitCode
  $record.note = "TRACKING_PENDING is an honest in-window state; it is not an unattended completion claim."
}
catch {
  $record.error = $_.Exception.Message
  Set-Content -LiteralPath $logFile -Value ($record | ConvertTo-Json -Depth 8) -Encoding UTF8
}
finally {
  $record.finishedAt = (Get-Date).ToString("o")
  $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptFile -Encoding UTF8
}

$record | ConvertTo-Json -Depth 8
if ($record.error) { exit 1 }
exit 0


