param(
  [switch]$SkipRealtime,
  [switch]$SkipStrategy2,
  [switch]$SkipInstitution,
  [switch]$SkipWarrant,
  [switch]$SkipDesktopSnapshot,
  [switch]$ContinueOnCriticalFailure
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$syncRoot = $PSScriptRoot
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$logDir = Join-Path $runtimeRoot "logs"
$receiptDir = Join-Path $runtimeRoot "data\scan-receipts"
$writeCodeRepoReceipts = ($env:FUMAN_SCAN_RECEIPTS_WRITE_CODE_REPO -eq "1") -or ($env:FUMAN_WRITE_CODE_REPO_DATA -eq "1")
$syncReceiptDir = if ($writeCodeRepoReceipts) { Join-Path $syncRoot "data\scan-receipts" } else { $null }
$lockFile = Join-Path $runtimeRoot "locks\full-scan.lock"
$log = Join-Path $logDir ("full-scan-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$nodeExe = "C:\Program Files\nodejs\node.exe"
$receipts = New-Object System.Collections.Generic.List[object]
$criticalFailures = New-Object System.Collections.Generic.List[string]
$strictRequiredStrategies = @("open-buy", "strategy3", "institution", "warrant-flow", "strategy4", "strategy5", "cb-detect")
$env:NOTIFY_FAST_MODE = "1"
$env:NOTIFY_PUSH_TIMEOUT_MS = "1500"
$env:NOTIFY_PUSH_RETRIES = "1"

$initDirs = @($logDir, $receiptDir, (Split-Path -Parent $lockFile))
if ($syncReceiptDir) { $initDirs += $syncReceiptDir }
New-Item -ItemType Directory -Force -Path $initDirs | Out-Null

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

function Read-FullScanLock {
  if (-not (Test-Path -LiteralPath $lockFile)) { return $null }
  try {
    $raw = Get-Content -LiteralPath $lockFile -Raw -ErrorAction Stop
    if ($raw.Trim().StartsWith("{")) { return $raw | ConvertFrom-Json -ErrorAction Stop }
  } catch {}
  return $null
}

function Test-FullScanLockOwnerAlive($lockInfo) {
  $pidValue = 0
  if ($lockInfo -and $lockInfo.pid) { [void][int]::TryParse([string]$lockInfo.pid, [ref]$pidValue) }
  if ($pidValue -le 0) { return $true }
  return [bool](Get-Process -Id $pidValue -ErrorAction SilentlyContinue)
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

function Get-ReceiptValue($receipt, $name, $default = $null) {
  if (-not $receipt) { return $default }
  if ($receipt -is [System.Collections.IDictionary] -and $receipt.Contains($name)) {
    $value = $receipt[$name]
    if ($null -ne $value) { return $value }
  }
  $property = $receipt.PSObject.Properties[$name]
  if ($property -and $null -ne $property.Value) { return $property.Value }
  return $default
}

function Get-ReceiptWarnings($receipt) {
  $value = Get-ReceiptValue $receipt "warnings" @()
  if ($null -eq $value) { return @() }
  return @($value)
}

function Get-ReceiptBool($receipt, $name, $default = $false) {
  $value = Get-ReceiptValue $receipt $name $default
  return [bool]$value
}

function Get-ReceiptInt($receipt, $name, $default = 0) {
  $propertyValue = Get-ReceiptValue $receipt $name $default
  $value = 0
  if ([int]::TryParse([string]$propertyValue, [ref]$value)) { return $value }
  return [int]$default
}

function Get-ReceiptString($receipt, $name, $default = "") {
  $value = Get-ReceiptValue $receipt $name $default
  if ($null -eq $value) { return [string]$default }
  return [string]$value
}

function Convert-ToStableArray($value) {
  if ($null -eq $value) { return @() }
  if ($value -is [string]) { return @($value) }
  $items = New-Object System.Collections.Generic.List[object]
  if ($value -is [System.Collections.IEnumerable]) {
    foreach ($item in $value) { $items.Add($item) | Out-Null }
  } else {
    $items.Add($value) | Out-Null
  }
  return @($items)
}

function Get-FullScanStrictFailures($items) {
  $byStrategy = @{}
  foreach ($receipt in @($items)) {
    $strategyName = Get-ReceiptString $receipt "strategy"
    if (-not $strategyName) { continue }
    $byStrategy[$strategyName] = $receipt
  }

  $failures = New-Object System.Collections.Generic.List[string]
  foreach ($strategy in $strictRequiredStrategies) {
    if (-not $byStrategy.ContainsKey($strategy)) {
      $failures.Add("${strategy}: missing required receipt") | Out-Null
      continue
    }

    $receipt = $byStrategy[$strategy]
    $status = Get-ReceiptString $receipt "status"
    $complete = Get-ReceiptBool $receipt "complete" $false
    $exitCode = Get-ReceiptInt $receipt "exitCode" 1
    $fallback = Get-ReceiptBool $receipt "fallback" $false
    $quality = Get-ReceiptString $receipt "qualityStatus"
    $warnings = Get-ReceiptWarnings $receipt

    if ($status -ne "complete") {
      $failures.Add("${strategy}: status=$status") | Out-Null
    }
    if (-not $complete) {
      $failures.Add("${strategy}: complete=false") | Out-Null
    }
    if ($exitCode -ne 0) {
      $failures.Add("${strategy}: exitCode=$exitCode") | Out-Null
    }
    if ($fallback) {
      $failures.Add("${strategy}: fallback=true") | Out-Null
    }
    if ($quality -in @("partial", "degraded", "incomplete")) {
      $failures.Add("${strategy}: qualityStatus=$quality") | Out-Null
    }
    if (@($warnings).Count -gt 0) {
      $failures.Add("${strategy}: warnings=$(@($warnings).Count)") | Out-Null
    }
  }
  return @($failures.ToArray())
}

function Write-Receipt($receipt) {
  $file = "{0}.json" -f $receipt.strategy
  Write-JsonFile (Join-Path $receiptDir $file) $receipt
  if ($syncReceiptDir) { Write-JsonFile (Join-Path $syncReceiptDir $file) $receipt }
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
        $stamp = "{0}-{1}" -f $strategy, (Get-Date -Format "yyyyMMddHHmmssfff")
        $stdoutFile = Join-Path $logDir ("full-scan-child-{0}.out.log" -f $stamp)
        $stderrFile = Join-Path $logDir ("full-scan-child-{0}.err.log" -f $stamp)
        $proc = Start-Process -FilePath $nodeExe -ArgumentList @($script) -WorkingDirectory $syncRoot -PassThru -NoNewWindow -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
        if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
          try { $proc.Kill($true) } catch { try { $proc.Kill() } catch {} }
          $exitCode = 124
          $warnings.Add("timeout after ${TimeoutSeconds}s") | Out-Null
          Write-ScanLog "TIMEOUT [$tier] $label after ${TimeoutSeconds}s"
        } else {
          $proc.Refresh()
          $exitCode = $proc.ExitCode
        }
        foreach ($streamFile in @($stdoutFile, $stderrFile)) {
          if (-not (Test-Path -LiteralPath $streamFile)) { continue }
          foreach ($text in (Get-Content -LiteralPath $streamFile -ErrorAction SilentlyContinue)) {
            if (-not $text) { continue }
            Write-Host $text
            Add-Content -LiteralPath $log -Value $text -Encoding utf8
            if ($text -match "(?i)\b(warn|warning|failed|timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed|HTTP 403|HTTP 404|HTTP 429|fallback|partial|incomplete|source warnings)\b") {
              $warnings.Add($text) | Out-Null
            }
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
    runId = if ($payload -and $payload.runId) { [string]$payload.runId } elseif ($payload -and $payload.run_id) { [string]$payload.run_id } elseif ($payload -and $payload.transport -and $payload.transport.runId) { [string]$payload.transport.runId } else { "" }
    payloadPath = $payloadPath
    warnings = @($warnings.ToArray() | Select-Object -First 20)
    blockingReason = $blockingReason
    log = $log
  }
  Write-Receipt $receipt
  Write-ScanLog "END [$tier] $label status=$status exit=$exitCode matches=$($receipt.matches) scanned=$($receipt.scanned)/$($receipt.total)"
  if ($blockingReason) { $criticalFailures.Add("${strategy}: $blockingReason") | Out-Null }
}

function Invoke-RunnerTask($strategy, $label, $tier, $runner) {
  $startedAt = (Get-Date)
  Write-ScanLog "START [$tier] $label"
  $exitCode = 0
  try {
    Push-Location $syncRoot
    try {
      & "${syncRoot}\${runner}" *>&1 | ForEach-Object {
        $text = [string]$_
        Write-Host $text
        Add-Content -LiteralPath $log -Value $text -Encoding utf8
      }
      $exitCode = $LASTEXITCODE
    } finally {
      Pop-Location
    }
  } catch {
    $exitCode = 1
    Write-ScanLog "$label exception: $($_.Exception.Message)"
  }
  $receipt = Read-JsonFile (Join-Path $receiptDir ("{0}.json" -f $strategy))
  $receiptIsStale = $false
  if ($receipt -and $receipt.finishedAt) {
    try { $receiptIsStale = ([DateTimeOffset]::Parse([string]$receipt.finishedAt) -lt [DateTimeOffset]$startedAt.AddSeconds(-1)) } catch { $receiptIsStale = $true }
  }
  if ($receiptIsStale) {
    Write-ScanLog "$label ignored stale scanner receipt finishedAt=$($receipt.finishedAt)"
    $receipt = $null
  }
  if (-not $receipt) {
    $receipt = [ordered]@{
      strategy = $strategy
      label = $label
      tier = $tier
      startedAt = $startedAt.ToString("o")
      finishedAt = (Get-Date).ToString("o")
      status = if ($exitCode -eq 0) { "complete" } else { "failed" }
      exitCode = $exitCode
      scanned = 0
      total = 0
      matches = 0
      complete = ($exitCode -eq 0)
      qualityStatus = if ($exitCode -eq 0) { "complete" } else { "" }
      fallback = $false
      runId = ""
      payloadPath = $runner
      warnings = @()
      blockingReason = if ($exitCode -eq 0) { "" } else { "critical scan failed with exit code $exitCode" }
      log = $log
    }
    Write-Receipt $receipt
  } else {
    $receipts.Add($receipt) | Out-Null
  }
  $status = Get-ReceiptString $receipt "status"
  $complete = Get-ReceiptBool $receipt "complete" $false
  $blockingReason = Get-ReceiptString $receipt "blockingReason"
  if ($exitCode -ne 0 -or $status -eq "failed" -or -not $complete) {
    if ([string]::IsNullOrWhiteSpace($blockingReason)) { $blockingReason = "critical scan failed with exit code $exitCode" }
    if ($tier -eq "critical") { $criticalFailures.Add("${strategy}: $blockingReason") | Out-Null }
  }
  Write-ScanLog "END [$tier] $label status=$status exit=$exitCode matches=$($receipt.matches) scanned=$($receipt.scanned)/$($receipt.total)"
}

function Enter-FullScanLock {
  if (Test-Path -LiteralPath $lockFile) {
    $age = (Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime
    $lockInfo = Read-FullScanLock
    if (Test-FullScanLockOwnerAlive $lockInfo) {
      Write-ScanLog "Another full scan appears to be running; lock=$lockFile pid=$($lockInfo.pid) age=$([math]::Round($age.TotalMinutes, 1))m"
      exit 2
    }
    Write-ScanLog "Removing orphaned full scan lock; lock=$lockFile pid=$($lockInfo.pid) age=$([math]::Round($age.TotalMinutes, 1))m"
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

function Invoke-DesktopRouteSnapshotWrite {
  if ($SkipDesktopSnapshot) {
    Write-ScanLog "SKIP desktop route snapshot write"
    return
  }
  Write-ScanLog "START [snapshot] desktop route snapshot write"
  $exitCode = 0
  $snapshotReceipt = $null
  try {
    Push-Location $syncRoot
    try {
      & $nodeExe "scripts\write-desktop-route-snapshot.js" "--fail-on-partial" "--source=full-scan" *>&1 | ForEach-Object {
        $text = [string]$_
        Write-Host $text
        Add-Content -LiteralPath $log -Value $text -Encoding utf8
      }
      $exitCode = $LASTEXITCODE
      $snapshotReceipt = Read-JsonFile (Join-Path $receiptDir "desktop-route-snapshot.json")
    } finally {
      Pop-Location
    }
  } catch {
    $exitCode = 1
    Write-ScanLog "desktop route snapshot exception: $($_.Exception.Message)"
  }
  if ($exitCode -ne 0) {
    Write-ScanLog "FAIL desktop route snapshot write failed exit=$exitCode"
    $criticalFailures.Add("desktop-route-snapshot: snapshot write failed exit=$exitCode") | Out-Null
    return
  }
  if ($snapshotReceipt -and ($snapshotReceipt.partial -eq $true -or [int]$snapshotReceipt.endpointCount -lt 10)) {
    $reason = "partial=$($snapshotReceipt.partial) endpointCount=$($snapshotReceipt.endpointCount)"
    Write-ScanLog "FAIL desktop route snapshot quality gate failed $reason"
    $criticalFailures.Add("desktop-route-snapshot: quality gate failed $reason") | Out-Null
    return
  }
  Write-ScanLog "END [snapshot] desktop route snapshot write complete"
}

function Invoke-PostScanSnapshotRefreshVerify {
  if ($SkipDesktopSnapshot) {
    Write-ScanLog "SKIP post-scan immediate-display verifier"
    return
  }
  Write-ScanLog "START [snapshot] post-scan immediate-display verifier"
  $exitCode = 0
  try {
    Push-Location $syncRoot
    try {
      & $nodeExe "scripts\verify-post-scan-snapshot-refresh-contract.js" "--max-age-ms=600000" *>&1 | ForEach-Object {
        $text = [string]$_
        Write-Host $text
        Add-Content -LiteralPath $log -Value $text -Encoding utf8
      }
      $exitCode = $LASTEXITCODE
    } finally {
      Pop-Location
    }
  } catch {
    $exitCode = 1
    Write-ScanLog "post-scan immediate-display verifier exception: $($_.Exception.Message)"
  }
  if ($exitCode -ne 0) {
    Write-ScanLog "FAIL post-scan immediate-display verifier failed exit=$exitCode"
    $criticalFailures.Add("post-scan-immediate-display: verifier failed exit=$exitCode") | Out-Null
    return
  }
  Write-ScanLog "END [snapshot] post-scan immediate-display verifier complete"
}

Enter-FullScanLock
try {
  Write-ScanLog "Full scan started"
  Write-ScanLog "scan receipts mode=$(if ($syncReceiptDir) { 'runtime+code-repo' } else { 'runtime-only' })"

  if (-not $SkipRealtime) {
    Invoke-ScanTask "realtime-radar" "realtime radar raw refresh" "optional" "scripts\scan-realtime-radar-cache.js" (Join-Path $runtimeRoot "data\realtime-radar-latest.json") @{ REALTIME_RADAR_PATROL_INTERVAL_MS = "3000" }
  }
  if (-not $SkipStrategy2) {
    Invoke-ScanTask "star-preopen" "STAR preopen raw refresh" "optional" "scripts\scan-star-preopen.js" (Join-Path $runtimeRoot "data\star-preopen-latest.json") @{}
    Invoke-ScanTask "strategy2" "strategy2 intraday raw refresh" "optional" "scripts\scan-intraday-signals.js" (Join-Path $runtimeRoot "data\strategy2-intraday-latest.json") @{
      INTRADAY_PATROL_INTERVAL_MS = "3000"
      STRATEGY2_SCAN_START_MINUTES = "525"
      STRATEGY2_ENTRY_START_MINUTES = "525"
      STRATEGY2_ENTRY_END_MINUTES = "720"
      STRATEGY2_SCAN_END_MINUTES = "720"
      STRATEGY2_REALTIME_FUGLE_ONLY = "1"
    }
  }

  Invoke-RunnerTask "open-buy" "open buy full scan" "critical" "run-open-buy.ps1"
  Invoke-RunnerTask "strategy3" "strategy3 full scan" "critical" "run-strategy3-complete-scan.ps1"

  if (-not $SkipInstitution) {
    Invoke-RunnerTask "institution" "institution full scan" "critical" "run-institution.ps1"
  }
  if (-not $SkipWarrant) {
    Invoke-RunnerTask "warrant-flow" "warrant flow full scan" "critical" "run-warrant-flow.ps1"
  }

  Invoke-RunnerTask "strategy4" "strategy4 full scan" "critical" "run-strategy4.ps1"
  Invoke-RunnerTask "strategy5" "strategy5 full scan" "critical" "run-strategy5.ps1"
  Invoke-RunnerTask "cb-detect" "CB detect full scan" "critical" "run-cb-detect.ps1"

  $receiptItems = @(Convert-ToStableArray $receipts)
  $strictFailures = @(Get-FullScanStrictFailures $receiptItems)
  $strictFailureItems = @(Convert-ToStableArray $strictFailures)

  if ($strictFailureItems.Count -eq 0) {
    Invoke-DesktopRouteSnapshotWrite
    Invoke-PostScanSnapshotRefreshVerify
  } else {
    Write-ScanLog "SKIP desktop route snapshot write because strictFailures=$($strictFailureItems.Count)"
  }

  $criticalFailureItems = @(Convert-ToStableArray $criticalFailures)
  $summary = [ordered]@{
    ok = ($criticalFailureItems.Count -eq 0 -and $strictFailureItems.Count -eq 0)
    source = "scan-full"
    updatedAt = (Get-Date).ToString("o")
    receiptCount = $receiptItems.Count
    criticalFailures = $criticalFailureItems
    strictRequiredStrategies = @($strictRequiredStrategies)
    allCompleteOk = ($strictFailureItems.Count -eq 0)
    strictFailures = $strictFailureItems
    receipts = $receiptItems
    log = $log
  }
  Write-JsonFile (Join-Path $receiptDir "scan-summary.json") $summary
  if ($syncReceiptDir) { Write-JsonFile (Join-Path $syncReceiptDir "scan-summary.json") $summary }

  if ($strictFailureItems.Count -gt 0 -and -not $ContinueOnCriticalFailure) {
    throw "Full scan strict gate failed: $($strictFailureItems -join '; ')"
  }
  if ($criticalFailureItems.Count -gt 0 -and -not $ContinueOnCriticalFailure) {
    throw "Critical scans failed: $($criticalFailureItems -join '; ')"
  }
  Write-ScanLog "SUCCESS full scan completed criticalFailures=$($criticalFailureItems.Count) strictFailures=$($strictFailureItems.Count) allCompleteOk=$($strictFailureItems.Count -eq 0)"
  exit 0
} catch {
  Write-ScanLog "FAILED $($_.Exception.Message)"
  exit 1
} finally {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}

