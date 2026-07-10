param(
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$RuntimeRoot = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"

# FUMAN_MARKET_CLOSED_RUNNER_GUARD_V1
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Daytrade Strategy3 closure verify"

function Get-TaipeiStamp() {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  return [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz).ToString("yyyyMMdd-HHmmss")
}

function Write-JsonFile($Path, $Payload) {
  $dir = Split-Path -Parent $Path
  if ($dir) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $Payload | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Write-Log($Message) {
  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $script:LogFile -Value $line -Encoding utf8
}

$stamp = Get-TaipeiStamp
$logDir = Join-Path $RuntimeRoot "logs"
$receiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir | Out-Null

$script:LogFile = Join-Path $logDir ("daytrade-strategy3-closure-verify-{0}.log" -f $stamp)
$receiptFile = Join-Path $receiptDir "daytrade-strategy3-closure-verify-latest.json"
$datedReceiptFile = Join-Path $receiptDir ("daytrade-strategy3-closure-verify-{0}.json" -f $stamp)
$verifier = Join-Path $ProjectRoot "scripts\verify-daytrade-strategy3-closure-live.js"
$startedAt = (Get-Date).ToString("o")
$status = "running"
$exitCode = $null
$errorText = ""
$verifierPayload = $null

if (-not (Test-Path -LiteralPath $verifier)) {
  throw "daytrade Strategy3 closure verifier missing: $verifier"
}

$receipt = [ordered]@{
  ok = $false
  status = $status
  source = "daytrade-strategy3-closure-verify-wrapper"
  startedAt = $startedAt
  finishedAt = ""
  exitCode = $null
  projectRoot = $ProjectRoot
  runtimeRoot = $RuntimeRoot
  verifier = $verifier
  log = $script:LogFile
  pid = $PID
  verifierOk = $null
  verifierIssues = @()
  runId = ""
  scorecardRunId = ""
  error = ""
}
Write-JsonFile $receiptFile $receipt
Write-JsonFile $datedReceiptFile $receipt

try {
  Write-Log "START daytrade Strategy3 closure verify wrapper"
  Write-Log ("verifier: {0}" -f $verifier)
  Write-Log ("project root: {0}" -f $ProjectRoot)

  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    $node = Get-Command node -ErrorAction Stop
  }

  Push-Location $ProjectRoot
  try {
    $rawOutput = & $node.Source "--use-system-ca" $verifier 2>&1
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  } finally {
    Pop-Location
  }

  $rawText = ($rawOutput | Out-String).Trim()
  if ($rawText) {
    Add-Content -LiteralPath $script:LogFile -Value $rawText -Encoding utf8
  }

  try {
    $verifierPayload = $rawText | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "verifier output is not valid JSON: $($_.Exception.Message)"
  }

  if (-not [bool]$verifierPayload.ok) {
    $issues = @($verifierPayload.verification.issues)
    throw ("closure verifier failed: {0}" -f (($issues -join ", ") -replace "^\s*$", "unknown_issue"))
  }

  if ($exitCode -ne 0) {
    throw "closure verifier exited $exitCode even though payload ok=true"
  }

  $status = "ok"
  Write-Log "SUCCESS daytrade Strategy3 closure verify wrapper"
} catch {
  $status = "failed"
  $errorText = $_.Exception.Message
  if ($null -eq $exitCode) {
    $exitCode = 1
  }
  Write-Log ("FAILED daytrade Strategy3 closure verify wrapper: {0}" -f $errorText)
} finally {
  $finishedAt = (Get-Date).ToString("o")
  $issues = @()
  if ($null -ne $verifierPayload -and $null -ne $verifierPayload.verification) {
    $issues = @($verifierPayload.verification.issues)
  }
  $receipt = [ordered]@{
    ok = ($status -eq "ok")
    status = $status
    source = "daytrade-strategy3-closure-verify-wrapper"
    startedAt = $startedAt
    finishedAt = $finishedAt
    exitCode = $exitCode
    projectRoot = $ProjectRoot
    runtimeRoot = $RuntimeRoot
    verifier = $verifier
    log = $script:LogFile
    pid = $PID
    verifierOk = if ($null -eq $verifierPayload) { $null } else { [bool]$verifierPayload.ok }
    verifierIssues = $issues
    runId = if ($null -eq $verifierPayload) { "" } else { [string]$verifierPayload.strategy3Api.runId }
    scorecardRunId = if ($null -eq $verifierPayload) { "" } else { [string]$verifierPayload.scorecard.runId }
    daytradeRunId = if ($null -eq $verifierPayload) { "" } else { [string]$verifierPayload.daytradeSource.runId }
    checkedAt = if ($null -eq $verifierPayload) { "" } else { [string]$verifierPayload.checkedAt }
    summary = if ($null -eq $verifierPayload) { $null } else { $verifierPayload }
    error = $errorText
  }
  Write-JsonFile $receiptFile $receipt
  Write-JsonFile $datedReceiptFile $receipt
}

if ($status -ne "ok") {
  exit ([int]$exitCode)
}
