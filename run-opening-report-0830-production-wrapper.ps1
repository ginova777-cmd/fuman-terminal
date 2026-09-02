$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$RuntimeDir = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $RuntimeDir
$env:FUMAN_DATA_DIR = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $RuntimeDir "data" }
$env:FUMAN_STATE_DIR = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $RuntimeDir "state" }
$env:NODE_OPTIONS = "--use-system-ca"

foreach ($name in @("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_TO")) {
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
$wrapperReceipt = Join-Path $receiptDir "opening-report-0830-wrapper-receipt-$today.json"

function Invoke-NodeStep {
  param([string[]]$Args, [string]$Label)
  $stdout = Join-Path $logDir "opening-report-0830-$today-$stamp.$Label.stdout.log"
  $stderr = Join-Path $logDir "opening-report-0830-$today-$stamp.$Label.stderr.log"
  & "C:\Program Files\nodejs\node.exe" @Args 1> $stdout 2> $stderr
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  return [pscustomobject]@{ label = $Label; exitCode = $exitCode; stdout = $stdout; stderr = $stderr }
}

$run = Invoke-NodeStep -Args @("scripts\run-opening-report-0830-production.js", "--apply-bridge", "--run-id=$runId") -Label "run"
$terminal = Invoke-NodeStep -Args @("scripts\verify-opening-report-0830-terminal-briefing.js") -Label "terminal"
$telegram = if ($run.exitCode -eq 0 -and $terminal.exitCode -eq 0) { Invoke-NodeStep -Args @("scripts\send-opening-report-0830-telegram.js") -Label "telegram" } else { [pscustomobject]@{ label = "telegram"; exitCode = -1; stdout = ""; stderr = "" } }
$closure = if ($telegram.exitCode -eq 0) { Invoke-NodeStep -Args @("scripts\verify-opening-report-0830-telegram-closure.js") -Label "closure" } else { [pscustomobject]@{ label = "closure"; exitCode = -1; stdout = ""; stderr = "" } }
$advisory = Invoke-NodeStep -Args @("scripts\verify-opening-report-0830-production.js") -Label "advisory"

$finalFile = Join-Path $receiptDir "opening-report-0830-final-receipt-$today.json"
$final = if (Test-Path -LiteralPath $finalFile) { Get-Content -LiteralPath $finalFile -Raw | ConvertFrom-Json } else { $null }
$bridgeOk = ($null -ne $final -and $final.mother_pool_bridge_attempted -eq $true -and $final.mother_pool_bridge_ok -eq $true)
$ok = ($run.exitCode -eq 0 -and $terminal.exitCode -eq 0 -and $telegram.exitCode -eq 0 -and $closure.exitCode -eq 0)
$receipt = [ordered]@{
  contract = "opening-report-0830-wrapper-v5-telegram"
  ok = $ok
  reason_code = if ($ok) { "opening_report_0830_telegram_closure_ok" } elseif ($run.exitCode -ne 0) { "opening_report_runner_failed" } elseif ($terminal.exitCode -ne 0) { "terminal_briefing_failed" } elseif ($telegram.exitCode -ne 0) { "telegram_delivery_failed" } else { "telegram_closure_failed" }
  date = $today
  run_id = $runId
  checked_at = (Get-Date).ToString("o")
  channel = "telegram_only"
  formal_candidates = 0
  watchlist_only = $true
  mother_pool_bridge_required = $false
  mother_pool_bridge_ok = $bridgeOk
  line_delivery_allowed = $false
  telegram_delivery_required = $true
  steps = @($run, $terminal, $telegram, $closure, $advisory)
  strategy_execution_allowed = $false
  second_formal_run_allowed = $false
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $wrapperReceipt -Encoding UTF8
if (-not $ok) { exit 1 }
exit 0
