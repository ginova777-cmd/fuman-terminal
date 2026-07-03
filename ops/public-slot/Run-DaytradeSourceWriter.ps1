param(
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$Apply,
  [switch]$Fetch,
  [switch]$Once,
  [switch]$LocalCheck
)

# Run-DaytradeSourceWriter.ps1 is a release-owner wrapper.
# Default mode is dry-run/no-fetch/once. Use -Apply only in an approved writer window.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$WriterScript = Join-Path $RepoRoot "scripts\run-daytrade-source-writer.js"
$LogDir = Join-Path $RuntimeDir "logs"
$StateDir = Join-Path $RuntimeDir "state"
$TradeDate = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, "Taipei Standard Time").ToString("yyyy-MM-dd")
$Stamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMddHHmmss")
$RunId = "fugle_daytrade_source-writer-$Stamp-$PID"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$StdoutLog = Join-Path $LogDir "daytrade-source-writer-$($TradeDate.Replace('-',''))-$Stamp.stdout.log"
$StderrLog = Join-Path $LogDir "daytrade-source-writer-$($TradeDate.Replace('-',''))-$Stamp.stderr.log"
$WrapperLog = Join-Path $LogDir "daytrade-source-writer-$($TradeDate.Replace('-','')).wrapper.log"
$MutexName = "Global\FumanFugleDaytradeSourceWriter"
$Mutex = New-Object System.Threading.Mutex($false, $MutexName)
$MutexAcquired = $false

function Write-WrapperLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $WrapperLog -Value $line -Encoding utf8
}

function Write-FailureArtifact {
  param([int]$ExitCode, [string]$Reason)
  $artifact = [ordered]@{
    ok = $false
    source_name = "fugle_daytrade_source"
    checked_at = [DateTimeOffset]::UtcNow.ToString("o")
    trade_date = $TradeDate
    run_id = $RunId
    gate_grade = "D"
    daytrade_gate_grade = "D"
    status = "runtime_failure"
    message = $Reason
    formal_entry_allowed = $false
    latest_update_allowed = $false
    preserve_previous_good = $true
    no_empty_latest = $true
    no_latest_pointer_update = $true
    stop_new_signals = $true
    failed_checks = @($Reason)
    stdout_log = $StdoutLog
    stderr_log = $StderrLog
    wrapper_log = $WrapperLog
    exit_code = $ExitCode
  }
  $artifact | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $StateDir "daytrade-source-writer.failure.json") -Encoding utf8
}

if (-not (Test-Path -LiteralPath $WriterScript)) {
  Write-FailureArtifact 9002 "writer_script_missing"
  throw "Missing writer script: $WriterScript"
}

$env:FUMAN_RUNTIME_DIR = $RuntimeDir

$node = "node"
$args = @("--use-system-ca", $WriterScript)

if ($LocalCheck) {
  $args += "--local-check"
} elseif ($Apply) {
  $args += "--apply"
  if ($Once) { $args += "--once" }
} else {
  $args += "--dry-run"
  $args += "--no-fetch"
  $args += "--once"
}

if ($Fetch -and -not $Apply) {
  $args = @("--use-system-ca", $WriterScript, "--dry-run", "--fetch")
  if ($Once) { $args += "--once" }
}

Write-WrapperLog "START run_id=$RunId apply=$Apply fetch=$Fetch once=$Once localCheck=$LocalCheck"
try {
  $MutexAcquired = $Mutex.WaitOne(0)
  if (-not $MutexAcquired) {
    Write-WrapperLog "SKIP already_running stdout=$StdoutLog stderr=$StderrLog"
    [ordered]@{
      ok = $true
      skipped = $true
      reason = "writer_already_running"
      source_name = "fugle_daytrade_source"
      checked_at = [DateTimeOffset]::UtcNow.ToString("o")
      trade_date = $TradeDate
      run_id = $RunId
      preserve_previous_good = $true
    } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $StdoutLog -Encoding utf8
    exit 0
  }

  & $node @args 1> $StdoutLog 2> $StderrLog
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    Write-FailureArtifact $exitCode "writer_exit_$exitCode"
    Write-WrapperLog "FAIL writer_exit_$exitCode stdout=$StdoutLog stderr=$StderrLog"
    exit $exitCode
  }
  Write-WrapperLog "DONE ok stdout=$StdoutLog stderr=$StderrLog"
  exit 0
} catch {
  $message = $_.Exception.Message
  Write-FailureArtifact 9003 "writer_wrapper_exception"
  Write-WrapperLog "FAIL writer_wrapper_exception message=$message stdout=$StdoutLog stderr=$StderrLog"
  exit 1
} finally {
  if ($MutexAcquired) {
    try { $Mutex.ReleaseMutex() | Out-Null } catch {}
  }
  try { $Mutex.Dispose() } catch {}
}
