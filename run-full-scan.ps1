param(
  [switch]$SkipRealtime,
  [switch]$SkipStrategy2,
  [switch]$SkipInstitution,
  [switch]$SkipWarrant,
  [switch]$ContinueOnCriticalFailure
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$syncRoot = $PSScriptRoot
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$logDir = Join-Path $runtimeRoot "logs"
$receiptDir = Join-Path $runtimeRoot "data\scan-receipts"
$syncReceiptDir = Join-Path $syncRoot "data\scan-receipts"
$lockFile = Join-Path $runtimeRoot "locks\full-scan.lock"
$log = Join-Path $logDir ("full-scan-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$nodeExe = "C:\Program Files\nodejs\node.exe"
$receipts = New-Object System.Collections.Generic.List[object]
$criticalFailures = New-Object System.Collections.Generic.List[string]

New-Item -ItemType Directory -Force -Path $logDir, $receiptDir, $syncReceiptDir, (Split-Path -Parent $lockFile) | Out-Null

function Write-ScanLog($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Write-JsonFile($path, $payload) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  $payload | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding utf8
}

function Read-JsonFile($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try { return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
}

function Get-Count($payload) {
  if ($null -eq $payload) { return 0 }
  if ($payload.matches) { return @($payload.matches).Count }
  if ($payload.records) { return @($payload.records).Count }
  if ($payload.events) { return @($payload.events).Count }
  if ($payload.rows) { return @($payload.rows).Count }
  if ($payload.data) { return @($payload.data.PSObject.Properties).Count }
  if ($payload.stocks) { return @($payload.stocks).Count }
  if ($null -ne $payload.count) { return [int]$payload.count }
  if ($null -ne $payload.total) { return [int]$payload.total }
  return 0
}

function Get-ReceiptStatus($exitCode, $tier, $payload, $warnings) {
  if ($exitCode -ne 0) {
    if ($tier -eq "critical") { return "failed" }
    return "degraded"
  }
  if ($payload) {
    $quality = [string]$payload.qualityStatus
    if ($payload.fallbackFromPrevious -eq $true -or $payload.partialScan -eq $true -or $quality -in @("partial", "degraded", "incomplete")) {
      return "degraded"
    }
    if ($payload.complete -eq $false -or [string]$payload.scanStatus -eq "incomplete") {
      return "degraded"
    }
  }
  if (@($warnings).Count -gt 0 -and $tier -ne "optional") { return "degraded" }
  return "complete"
}

function Write-Receipt($receipt) {
  $file = "{0}.json" -f $receipt.strategy
  Write-JsonFile (Join-Path $receiptDir $file) $receipt
  Write-JsonFile (Join-Path $syncReceiptDir $file) $receipt
  $receipts.Add($receipt) | Out-Null
}

function Invoke-ScanTask($strategy, $label, $tier, $script, $payloadPath, $envVars = @{}, [int]$TimeoutSeconds = 0) {
  $startedAt = (Get-Date)
  Write-ScanLog "START [$tier] $label"
  $previousEnv = @{}
  foreach ($key in $envVars.Keys) {
    $previousEnv[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, [string]$envVars[$key], "Process")
  }
  $exitCode = 0
  $warnings = New-Object System.Collections.Generic.List[string]
  try {
    Push-Location $syncRoot
    try {
      if ($TimeoutSeconds -gt 0) {
        $psi = [System.Diagnostics.ProcessStartInfo]::new()
        $psi.FileName = $nodeExe
        $psi.ArgumentList.Add($script)
        $psi.WorkingDirectory = $syncRoot
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $proc = [System.Diagnostics.Process]::Start($psi)
        if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
          try { $proc.Kill($true) } catch { try { $proc.Kill() } catch {} }
          $exitCode = 124
          $warnings.Add("timeout after ${TimeoutSeconds}s") | Out-Null
          Write-ScanLog "TIMEOUT [$tier] $label after ${TimeoutSeconds}s"
        } else {
          $exitCode = $proc.ExitCode
        }
        foreach ($text in @($proc.StandardOutput.ReadToEnd(), $proc.StandardError.ReadToEnd()) -join "`n" -split "`r?`n") {
          if (-not $text) { continue }
          Write-Host $text
          Add-Content -LiteralPath $log -Value $text -Encoding utf8
          if ($text -match "(?i)\b(warn|warning|failed|timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed|HTTP 403|HTTP 404|HTTP 429|fallback|partial|incomplete|source warnings)\b") {
            $warnings.Add($text) | Out-Null
          }
        }
      } else {
        & $nodeExe $script *>&1 | ForEach-Object {
          $text = [string]$_
          Write-Host $text
          Add-Content -LiteralPath $log -Value $text -Encoding utf8
          if ($text -match "(?i)\b(warn|warning|failed|timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed|HTTP 403|HTTP 404|HTTP 429|fallback|partial|incomplete|source warnings)\b") {
            $warnings.Add($text) | Out-Null
          }
        }
        $exitCode = $LASTEXITCODE
      }
    } finally {
      Pop-Location
    }
  } catch {
    $exitCode = 1
    $warnings.Add([string]$_.Exception.Message) | Out-Null
  } finally {
    foreach ($key in $envVars.Keys) {
      if ($null -eq $previousEnv[$key]) {
        [Environment]::SetEnvironmentVariable($key, $null, "Process")
      } else {
        [Environment]::SetEnvironmentVariable($key, [string]$previousEnv[$key], "Process")
      }
    }
  }

  $payload = Read-JsonFile $payloadPath
  $status = Get-ReceiptStatus $exitCode $tier $payload $warnings
  $blockingReason = if ($tier -eq "critical" -and $status -eq "failed") { "critical scan failed with exit code $exitCode" } else { "" }
  $receipt = [ordered]@{
    strategy = $strategy
    label = $label
    tier = $tier
    startedAt = $startedAt.ToString("o")
    finishedAt = (Get-Date).ToString("o")
    status = $status
    exitCode = $exitCode
    scanned = if ($payload -and $payload.scannedCodes) { @($payload.scannedCodes).Count } elseif ($payload -and $payload.scanned_count) { [int]$payload.scanned_count } else { 0 }
    total = if ($payload -and $payload.total) { [int]$payload.total } elseif ($payload -and $payload.total_count) { [int]$payload.total_count } else { 0 }
    matches = Get-Count $payload
    complete = if ($payload -and $null -ne $payload.complete) { [bool]$payload.complete } else { $status -ne "failed" }
    qualityStatus = if ($payload) { [string]$payload.qualityStatus } else { "" }
    fallback = if ($payload) { [bool]$payload.fallbackFromPrevious } else { $false }
    payloadPath = $payloadPath
    warnings = @($warnings.ToArray() | Select-Object -First 20)
    blockingReason = $blockingReason
    log = $log
  }
  Write-Receipt $receipt
  Write-ScanLog "END [$tier] $label status=$status exit=$exitCode matches=$($receipt.matches) scanned=$($receipt.scanned)/$($receipt.total)"
  if ($blockingReason) { $criticalFailures.Add("${strategy}: $blockingReason") | Out-Null }
}

function Enter-FullScanLock {
  if (Test-Path -LiteralPath $lockFile) {
    $age = (Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime
    if ($age.TotalMinutes -lt 30) {
      Write-ScanLog "Another full scan appears to be running; lock=$lockFile age=$([math]::Round($age.TotalMinutes, 1))m"
      exit 2
    }
    Remove-Item -LiteralPath $lockFile -Force
  }
  [ordered]@{ pid = $PID; startedAt = (Get-Date).ToString("o"); log = $log } | ConvertTo-Json -Compress | Set-Content -LiteralPath $lockFile -Encoding utf8
}

function Get-Strategy3ScanEnv {
  $minutes = ((Get-Date).Hour * 60) + (Get-Date).Minute
  if ($minutes -lt 780) {
    Write-ScanLog "strategy3 before 13:00; STRATEGY3_REQUIRE_AFTER_1300=0 for pre-session freshness scan"
    return @{ STRATEGY3_REQUIRE_AFTER_1300 = "0" }
  }
  return @{}
}

Enter-FullScanLock
try {
  Write-ScanLog "Full scan started"

  if (-not $SkipRealtime) {
    Invoke-ScanTask "realtime-radar" "realtime radar raw refresh" "optional" "scripts\scan-realtime-radar-cache.js" (Join-Path $runtimeRoot "data\realtime-radar-latest.json") @{ REALTIME_RADAR_PATROL_INTERVAL_MS = "3000" }
  }
  if (-not $SkipStrategy2) {
    Invoke-ScanTask "star-preopen" "STAR preopen raw refresh" "optional" "scripts\scan-star-preopen.js" (Join-Path $runtimeRoot "data\star-preopen-latest.json") @{}
    Invoke-ScanTask "strategy2" "strategy2 intraday raw refresh" "optional" "scripts\scan-intraday-signals.js" (Join-Path $runtimeRoot "data\strategy2-intraday-latest.json") @{
      INTRADAY_PATROL_INTERVAL_MS = "3000"
      STRATEGY2_SCAN_START_MINUTES = "480"
      STRATEGY2_ENTRY_START_MINUTES = "545"
      STRATEGY2_ENTRY_END_MINUTES = "720"
      STRATEGY2_SCAN_END_MINUTES = "720"
      STRATEGY2_REALTIME_FUGLE_ONLY = "1"
    }
  }

  Invoke-ScanTask "open-buy" "open buy raw refresh" "critical" "scripts\scan-open-buy-cache.js" (Join-Path $runtimeRoot "data\open-buy-latest.json") @{}
  Invoke-ScanTask "strategy3" "strategy3 raw refresh" "critical" "scripts\scan-strategy3-cache.js" (Join-Path $runtimeRoot "data\strategy3-latest.json") (Get-Strategy3ScanEnv)

  if (-not $SkipInstitution) {
    Invoke-ScanTask "institution" "institution raw refresh" "degradable" "scripts\scan-institution-cache.js" (Join-Path $runtimeRoot "data\institution-latest.json") @{
      INSTITUTION_SLOW_SCAN = "1"
      INSTITUTION_REQUEST_DELAY_MS = "15000"
      INSTITUTION_FETCH_RETRIES = "4"
      SHIOAJI_PYTHON = "C:\Users\ginov\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    } 420
  }
  if (-not $SkipWarrant) {
    Invoke-ScanTask "warrant-flow" "warrant flow raw refresh" "degradable" "scripts\scan-warrant-flow-cache.js" (Join-Path $runtimeRoot "data\warrant-flow-latest.json") @{} 240
  }

  Invoke-ScanTask "strategy4" "strategy4 raw refresh" "critical" "scripts\scan-strategy4-cache.js" (Join-Path $runtimeRoot "data\strategy4-latest.json") @{ STRATEGY4_ALLOW_DEGRADED_COMPLETE = "1" }
  Invoke-ScanTask "strategy5" "strategy5 raw refresh" "critical" "scripts\scan-strategy5-cache.js" (Join-Path $runtimeRoot "data\strategy5-latest.json") @{ STRATEGY5_USE_MIS = "0" }
  Invoke-ScanTask "cb-detect" "cb detect raw refresh" "optional" "scripts\generate-cb-detect.js" (Join-Path $runtimeRoot "data\cb-detect-latest.json") @{}

  $summary = [ordered]@{
    ok = ($criticalFailures.Count -eq 0)
    source = "scan-full"
    updatedAt = (Get-Date).ToString("o")
    receiptCount = $receipts.Count
    criticalFailures = @($criticalFailures.ToArray())
    receipts = @($receipts.ToArray())
    log = $log
  }
  Write-JsonFile (Join-Path $receiptDir "scan-summary.json") $summary
  Write-JsonFile (Join-Path $syncReceiptDir "scan-summary.json") $summary

  if ($criticalFailures.Count -gt 0 -and -not $ContinueOnCriticalFailure) {
    throw "Critical scans failed: $($criticalFailures -join '; ')"
  }
  Write-ScanLog "SUCCESS full scan completed criticalFailures=$($criticalFailures.Count)"
  exit 0
} catch {
  Write-ScanLog "FAILED $($_.Exception.Message)"
  exit 1
} finally {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}

