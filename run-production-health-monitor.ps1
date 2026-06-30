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
$alertReceipt = Join-Path $receiptDir "production-health-monitor-alert.json"

New-Item -ItemType Directory -Force -Path $logDir, $receiptDir | Out-Null

function Write-MonitorLog($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Write-Receipt($payload) {
  $payload | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receipt -Encoding utf8
}

function Invoke-FailureAlert($payload) {
  $nodeExe = "C:\Program Files\nodejs\node.exe"
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    $nodeExe = "node"
  }
  $tailText = (($payload.tail | Select-Object -Last 24) -join "`n")
  $env:FUMAN_ALERT_KIND = "production-health-monitor"
  $env:FUMAN_ALERT_SOURCE = "FumanTerminalProductionHealthMonitor"
  $env:FUMAN_ALERT_SUBJECT = "Fuman Terminal production monitor failed"
  $env:FUMAN_ALERT_RECEIPT_FILE = $alertReceipt
  $env:FUMAN_ALERT_TEXT = @"
Fuman Terminal production monitor failed

source: FumanTerminalProductionHealthMonitor
projectRoot: $($payload.projectRoot)
exitCode: $($payload.exitCode)
log: $($payload.log)
receipt: $receipt
checkedAt: $((Get-Date).ToString("o"))

tail:
$tailText
"@
  $alertOutput = New-Object System.Collections.Generic.List[string]
  Push-Location $ProjectRoot
  try {
    & $nodeExe "--use-system-ca" "scripts\send-workflow-alert.js" "--kind=production-health-monitor" "--receipt=$alertReceipt" *>&1 | ForEach-Object {
      $text = [string]$_
      $alertOutput.Add($text) | Out-Null
      Add-Content -LiteralPath $log -Value "[alert] $text" -Encoding utf8
    }
    $alertExit = $LASTEXITCODE
  } catch {
    $alertExit = 1
    $alertOutput.Add($_.Exception.Message) | Out-Null
    Add-Content -LiteralPath $log -Value "[alert] EXCEPTION $($_.Exception.Message)" -Encoding utf8
  } finally {
    Pop-Location
  }
  return [ordered]@{
    ok = ($alertExit -eq 0)
    source = "send-workflow-alert.js"
    kind = "production-health-monitor"
    receipt = $alertReceipt
    exitCode = $alertExit
    tail = @($alertOutput.ToArray() | Select-Object -Last 20)
    checkedAt = (Get-Date).ToString("o")
  }
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
  $alert = Invoke-FailureAlert $payload
  $payload.alert = $alert
  $payload.finishedAt = (Get-Date).ToString("o")
  Write-Receipt $payload
  if (-not $alert.ok) {
    Write-MonitorLog "FAILED production health monitor alert exit=$($alert.exitCode) receipt=$($alert.receipt)"
  } else {
    Write-MonitorLog "SENT production health monitor alert receipt=$($alert.receipt)"
  }
  exit $exitCode
}

Write-MonitorLog "SUCCESS production health monitor"
exit 0
