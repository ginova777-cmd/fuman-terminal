param([switch]$IsolatedBacktest)

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
$nowTaipei = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Taipei Standard Time")
$today = $nowTaipei.ToString("yyyyMMdd")
$tradeDate = $nowTaipei.ToString("yyyy-MM-dd")
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runId = "opening-report-0830-$today-$stamp"
$wrapperReceipt = Join-Path $receiptDir "opening-report-0830-wrapper-receipt-$today.json"

# Every formal entry point owns its market-calendar guard. Do not rely on the
# 08:20 preflight to protect the 08:30 runner, because Task Scheduler launches
# them independently.
if (-not $IsolatedBacktest) {
  $calendarOutput = & "C:\Program Files\nodejs\node.exe" "scripts\check-market-calendar-action.js" "--date=$tradeDate" "--label=Opening-report-0830-wrapper" 2>&1
  $calendarExit = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  $calendar = $null
  try { $calendar = (($calendarOutput | Out-String).Trim() | ConvertFrom-Json) } catch { $calendar = $null }
  if ($calendarExit -eq 10 -or ($null -ne $calendar -and $calendar.marketOpen -eq $false)) {
    [ordered]@{
      contract = "opening-report-morning-wrapper-v1"
      status = "skipped"
      ok = $true
      complete = $false
      reason_code = "market_calendar_non_trading_day"
      mode = "production"
      date = $today
      trade_date = $tradeDate
      run_id = $runId
      checked_at = (Get-Date).ToString("o")
      market_status = if ($null -ne $calendar) { [string]$calendar.marketStatus } else { "closed" }
      closed_reason = if ($null -ne $calendar) { [string]$calendar.closedReason } else { "market_closed" }
      formal_scan_skipped = $true
      latest_pointer_updated = $false
      line_push_attempted = $false
      terminal_snapshot_attempted = $false
      mother_pool_bridge_attempted = $false
      no_side_effects = $true
      steps = @()
      canonical_verifier = "scripts/verify-opening-report-morning-contract.js"
      telegram_enabled = $false
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8
    exit 0
  }
  if ($calendarExit -ne 0 -or $null -eq $calendar) {
    [ordered]@{
      contract = "opening-report-morning-wrapper-v1"
      status = "fail_closed"
      ok = $false
      complete = $false
      reason_code = "market_calendar_guard_failed"
      mode = "production"
      date = $today
      trade_date = $tradeDate
      run_id = $runId
      checked_at = (Get-Date).ToString("o")
      formal_scan_skipped = $true
      latest_pointer_updated = $false
      line_push_attempted = $false
      terminal_snapshot_attempted = $false
      mother_pool_bridge_attempted = $false
      no_side_effects = $true
      calendar_exit_code = $calendarExit
      steps = @()
      canonical_verifier = "scripts/verify-opening-report-morning-contract.js"
      telegram_enabled = $false
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8
    exit 1
  }
}

function Invoke-NodeStep {
  param([string[]]$NodeArgs, [string]$Label)
  $stdout = Join-Path $logDir "opening-report-0830-$today-$stamp.$Label.stdout.log"
  $stderr = Join-Path $logDir "opening-report-0830-$today-$stamp.$Label.stderr.log"
  & "C:\Program Files\nodejs\node.exe" @NodeArgs 1> $stdout 2> $stderr
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  return [pscustomobject]@{ label = $Label; exitCode = $exitCode; stdout = $stdout; stderr = $stderr }
}

# Formal contract: runner -> one canonical verifier -> wrapper receipt.
# LINE personal/group, terminal output, and Mother Pool bridge remain runner-owned.
$runnerArgs = @("scripts\run-opening-report-0830-production.js", "--apply-bridge", "--date=$tradeDate", "--run-id=$runId")
if ($IsolatedBacktest) { $runnerArgs += "--isolated-backtest" }
$run = Invoke-NodeStep -NodeArgs $runnerArgs -Label "runner"
$verifierArgs = @("scripts\verify-opening-report-morning-contract.js", "--trade-date=$tradeDate")
if (-not $IsolatedBacktest) { $verifierArgs += "--require-current" }
$verifier = if ($run.exitCode -eq 0) { Invoke-NodeStep -NodeArgs $verifierArgs -Label "canonical-verifier" } else { [pscustomobject]@{ label = "canonical-verifier"; exitCode = -1; stdout = ""; stderr = "" } }

$finalFile = Join-Path $receiptDir "opening-report-0830-final-receipt-$today.json"
$final = if (Test-Path -LiteralPath $finalFile) { Get-Content -LiteralPath $finalFile -Raw | ConvertFrom-Json } else { $null }
$lineFile = Join-Path $receiptDir "line-push-receipt-$today.json"
$line = if (Test-Path -LiteralPath $lineFile) { Get-Content -LiteralPath $lineFile -Raw | ConvertFrom-Json } else { $null }
$runnerOk = ($run.exitCode -eq 0 -and $null -ne $final -and $final.ok -eq $true)
$verifierOk = ($verifier.exitCode -eq 0)
$linePersonalOk = ($null -ne $line -and $line.line_push_ok -eq $true -and $line.has_user_target -eq $true)
$lineGroupOk = ($null -ne $line -and $line.line_push_ok -eq $true -and $line.has_group_target -eq $true)
$terminalOk = ($null -ne $final -and $final.terminal_briefing_snapshot.ok -eq $true)
$bridgeOk = ($null -ne $final -and $final.mother_pool_bridge_attempted -eq $true -and $final.mother_pool_bridge_ok -eq $true)
$expected = if ($null -ne $final -and $null -ne $final.expected_industry_count) { [int]$final.expected_industry_count } else { 0 }
$scanned = if ($null -ne $final -and $null -ne $final.scanned_industry_count) { [int]$final.scanned_industry_count } else { 0 }
$ok = ($runnerOk -and $verifierOk -and $linePersonalOk -and $lineGroupOk -and $terminalOk -and $bridgeOk -and $expected -eq 15 -and $scanned -eq 15)
$reasonCode = if ($ok) { "complete" } elseif (-not $runnerOk) { "runner_failed" } elseif (-not $verifierOk) { "canonical_verifier_failed" } elseif (-not ($linePersonalOk -and $lineGroupOk)) { "line_delivery_incomplete" } elseif (-not $terminalOk) { "terminal_delivery_incomplete" } elseif (-not $bridgeOk) { "mother_pool_bridge_incomplete" } else { "industry_scan_incomplete" }

$receipt = [ordered]@{
  contract = "opening-report-morning-wrapper-v1"
  status = if ($ok) { "complete" } else { "failed" }
  ok = $ok
  reason_code = $reasonCode
  mode = if ($IsolatedBacktest) { "isolated_backtest" } else { "production" }
  date = $today
  trade_date = $tradeDate
  run_id = $runId
  checked_at = (Get-Date).ToString("o")
  expected_industry_count = $expected
  scanned_industry_count = $scanned
  line_personal_ok = $linePersonalOk
  line_group_ok = $lineGroupOk
  terminal_ok = $terminalOk
  mother_pool_bridge_ok = $bridgeOk
  runner_ok = $runnerOk
  canonical_verifier_ok = $verifierOk
  steps = @($run, $verifier)
  canonical_verifier = "scripts/verify-opening-report-morning-contract.js"
  telegram_enabled = $false
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8
if (-not $ok) { exit 1 }
exit 0
