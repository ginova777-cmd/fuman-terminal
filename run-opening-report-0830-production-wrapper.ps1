$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$RuntimeDir = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $RuntimeDir
$env:FUMAN_DATA_DIR = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $RuntimeDir "data" }
$env:FUMAN_STATE_DIR = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $RuntimeDir "state" }
$env:NODE_OPTIONS = "--use-system-ca"

$logDir = Join-Path $RuntimeDir "logs"
$receiptDir = Join-Path $RuntimeDir "data\opening-report-0830"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir | Out-Null
$today = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Taipei Standard Time").ToString("yyyyMMdd")
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runId = "opening-report-0830-$today-$stamp"
$wrapperReceipt = Join-Path $receiptDir "opening-report-0830-wrapper-receipt-$today.json"

function Invoke-NodeStep {
  param([string[]]$NodeArgs, [string]$Label)
  $stdout = Join-Path $logDir "opening-report-0830-$today-$stamp.$Label.stdout.log"
  $stderr = Join-Path $logDir "opening-report-0830-$today-$stamp.$Label.stderr.log"
  & "C:\Program Files\nodejs\node.exe" @NodeArgs 1> $stdout 2> $stderr
  $exitCode = if ($null -eq $LASTEXITCODE) { 9009 } else { [int]$LASTEXITCODE }
  [pscustomobject]@{ label = $Label; exitCode = $exitCode; stdout = $stdout; stderr = $stderr }
}

# Stale Asia leaders are source gaps. Only future/cross-date inputs block delivery.
$preDelivery = Invoke-NodeStep -NodeArgs @("scripts\verify-opening-report-0830-contract.js", "--pre-delivery") -Label "pre-delivery-contract"
if ($preDelivery.exitCode -ne 0) {
  [ordered]@{
    contract = "opening-report-0830-wrapper-v9-partial-source-gap"
    ok = $false
    status = "FAIL_CLOSED"
    reason_code = "opening_report_pre_delivery_contract_failed"
    date = $today
    run_id = $runId
    checked_at = (Get-Date).ToString("o")
    terminal_delivery_allowed = $false
    telegram_delivery_allowed = $false
    mother_pool_bridge_allowed = $false
    bridge_handoff_required = $true
    bridge_completed_inside_delivery_chain = $false
    bridge_deferred_outside_delivery_chain = $false
    steps = @($preDelivery)
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8
  exit 1
}

$run = Invoke-NodeStep -NodeArgs @("scripts\run-opening-report-0830-production.js", "--run-id=$runId") -Label "run"
$contract = if ($run.exitCode -eq 0) {
  Invoke-NodeStep -NodeArgs @("scripts\verify-opening-report-0830-contract.js", "--require-current") -Label "closure-contract"
} else {
  [pscustomobject]@{ label = "closure-contract"; exitCode = -1; stdout = ""; stderr = ""; skipped = "run_failed" }
}
$terminal = if ($contract.exitCode -eq 0) {
  Invoke-NodeStep -NodeArgs @("scripts\verify-opening-report-0830-terminal-briefing.js", "--require-current") -Label "terminal"
} else {
  [pscustomobject]@{ label = "terminal"; exitCode = -1; stdout = ""; stderr = ""; skipped = "run_or_contract_failed" }
}

# Telegram is optional. A quota failure must not erase a valid terminal snapshot.
$telegramEnabled = $env:FUMAN_OPENING_REPORT_TELEGRAM -eq "1"
$telegram = if ($telegramEnabled -and $terminal.exitCode -eq 0) {
  Invoke-NodeStep -NodeArgs @("scripts\send-opening-report-0830-telegram.js") -Label "telegram"
} else {
  [pscustomobject]@{ label = "telegram"; exitCode = 0; skipped = "telegram_optional"; stdout = ""; stderr = "" }
}

$finalPath = Join-Path $receiptDir "opening-report-0830-final-receipt-$today.json"
$final = if (Test-Path -LiteralPath $finalPath) { Get-Content -LiteralPath $finalPath -Raw | ConvertFrom-Json } else { $null }
$ok = $run.exitCode -eq 0 -and $contract.exitCode -eq 0 -and $terminal.exitCode -eq 0
[ordered]@{
  contract = "opening-report-0830-wrapper-v9-partial-source-gap"
  ok = $ok
  status = if ($ok) { "PASS" } else { "FAIL_CLOSED" }
  reason_code = if ($ok) { "opening_report_terminal_snapshot_closed" } else { "opening_report_delivery_step_failed" }
  date = $today
  run_id = $runId
  content_hash = if ($final) { $final.delivery_content_hash } else { "" }
  checked_at = (Get-Date).ToString("o")
  terminal_delivery_allowed = $ok
  telegram_delivery_allowed = $telegramEnabled -and $terminal.exitCode -eq 0
  telegram_required = $false
  formal_candidates = 0
  watchlist_only = $true
  mother_pool_bridge_allowed = $true
  bridge_handoff_required = $true
  bridge_completed_inside_delivery_chain = $true
  bridge_deferred_outside_delivery_chain = $false
  second_formal_run_allowed = $false
  steps = @($preDelivery, $run, $contract, $terminal, $telegram)
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8

if (-not $ok) { exit 1 }