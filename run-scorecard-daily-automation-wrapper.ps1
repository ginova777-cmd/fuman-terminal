param(
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$RuntimeRoot = "C:\fuman-runtime",
  [string]$ExpectedDate = "",
  [switch]$AllowPreviousTradeDate,
  [switch]$NoLiveVerify
)

$ErrorActionPreference = "Stop"

function Get-TaipeiStamp() {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  return [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz).ToString("yyyyMMdd-HHmmss")
}

function Write-JsonFile($Path, $Payload) {
  $dir = Split-Path -Parent $Path
  if ($dir) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $Payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Write-Log($Message) {
  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $script:LogFile -Value $line -Encoding utf8
}

$stamp = Get-TaipeiStamp
$logDir = Join-Path $RuntimeRoot "logs"
$receiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
$lockDir = Join-Path $RuntimeRoot "locks"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir, $lockDir | Out-Null

$script:LogFile = Join-Path $logDir ("scorecard-daily-automation-{0}.log" -f $stamp)
$receiptFile = Join-Path $receiptDir "scorecard-daily-automation-latest.json"
$datedReceiptFile = Join-Path $receiptDir ("scorecard-daily-automation-{0}.json" -f $stamp)
$lockFile = Join-Path $lockDir "scorecard-daily-automation.lock.json"
$coreRunner = Join-Path $ProjectRoot "run-scorecard-daily-automation.ps1"
$startedAt = (Get-Date).ToString("o")
$exitCode = $null
$status = "running"
$errorText = ""
$effectiveAllowPreviousTradeDate = $AllowPreviousTradeDate -or [string]::IsNullOrWhiteSpace($ExpectedDate)

if (-not (Test-Path -LiteralPath $coreRunner)) {
  throw "scorecard core runner missing: $coreRunner"
}

$receipt = [ordered]@{
  ok = $false
  status = $status
  source = "scorecard-daily-automation-wrapper"
  startedAt = $startedAt
  finishedAt = ""
  exitCode = $null
  projectRoot = $ProjectRoot
  runtimeRoot = $RuntimeRoot
  expectedDate = $ExpectedDate
  allowPreviousTradeDate = [bool]$AllowPreviousTradeDate
  effectiveAllowPreviousTradeDate = [bool]$effectiveAllowPreviousTradeDate
  noLiveVerify = [bool]$NoLiveVerify
  coreRunner = $coreRunner
  log = $script:LogFile
  pid = $PID
  error = ""
}
Write-JsonFile $receiptFile $receipt
Write-JsonFile $datedReceiptFile $receipt

$incidentGuard = Join-Path $ProjectRoot "scripts\supabase-incident-guard.js"
if (Test-Path -LiteralPath $incidentGuard) {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    $node = Get-Command node -ErrorAction Stop
  }
  & $node.Source $incidentGuard check "--class=scorecard" "--action=scorecard-daily-automation"
  if ($LASTEXITCODE -ne 0) {
    $receipt.status = "blocked"
    $receipt.finishedAt = (Get-Date).ToString("o")
    $receipt.exitCode = $LASTEXITCODE
    $receipt.error = "supabase_rest_pool_incident_active"
    Write-JsonFile $receiptFile $receipt
    Write-JsonFile $datedReceiptFile $receipt
    exit $LASTEXITCODE
  }
}

try {
  Write-JsonFile $lockFile ([ordered]@{
    status = "running"
    startedAt = $startedAt
    pid = $PID
    log = $script:LogFile
    receipt = $receiptFile
  })

  Write-Log "START scorecard daily automation wrapper"
  Write-Log ("core runner: {0}" -f $coreRunner)

  $runnerArgs = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $coreRunner,
    "-ProjectRoot",
    $ProjectRoot,
    "-RuntimeRoot",
    $RuntimeRoot
  )
  if ($ExpectedDate) {
    $runnerArgs += @("-ExpectedDate", $ExpectedDate)
  }
  if ($effectiveAllowPreviousTradeDate) {
    $runnerArgs += "-AllowPreviousTradeDate"
  }
  if ($NoLiveVerify) {
    $runnerArgs += "-NoLiveVerify"
  }

  $previousRunningTask = $env:FUMAN_SCORECARD_RUNNING_TASK
  $env:FUMAN_SCORECARD_RUNNING_TASK = "1"
  try {
    & powershell.exe @runnerArgs 2>&1 | Tee-Object -FilePath $script:LogFile -Append
  } finally {
    if ($null -eq $previousRunningTask) {
      Remove-Item Env:\FUMAN_SCORECARD_RUNNING_TASK -ErrorAction SilentlyContinue
    } else {
      $env:FUMAN_SCORECARD_RUNNING_TASK = $previousRunningTask
    }
  }
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  if ($exitCode -ne 0) {
    throw "core runner failed with exit code $exitCode"
  }
  $status = "ok"
  Write-Log "SUCCESS scorecard daily automation wrapper"
} catch {
  $status = "failed"
  $errorText = $_.Exception.Message
  if ($null -eq $exitCode) {
    $exitCode = 1
  }
  Write-Log ("FAILED scorecard daily automation wrapper: {0}" -f $errorText)
} finally {
  Remove-Item -LiteralPath $lockFile -ErrorAction SilentlyContinue
  $finishedAt = (Get-Date).ToString("o")
  $receipt = [ordered]@{
    ok = ($status -eq "ok")
    status = $status
    source = "scorecard-daily-automation-wrapper"
    startedAt = $startedAt
    finishedAt = $finishedAt
    exitCode = $exitCode
    projectRoot = $ProjectRoot
    runtimeRoot = $RuntimeRoot
    expectedDate = $ExpectedDate
    allowPreviousTradeDate = [bool]$AllowPreviousTradeDate
    effectiveAllowPreviousTradeDate = [bool]$effectiveAllowPreviousTradeDate
    noLiveVerify = [bool]$NoLiveVerify
    coreRunner = $coreRunner
    log = $script:LogFile
    pid = $PID
    error = $errorText
  }
  Write-JsonFile $receiptFile $receipt
  Write-JsonFile $datedReceiptFile $receipt
}

if ($status -ne "ok") {
  exit ([int]$exitCode)
}
