$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$RuntimeDir = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $RuntimeDir
$env:FUMAN_DATA_DIR = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $RuntimeDir "data" }
$env:FUMAN_STATE_DIR = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $RuntimeDir "state" }
$env:NODE_OPTIONS = "--use-system-ca"

foreach ($name in @("FUMAN_LINE_CHANNEL_ACCESS_TOKEN", "FUMAN_LINE_TO", "FUMAN_LINE_TO_USER", "FUMAN_LINE_USER_ID", "FUMAN_LINE_TO_GROUP", "FUMAN_LINE_GROUP_ID", "FUMAN_LINE_TO_ROOM", "FUMAN_LINE_ROOM_ID", "LINE_CHANNEL_ACCESS_TOKEN", "LINE_TO", "LINE_TARGET_ID", "LINE_USER_ID", "LINE_GROUP_ID")) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    if ($value) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
  }
}

$logDir = Join-Path $RuntimeDir "logs"
$receiptDir = Join-Path $RuntimeDir "data\opening-report-0830"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir | Out-Null

$today = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Taipei Standard Time").ToString("yyyyMMdd")
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runId = "opening-report-0830-$today-$stamp"
$stdout = Join-Path $logDir "opening-report-0830-$today-$stamp.stdout.log"
$stderr = Join-Path $logDir "opening-report-0830-$today-$stamp.stderr.log"
$wrapperReceipt = Join-Path $receiptDir "opening-report-0830-wrapper-receipt-$today.json"

function Invoke-NodeStep {
  param([string[]]$Args, [string]$StdoutPath, [string]$StderrPath)
  & "C:\Program Files\nodejs\node.exe" @Args 1> $StdoutPath 2> $StderrPath
  if ($null -eq $LASTEXITCODE) { return 0 }
  return [int]$LASTEXITCODE
}

$runExit = Invoke-NodeStep -Args @("scripts\run-opening-report-0830-production.js", "--send-line", "--run-id=$runId") -StdoutPath $stdout -StderrPath $stderr

$terminalStdout = Join-Path $logDir "opening-report-0830-$today-$stamp.terminal.stdout.log"
$terminalStderr = Join-Path $logDir "opening-report-0830-$today-$stamp.terminal.stderr.log"
$terminalExit = Invoke-NodeStep -Args @("scripts\verify-opening-report-0830-terminal-briefing.js") -StdoutPath $terminalStdout -StderrPath $terminalStderr

$deliveryStdout = Join-Path $logDir "opening-report-0830-$today-$stamp.delivery.stdout.log"
$deliveryStderr = Join-Path $logDir "opening-report-0830-$today-$stamp.delivery.stderr.log"
$deliveryExit = Invoke-NodeStep -Args @("scripts\verify-opening-report-0830-delivery-chain.js") -StdoutPath $deliveryStdout -StderrPath $deliveryStderr

$verifyStdout = Join-Path $logDir "opening-report-0830-$today-$stamp.verify.stdout.log"
$verifyStderr = Join-Path $logDir "opening-report-0830-$today-$stamp.verify.stderr.log"
$verifyExit = Invoke-NodeStep -Args @("scripts\verify-opening-report-0830-production.js", "--require-line") -StdoutPath $verifyStdout -StderrPath $verifyStderr

$bridgeStdout = Join-Path $logDir "opening-report-0830-$today-$stamp.bridge.stdout.log"
$bridgeStderr = Join-Path $logDir "opening-report-0830-$today-$stamp.bridge.stderr.log"
$bridgeExit = $null
if ($runExit -eq 0 -and $deliveryExit -eq 0) {
  & "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "run-opening-report-0830-bridge-handoff.ps1") 1> $bridgeStdout 2> $bridgeStderr
  if ($null -eq $LASTEXITCODE) { $bridgeExit = 0 } else { $bridgeExit = [int]$LASTEXITCODE }
} else {
  $bridgeExit = -1
}

$ok = ($runExit -eq 0 -and $terminalExit -eq 0 -and $deliveryExit -eq 0)
$receipt = [ordered]@{
  contract = "opening-report-0830-wrapper-v4"
  ok = $ok
  reason_code = if ($ok) { "opening_report_0830_delivery_chain_ok" } elseif ($runExit -ne 0) { "opening_report_runner_exit_$runExit" } elseif ($terminalExit -ne 0) { "opening_report_terminal_briefing_exit_$terminalExit" } else { "opening_report_delivery_chain_exit_$deliveryExit" }
  date = $today
  run_id = $runId
  checked_at = (Get-Date).ToString("o")
  stdout = $stdout
  stderr = $stderr
  terminal_stdout = $terminalStdout
  terminal_stderr = $terminalStderr
  delivery_stdout = $deliveryStdout
  delivery_stderr = $deliveryStderr
  verify_stdout = $verifyStdout
  verify_stderr = $verifyStderr
  send_line = $true
  require_line = $true
  success_gate = "delivery_chain"
  production_verifier_advisory = $true
  production_verifier_does_not_affect_ok = $true
  apply_bridge_optional = $true
  bridge_handoff_attempted = ($bridgeExit -ne -1)
  bridge_handoff_required = $false
  bridge_handoff_does_not_affect_ok = $true
  bridge_handoff_stdout = $bridgeStdout
  bridge_handoff_stderr = $bridgeStderr
  bridge_handoff_exit_code = $bridgeExit
  run_exit_code = $runExit
  terminal_exit_code = $terminalExit
  delivery_exit_code = $deliveryExit
  verify_exit_code = $verifyExit
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8
if (-not $ok) { exit 1 }
