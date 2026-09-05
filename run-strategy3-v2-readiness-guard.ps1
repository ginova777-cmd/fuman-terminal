param(
  [ValidateSet("1230", "1250")]
  [string]$Phase = "1230"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location -LiteralPath $PSScriptRoot
$runtimeDir = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtimeDir
$env:NODE_OPTIONS = "--use-system-ca"
$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node.exe" }

. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label ("Strategy3 V2 readiness guard {0}" -f $Phase)

$compactDate = Get-Date -Format yyyyMMdd
$receiptDir = Join-Path $runtimeDir "data\scan-receipts"
$logDir = Join-Path $runtimeDir "logs"
New-Item -ItemType Directory -Force -Path $receiptDir, $logDir | Out-Null
$receiptPath = Join-Path $receiptDir ("strategy3-v2-readiness-guard-{0}-{1}.json" -f $Phase, $compactDate)
$logPath = Join-Path $logDir ("strategy3-v2-readiness-guard-{0}-{1}.log" -f $Phase, (Get-Date -Format yyyyMMdd-HHmmss))
$startedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")

try {
  $output = & $nodeExe "--use-system-ca" "scripts\check-strategy3-v2-readiness.js" ("--trade-date={0}" -f (Get-Date -Format yyyy-MM-dd)) 2>&1
  $exitCode = $LASTEXITCODE
  $output | Set-Content -LiteralPath $logPath -Encoding utf8
  $readiness = $null
  $jsonText = ($output | Out-String).Trim()
  $start = $jsonText.IndexOf("{")
  $end = $jsonText.LastIndexOf("}")
  if ($start -ge 0 -and $end -gt $start) {
    try { $readiness = $jsonText.Substring($start, $end - $start + 1) | ConvertFrom-Json } catch { $readiness = $null }
  }
  $result = [ordered]@{
    contract = "strategy3-v2-readiness-guard-wrapper-v1"
    ok = ($exitCode -eq 0 -and $readiness.ok -eq $true)
    status = if ($exitCode -eq 0 -and $readiness.ok -eq $true) { "STRATEGY3_V2_READINESS_READY" } else { "STRATEGY3_V2_READINESS_FAIL_CLOSED" }
    trade_date = Get-Date -Format yyyy-MM-dd
    checked_at = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
    started_at = $startedAt
    phase = $Phase
    scanner_can_run = ($exitCode -eq 0 -and $readiness.ok -eq $true)
    formal_allowed = $false
    publish_allowed = $false
    line_push_allowed = $false
    legacy_strategy3_touched = $false
    readiness_exit_code = $exitCode
    readiness_status = [string]$readiness.status
    reason_code = if ($exitCode -eq 0 -and $readiness.ok -eq $true) { "strategy3_v2_readiness_ready" } else { [string]$readiness.reason_code }
    first_blocker = if ($exitCode -eq 0 -and $readiness.ok -eq $true) { $null } else { [string]$readiness.issues[0].code }
    readiness = $readiness
    log = $logPath
  }
} catch {
  $result = [ordered]@{
    contract = "strategy3-v2-readiness-guard-wrapper-v1"
    ok = $false
    status = "STRATEGY3_V2_READINESS_GUARD_EXCEPTION"
    trade_date = Get-Date -Format yyyy-MM-dd
    checked_at = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
    started_at = $startedAt
    phase = $Phase
    scanner_can_run = $false
    formal_allowed = $false
    publish_allowed = $false
    line_push_allowed = $false
    legacy_strategy3_touched = $false
    reason_code = "strategy3_v2_readiness_guard_exception"
    first_blocker = "strategy3_v2_readiness_guard_exception"
    error = $_.Exception.Message
    log = $logPath
  }
}

$result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receiptPath -Encoding utf8
$result | ConvertTo-Json -Depth 12
exit 0
