param(
  [string]$ProjectRoot = $PSScriptRoot,
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [switch]$ApplyScanners,
  [switch]$RequireProtectedReadback
)

$ErrorActionPreference = "Stop"
$Contract = "terminal-autonomous-root-runner-v1"
$StartedAt = Get-Date
$Day = $StartedAt.ToString("yyyyMMdd")
$LogDir = Join-Path $RuntimeRoot "logs"
$ReceiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
$LogFile = Join-Path $LogDir "terminal-autonomous-root-$Day.log"
$ReceiptFile = Join-Path $ReceiptDir "terminal-autonomous-root-latest.json"
$AlertReceiptFile = Join-Path $ReceiptDir "terminal-autonomous-root-alert.json"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $ReceiptDir | Out-Null

function Write-RunnerLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "o"), $Message
  Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Invoke-NpmStep {
  param(
    [string]$Name,
    [string]$Script
  )
  Write-RunnerLog "START $Name :: npm run $Script"
  $stepStarted = Get-Date
  & npm run $Script 2>&1 | Tee-Object -FilePath $LogFile -Append
  $exitCode = $LASTEXITCODE
  $stepFinished = Get-Date
  $row = [ordered]@{
    name = $Name
    script = $Script
    exitCode = $exitCode
    startedAt = $stepStarted.ToString("o")
    finishedAt = $stepFinished.ToString("o")
    durationSeconds = [math]::Round(($stepFinished - $stepStarted).TotalSeconds, 3)
  }
  if ($exitCode -ne 0) {
    $rollForwardFile = Join-Path $ProjectRoot "outputs\terminal-roll-forward\terminal-auto-roll-forward.json"
    $idleNoRetry = $false
    if ($Name -eq "job-queue-roll-forward" -and (Test-Path -LiteralPath $rollForwardFile)) {
      try {
        $rollForwardPayload = Get-Content -LiteralPath $rollForwardFile -Raw | ConvertFrom-Json
        $idleNoRetry = ($rollForwardPayload.decision.ok -eq $true -and $rollForwardPayload.decision.state -eq "IDLE_NO_RETRY_NEEDED")
      } catch {
        $idleNoRetry = $false
      }
    }
    if ($idleNoRetry) {
      $row.exitCode = 0
      $row.toleratedExitCode = $exitCode
      $row.toleratedReason = "IDLE_NO_RETRY_NEEDED"
      Write-RunnerLog "PASS $Name toleratedExit=$exitCode reason=IDLE_NO_RETRY_NEEDED"
      return $row
    }
    Write-RunnerLog "FAIL $Name exit=$exitCode"
    throw [System.Exception]::new(("step_failed:{0}:{1}" -f $Name, $exitCode))
  }
  Write-RunnerLog "PASS $Name"
  return $row
}

function Write-Receipt {
  param(
    [bool]$Ok,
    [array]$Steps,
    [string]$FailedStep = "",
    [string]$ErrorMessage = ""
  )
  $finishedAt = Get-Date
  $tail = @()
  if (Test-Path -LiteralPath $LogFile) {
    $tail = Get-Content -LiteralPath $LogFile -Tail 80
  }
  $payload = [ordered]@{
    ok = $Ok
    contract = $Contract
    runId = "terminal-autonomous-root-$($StartedAt.ToString('yyyyMMdd-HHmmss'))"
    startedAt = $StartedAt.ToString("o")
    finishedAt = $finishedAt.ToString("o")
    durationSeconds = [math]::Round(($finishedAt - $StartedAt).TotalSeconds, 3)
    projectRoot = $ProjectRoot
    runtimeRoot = $RuntimeRoot
    applyScanners = [bool]$ApplyScanners
    requireProtectedReadback = [bool]$RequireProtectedReadback
    failedStep = $FailedStep
    errorMessage = $ErrorMessage
    logFile = $LogFile
    steps = $Steps
    logTail = $tail
  }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptFile -Encoding UTF8
  return $payload
}

function Send-FailureAlert {
  param([string]$FailedStep, [string]$ErrorMessage)
  $alertScript = Join-Path $ProjectRoot "scripts\send-workflow-alert.js"
  if (!(Test-Path -LiteralPath $alertScript)) {
    Write-RunnerLog "alert skipped: send-workflow-alert.js missing"
    return
  }
  try {
    $env:FUMAN_ALERT_KIND = "terminal-autonomous-root"
    $env:FUMAN_ALERT_TITLE = "Terminal autonomous root failed"
    $env:FUMAN_ALERT_MESSAGE = "failedStep=$FailedStep error=$ErrorMessage log=$LogFile"
    $env:FUMAN_ALERT_RECEIPT_PATH = $AlertReceiptFile
    & node --use-system-ca $alertScript 2>&1 | Tee-Object -FilePath $LogFile -Append
    Write-RunnerLog "alert command exit=$LASTEXITCODE"
  } catch {
    Write-RunnerLog "alert failed: $($_.Exception.Message)"
  }
}

Set-Location $ProjectRoot
if ($RequireProtectedReadback) {
  $env:FUMAN_REQUIRE_PROTECTED_READBACK = "1"
}

$steps = New-Object System.Collections.Generic.List[object]
try {
  Write-RunnerLog "Autonomous root started contract=$Contract applyScanners=$([bool]$ApplyScanners) requireProtectedReadback=$([bool]$RequireProtectedReadback)"
  $steps.Add((Invoke-NpmStep "predictive-preflight" "ops:predictive-preflight"))
  $steps.Add((Invoke-NpmStep "water-root" "verify:terminal-water-root"))
  $steps.Add((Invoke-NpmStep "daily-manifest" "manifest:daily-terminal-run"))
  $steps.Add((Invoke-NpmStep "state-machine" "orchestrator:state:from-existing"))
  $steps.Add((Invoke-NpmStep "autonomous-policy" "policy:autonomous-ops"))
  if ($ApplyScanners) {
    $steps.Add((Invoke-NpmStep "job-queue-roll-forward" "rollforward:terminal:apply-scanners"))
  } else {
    $steps.Add((Invoke-NpmStep "job-queue-roll-forward" "rollforward:terminal:apply"))
  }
  $steps.Add((Invoke-NpmStep "unattended-root-readback" "verify:terminal-unattended-root"))
  $receipt = Write-Receipt -Ok $true -Steps $steps.ToArray()
  Write-RunnerLog "Autonomous root complete receipt=$ReceiptFile"
  exit 0
} catch {
  $message = $_.Exception.Message
  $failedStep = if ($message -match "step_failed:([^:]+):") { $Matches[1] } else { "unknown" }
  $receipt = Write-Receipt -Ok $false -Steps $steps.ToArray() -FailedStep $failedStep -ErrorMessage $message
  Send-FailureAlert -FailedStep $failedStep -ErrorMessage $message
  Write-RunnerLog "Autonomous root failed failedStep=$failedStep error=$message receipt=$ReceiptFile"
  exit 1
}



