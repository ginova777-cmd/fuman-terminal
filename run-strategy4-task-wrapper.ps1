param(
  [int]$MaxMinutes = 25
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$runtime = "C:\fuman-runtime"
$receiptDir = Join-Path $runtime "data\scan-receipts"
$logDir = Join-Path $runtime "logs"
$runner = Join-Path $root "run-strategy4.ps1"
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
$startedAt = (Get-Date).ToString("o")
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$log = Join-Path $logDir "strategy4-task-wrapper-$stamp.log"
New-Item -ItemType Directory -Force -Path $receiptDir, $logDir | Out-Null

function Write-WrapperLog([string]$Message) {
  "[$((Get-Date).ToString('o'))] $Message" | Tee-Object -FilePath $log -Append | Out-Null
}
function Write-Strategy4TaskReceipt([string]$Status, [int]$ExitCode, [string]$Reason, [string[]]$Warnings = @()) {
  $payload = [ordered]@{
    strategy = "strategy4"; label = "strategy4 full scan"; tier = "critical"
    startedAt = $startedAt; finishedAt = (Get-Date).ToString("o")
    status = $Status; complete = $false; exitCode = $ExitCode; runId = ""; matches = 0
    fallback = $false; preservedLatest = $true; publishBlocked = $true
    qualityStatus = $(if ($Status -eq "running") { "verifying" } else { "failed" })
    unattendedStatus = $(if ($Status -eq "running") { "RUNNING" } else { "NO" })
    marketDate = (Get-Date).ToString("yyyyMMdd"); payloadPath = ""
    warnings = @($Warnings); blockingReason = $Reason; log = $log
    taskWrapper = "strategy4-task-wrapper-v1"
  }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptDir "strategy4.json") -Encoding utf8
}

if (-not (Test-Path -LiteralPath $runner)) { throw "missing Strategy4 runner: $runner" }
Write-WrapperLog "Strategy4 task wrapper start maxMinutes=$MaxMinutes"
Write-Strategy4TaskReceipt "running" 0 "strategy4_runner_started_by_task_wrapper"
$child = Start-Process -FilePath $pwsh -ArgumentList @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "`"$runner`"") -WorkingDirectory $root -PassThru
try {
  $finished = $child.WaitForExit([Math]::Max(1, $MaxMinutes) * 60 * 1000)
  if (-not $finished) {
    Write-WrapperLog "Strategy4 runner timeout pid=$($child.Id) minutes=$MaxMinutes"
    Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue
    Write-Strategy4TaskReceipt "failed" 124 "strategy4_runner_timeout_without_completion" @("runner pid=$($child.Id)", "timeoutMinutes=$MaxMinutes")
    exit 124
  }
  $exitCode = [int]$child.ExitCode
  Write-WrapperLog "Strategy4 runner exited code=$exitCode"
  $receiptPath = Join-Path $receiptDir "strategy4.json"
  $receipt = if (Test-Path -LiteralPath $receiptPath) { Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json } else { $null }
  $today = (Get-Date).ToString("yyyyMMdd")
  $receiptDate = if ($receipt -and $receipt.runId) { ([regex]::Match([string]$receipt.runId, "20\d{6}")).Value } else { "" }
  if ($exitCode -ne 0 -or $null -eq $receipt -or $receipt.status -ne "complete" -or $receipt.complete -ne $true -or $receiptDate -ne $today) {
    $reason = "strategy4_runner_noncomplete_exit=$exitCode;receiptStatus=$($receipt.status);receiptDate=$receiptDate;expectedDate=$today"
    Write-WrapperLog $reason
    if ($null -eq $receipt -or $receipt.status -eq "running") { Write-Strategy4TaskReceipt "failed" $(if($exitCode -ne 0){$exitCode}else{1}) $reason }
    exit $(if($exitCode -ne 0){$exitCode}else{1})
  }
  exit 0
} catch {
  $reason = "strategy4_task_wrapper_exception: $($_.Exception.Message)"
  Write-WrapperLog $reason
  Write-Strategy4TaskReceipt "failed" 1 $reason
  exit 1
}