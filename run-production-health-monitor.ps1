param(
  [string]$ProjectRoot = $PSScriptRoot,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" })
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$logDir = Join-Path $RuntimeRoot "logs"
$receiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
$log = Join-Path $logDir ("production-health-monitor-{0}.log" -f (Get-Date -Format "yyyyMMdd"))
$receipt = Join-Path $receiptDir "production-health-monitor.json"

New-Item -ItemType Directory -Force -Path $logDir, $receiptDir | Out-Null

function Write-MonitorLog($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Write-Receipt($payload) {
  $payload | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receipt -Encoding utf8
}

$startedAt = Get-Date
$exitCode = 0
$output = New-Object System.Collections.Generic.List[string]

try {
  Write-MonitorLog "START production health monitor"
  Push-Location $ProjectRoot
  try {
    $env:FUMAN_PRODUCTION_HEALTH_LOG = Join-Path $logDir "production-health.jsonl"
    & npm run monitor:production *>&1 | ForEach-Object {
      $text = [string]$_
      $output.Add($text) | Out-Null
      Write-Host $text
      Add-Content -LiteralPath $log -Value $text -Encoding utf8
    }
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
} catch {
  $exitCode = 1
  $output.Add($_.Exception.Message) | Out-Null
  Write-MonitorLog "EXCEPTION $($_.Exception.Message)"
}

$payload = [ordered]@{
  ok = ($exitCode -eq 0)
  source = "production-health-monitor"
  startedAt = $startedAt.ToString("o")
  finishedAt = (Get-Date).ToString("o")
  exitCode = $exitCode
  projectRoot = $ProjectRoot
  log = $log
  tail = @($output.ToArray() | Select-Object -Last 40)
}
Write-Receipt $payload

if ($exitCode -ne 0) {
  Write-MonitorLog "FAILED production health monitor exit=$exitCode"
  exit $exitCode
}

Write-MonitorLog "SUCCESS production health monitor"
exit 0
