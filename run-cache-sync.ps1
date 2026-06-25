param(
  [ValidateSet("all", "flow", "institution", "warrant", "openBuy", "strategy2", "strategy3", "strategy4", "strategy5", "cb")]
  [string]$Scope = "all"
)

$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false

$sourceRepo = "C:\fuman-runtime"
$codeRepo = "${PSScriptRoot}"
$syncRepo = if ($env:FUMAN_PUBLISH_SYNC_REPO) { $env:FUMAN_PUBLISH_SYNC_REPO } else { "C:\fuman-terminal" }
$mainDeployRepo = if ($env:FUMAN_MAIN_DEPLOY_REPO) { $env:FUMAN_MAIN_DEPLOY_REPO } else { "C:\fuman-terminal" }
$publishToCodeRepo = $env:CACHE_SYNC_WRITE_CODE_REPO -eq "1"
$repoUrl = "https://github.com/ginova777-cmd/fuman-terminal.git"
$logDir = Join-Path $sourceRepo "logs"
$lockFile = Join-Path $sourceRepo "locks\cache-sync.lock"
$outboxRoot = Join-Path $sourceRepo "outbox\cache-sync"
$gitExe = "C:\Program Files\Git\cmd\git.exe"
$nodeExe = "C:\Program Files\nodejs\node.exe"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("cache-sync-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$gitRetryCount = if ($env:CACHE_SYNC_GIT_RETRY_COUNT -match '^\d+$') { [int]$env:CACHE_SYNC_GIT_RETRY_COUNT } else { 5 }
$gitRetryDelaySeconds = if ($env:CACHE_SYNC_GIT_RETRY_DELAY_SECONDS -match '^\d+$') { [int]$env:CACHE_SYNC_GIT_RETRY_DELAY_SECONDS } else { 45 }
$cacheLockMaxWaitSeconds = if ($env:CACHE_SYNC_LOCK_MAX_WAIT_SECONDS -match '^\d+$') { [int]$env:CACHE_SYNC_LOCK_MAX_WAIT_SECONDS } else { 1800 }
$cacheLockStaleMinutes = if ($env:CACHE_SYNC_LOCK_STALE_MINUTES -match '^\d+$') { [int]$env:CACHE_SYNC_LOCK_STALE_MINUTES } else { 25 }
$cacheLockPollSeconds = if ($env:CACHE_SYNC_LOCK_POLL_SECONDS -match '^\d+$') { [int]$env:CACHE_SYNC_LOCK_POLL_SECONDS } else { 20 }

function Write-Log($message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

if ($env:FUMAN_INSIDE_FRESHNESS_GATE -ne "1") {
  $redirectScript = if ($env:FUMAN_LEGACY_GATE_SCRIPT) { $env:FUMAN_LEGACY_GATE_SCRIPT } else { "freshness:gate" }
  Write-Log "Direct cache sync redirected to npm run $redirectScript. scope=$Scope"
  Push-Location $PSScriptRoot
  try {
    npm run $redirectScript
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
}

if ($Scope -ne "all") {
  Write-Log "Scoped publish blocked: scope=$Scope. Use npm run freshness:gate for the single verified publish path."
  exit 2
}

function Clear-StaleSyncGitIndexLock($label) {
  $indexLock = Join-Path $syncRepo ".git\index.lock"
  if (-not (Test-Path -LiteralPath $indexLock)) { return }
  $gitProcesses = @(Get-Process -Name git -ErrorAction SilentlyContinue)
  if ($gitProcesses.Count -gt 0) {
    $ids = ($gitProcesses | Select-Object -ExpandProperty Id) -join ","
    throw "Refusing to remove $indexLock during $label because git process(es) are still running: $ids"
  }
  $age = (Get-Date) - (Get-Item -LiteralPath $indexLock).LastWriteTime
  if ($age.TotalMinutes -lt 2) {
    throw "Refusing to remove fresh git index lock during $label; age $([math]::Round($age.TotalSeconds, 1)) seconds"
  }
  Write-Log "Removing stale git index lock before $label; age $([math]::Round($age.TotalMinutes, 1)) minutes."
  Remove-Item -LiteralPath $indexLock -Force
}

function Read-CacheSyncLockInfo {
  if (-not (Test-Path -LiteralPath $lockFile)) { return $null }
  try {
    $raw = Get-Content -LiteralPath $lockFile -Raw -ErrorAction Stop
    if ($raw.Trim().StartsWith("{")) { return $raw | ConvertFrom-Json }
  } catch {}
  return $null
}

function Test-CacheSyncLockOwnerAlive($lockInfo) {
  $pidValue = 0
  if ($lockInfo -and $lockInfo.pid) { [void][int]::TryParse([string]$lockInfo.pid, [ref]$pidValue) }
  if ($pidValue -le 0) { return $true }
  return [bool](Get-Process -Id $pidValue -ErrorAction SilentlyContinue)
}

function New-CacheSyncLock {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lockFile) | Out-Null
  $payload = [ordered]@{
    pid = $PID
    scope = $Scope
    startedAt = (Get-Date).ToString("o")
    host = $env:COMPUTERNAME
    log = $log
  }
  $payload | ConvertTo-Json -Compress | Set-Content -LiteralPath $lockFile -Encoding utf8
}

function Invoke-PublishedDataVerification {
  Write-Log "Published data freshness verifier removed; relying on targeted API verifiers and publish gate."
}

function Invoke-PrePublishDataFreshnessGate {
  Write-Log "Pre-publish data freshness gate removed; skipping legacy static freshness verifier."
}

function Get-CriticalDataReleaseFiles {
  return @(
    "data\institution-tdcc-breakout.json",
    "data\institution-tdcc-breakout-top.json",
    "data\institution-tdcc-breakout.csv",
    "data\star-preopen-latest.json",
    "data\star-preopen-backup.json",
    "data\star-preopen-scorecard-source.json"
  )
}

function Test-CriticalDataReleaseNeeded($changedFiles) {
  if ($env:FUMAN_SKIP_CRITICAL_DATA_RELEASE -eq "1") {
    Write-Log "CRITICAL_DATA_RELEASE_SKIP env FUMAN_SKIP_CRITICAL_DATA_RELEASE=1"
    return $false
  }
  $criticalReleaseFiles = Get-CriticalDataReleaseFiles
  $changed = @($changedFiles | ForEach-Object { [string]$_ } | Where-Object { $_ })
  $matches = @($changed | Where-Object { $criticalReleaseFiles -contains $_ })
  if ($matches.Count -gt 0) {
    Write-Log "CRITICAL_DATA_RELEASE_NEEDED files=$($matches -join ', ')"
    return $true
  }
  Write-Log "CRITICAL_DATA_RELEASE_NOT_NEEDED changed=$($changed.Count)"
  return $false
}

function Invoke-CriticalDataReleasePipeline($reason) {
  if ($env:FUMAN_INSIDE_CRITICAL_DATA_RELEASE -eq "1") {
    Write-Log "CRITICAL_DATA_RELEASE_SKIP already inside critical data release"
    return
  }
  $previousInside = $env:FUMAN_INSIDE_CRITICAL_DATA_RELEASE
  try {
    $env:FUMAN_INSIDE_CRITICAL_DATA_RELEASE = "1"
    Push-Location $codeRepo
    try {
      Write-Log "CRITICAL_DATA_RELEASE_START reason=$reason"
      npm run snapshot:data 2>&1 | ForEach-Object { Write-Log $_ }
      $snapshotExit = $LASTEXITCODE
      Write-Log "CRITICAL_DATA_SNAPSHOT_END exit=$snapshotExit"
      if ($snapshotExit -ne 0) {
        throw "Critical data snapshot failed with exit code $snapshotExit"
      }
      Write-Log "CRITICAL_DATA_RELEASE_RETIRED no release:main or version bump from cache sync; snapshot data only."
      return
    } finally {
      Pop-Location
    }
  } finally {
    if ($null -eq $previousInside) {
      Remove-Item Env:FUMAN_INSIDE_CRITICAL_DATA_RELEASE -ErrorAction SilentlyContinue
    } else {
      $env:FUMAN_INSIDE_CRITICAL_DATA_RELEASE = $previousInside
    }
  }
}

function Test-FastGateCommitDebounce($changedFiles, $criticalFiles) {
  if ($env:FUMAN_FAST_GATE -ne "1") { return $false }
  $debounceMinutes = 20
  $parsedDebounceMinutes = 0
  if ([int]::TryParse($env:FUMAN_FAST_GATE_COMMIT_DEBOUNCE_MINUTES, [ref]$parsedDebounceMinutes) -and $parsedDebounceMinutes -ge 0) {
    $debounceMinutes = $parsedDebounceMinutes
  }
  if ($debounceMinutes -le 0) { return $false }
  $changed = @($changedFiles | ForEach-Object { [string]$_ } | Where-Object { $_ })
  $critical = @($criticalFiles | ForEach-Object { [string]$_ } | Where-Object { $_ })
  $criticalChanged = @($changed | Where-Object { $critical -contains $_ })
  if ($criticalChanged.Count -gt 0) {
    Write-Log "FAST_DEBOUNCE_BYPASS critical files changed: $($criticalChanged -join ', ')"
    return $false
  }
  $lastIso = & $gitExe -C $syncRepo log -1 --format=%cI -- 2>$null
  if (-not $lastIso) { return $false }
  try {
    $lastCommitTime = [datetimeoffset]::Parse([string]$lastIso)
    $ageMinutes = ([datetimeoffset]::Now - $lastCommitTime).TotalMinutes
    if ($ageMinutes -lt $debounceMinutes) {
      Write-Log "FAST_DEBOUNCE_SKIP changed=$($changed.Count) age=$([math]::Round($ageMinutes, 1))m threshold=${debounceMinutes}m"
      return $true
    }
  } catch {
    Write-Log "FAST_DEBOUNCE_PARSE_WARN $($_.Exception.Message)"
  }
  return $false
}

function Invoke-GitRaw($description, $arguments, $cwd = $syncRepo) {
  Write-Log "=== $description $(Get-Date) ==="
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $gitExe
  $psi.Arguments = ($arguments | ForEach-Object {
    $argument = [string]$_
    if ($argument -match '[\s"]') {
      '"' + ($argument -replace '"', '\"') + '"'
    } else {
      $argument
    }
  }) -join " "
  $psi.WorkingDirectory = $cwd
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($psi)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  foreach ($line in (($stdout + $stderr) -split "`r?`n")) {
    if (-not [string]::IsNullOrWhiteSpace($line)) {
      Write-Log $line
    }
  }
  [pscustomobject]@{
    ExitCode = $process.ExitCode
    Output = (($stdout + $stderr) -replace "\s+", " ").Trim()
  }
}

function Test-TransientGitFailure($text) {
  return ($text -match '(?i)(could not resolve host|getaddrinfo|thread failed to start|timed out|timeout|failed to connect|connection was reset|connection reset|network is unreachable|remote end hung up|TLS|SSL|cannot lock ref|remote rejected|failed to push some refs)')
}

function Run-Git($description, $arguments, $cwd = $syncRepo) {
  $result = Invoke-GitRaw $description $arguments $cwd
  if ($result.ExitCode -ne 0) {
    throw "$description failed with exit code $($result.ExitCode): $($result.Output)"
  }
  $script:LastGitResult = $result
}

function Run-GitWithRetry($description, $arguments, $cwd = $syncRepo) {
  $attempt = 1
  while ($true) {
    $result = Invoke-GitRaw "$description attempt $attempt/$gitRetryCount" $arguments $cwd
    if ($result.ExitCode -eq 0) {
      $script:LastGitResult = $result
      break
    }
    $isTransient = Test-TransientGitFailure $result.Output
    if ((-not $isTransient) -or $attempt -ge $gitRetryCount) {
      $kind = if ($isTransient) { "transient network/git" } else { "non-transient git" }
      throw "$description failed after $attempt attempt(s) [$kind] with exit code $($result.ExitCode): $($result.Output)"
    }
    Write-Log "Transient GitHub/network failure detected; retrying in $gitRetryDelaySeconds seconds."
    Start-Sleep -Seconds $gitRetryDelaySeconds
    $attempt++
  }
}

function Get-OutboxScopeDir {
  Join-Path $outboxRoot $Scope
}

function Get-OutboxMaxAgeMinutes {
  if ($env:CACHE_SYNC_OUTBOX_MAX_AGE_MINUTES -match '^\d+$') { return [int]$env:CACHE_SYNC_OUTBOX_MAX_AGE_MINUTES }
  return 180
}

function Test-OutboxDisabledFile($file) {
  return $file -in @(
    "data\market-summary.json",
    "data\mobile-home-summary.json",
    "data\strategy-match-index.json",
    "data\terminal-home-bundle.json",
    "data\data-status-index.json"
  )
}

function Test-OutboxSnapshotExpired($snapshot) {
  $maxAgeMinutes = Get-OutboxMaxAgeMinutes
  if ($maxAgeMinutes -le 0) { return $false }
  $age = (Get-Date) - $snapshot.LastWriteTime
  if ($age.TotalMinutes -le $maxAgeMinutes) { return $false }
  Write-Log "OUTBOX_EXPIRED scope=$Scope path=$($snapshot.FullName) age=$([math]::Round($age.TotalMinutes, 1))m max=${maxAgeMinutes}m; removing without replay"
  Remove-Item -LiteralPath $snapshot.FullName -Recurse -Force
  return $true
}

function Save-OutboxSnapshot($reason, $dataFiles, $localPublishedFiles) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $snapshotDir = Join-Path (Get-OutboxScopeDir) $stamp
  New-Item -ItemType Directory -Force -Path $snapshotDir | Out-Null
  $savedFiles = New-Object System.Collections.Generic.List[string]

  foreach ($file in $dataFiles) {
    if (Test-OutboxDisabledFile $file) {
      Write-Log "OUTBOX_SAVE_SKIP disabled file: $file"
      continue
    }
    $source = Join-Path $sourceRepo $file
    if (Test-Path -LiteralPath $source) {
      $target = Join-Path $snapshotDir $file
      New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
      Copy-Item -LiteralPath $source -Destination $target -Force
      $savedFiles.Add($file) | Out-Null
    }
  }

  foreach ($file in $localPublishedFiles) {
    if (Test-OutboxDisabledFile $file) {
      Write-Log "OUTBOX_SAVE_SKIP disabled local published file: $file"
      continue
    }
    $source = Join-Path $codeRepo $file
    if (Test-Path -LiteralPath $source) {
      $target = Join-Path $snapshotDir $file
      New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
      Copy-Item -LiteralPath $source -Destination $target -Force
      $savedFiles.Add($file) | Out-Null
    }
  }

  $manifest = [pscustomobject]@{
    createdAt = (Get-Date).ToString("o")
    scope = $Scope
    reason = $reason
    files = @($savedFiles)
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $snapshotDir "manifest.json") -Encoding utf8
  Write-Log "OUTBOX_SAVED scope=$Scope path=$snapshotDir files=$($savedFiles.Count) reason=$reason"
}

function Replay-OutboxSnapshots {
  $scopeDir = Get-OutboxScopeDir
  if (-not (Test-Path -LiteralPath $scopeDir)) { return }
  $snapshots = @(Get-ChildItem -LiteralPath $scopeDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name)
  if (-not $snapshots.Count) { return }

  foreach ($snapshot in $snapshots) {
    if (Test-OutboxSnapshotExpired $snapshot) { continue }
    $manifestPath = Join-Path $snapshot.FullName "manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) {
      Write-Log "Outbox snapshot missing manifest, skipped: $($snapshot.FullName)"
      continue
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $files = @($manifest.files)
    if (-not $files.Count) {
      Write-Log "Outbox snapshot has no files, removing: $($snapshot.FullName)"
      Remove-Item -LiteralPath $snapshot.FullName -Recurse -Force
      continue
    }

    Write-Log "OUTBOX_REPLAY_START scope=$Scope path=$($snapshot.FullName) files=$($files.Count)"
    foreach ($file in $files) {
      $source = Join-Path $snapshot.FullName $file
      if (-not (Test-Path -LiteralPath $source)) {
        Write-Log "Outbox file missing, skipped: $source"
        continue
      }
      if (Test-OutboxDisabledFile $file) {
        Write-Log "OUTBOX_REPLAY_SKIP disabled file: $file"
        continue
      }
      if (Should-SkipCacheFile $file $source) {
        continue
      }
      Copy-CacheFile $file $source $syncRepo "outbox"
      Copy-CodeRepoCacheFile $file $source "outbox local"
    }

    Run-Git "Stage outbox cache files" (@("add", "-f") + $files)
    $changed = & $gitExe -C $syncRepo diff --cached --name-only -- $files
    if ($changed) {
      $outboxStamp = Get-Date -Format "yyyy-MM-dd HH:mm"
      Run-Git "Commit outbox cache files" @("commit", "-m", "Replay scheduled cache $outboxStamp")
      Run-GitWithRetry "Push outbox cache commit" @("push", "origin", "main")
    } else {
      Write-Log "No outbox changes to sync for $($snapshot.Name)."
    }
    Remove-Item -LiteralPath $snapshot.FullName -Recurse -Force
    Write-Log "OUTBOX_REPLAY_DONE scope=$Scope path=$($snapshot.FullName)"
  }
}

function Read-JsonFile($path) {
  try {
    $utf8Strict = [System.Text.UTF8Encoding]::new($false, $true)
    $reader = [System.IO.StreamReader]::new($path, $utf8Strict, $true)
    try {
      $raw = $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
    if ([string]::IsNullOrWhiteSpace($raw)) {
      throw "JSON file is empty"
    }
    return ($raw | ConvertFrom-Json -ErrorAction Stop)
  } catch {
    Write-Log "Could not parse JSON: $path :: $($_.Exception.Message)"
    return $null
  }
}

function Assert-ReadableJsonFile($file, $source) {
  $json = Read-JsonFile $source
  if (-not $json) {
    throw "$file is required but could not be parsed as JSON: $source"
  }
  return $json
}

function Assert-CopiedFile($file, $source, $target) {
  if (-not (Test-Path $target)) {
    throw "$file copy verification failed; target missing: $target"
  }
  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  $targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  if ($sourceHash -ne $targetHash) {
    throw "$file copy verification failed; source/target SHA256 mismatch"
  }
  Write-Log "$file copied and verified: $sourceHash"
}

function Assert-CacheFileSize($file, $source) {
  return
}

function Copy-CacheFile($file, $source, $targetRoot, $label) {
  Assert-CacheFileSize $file $source
  $target = Join-Path $targetRoot $file
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
  Assert-CopiedFile "$label $file" $source $target
}

function Test-IntradayFlowProtectedFile($file) {
  if ($Scope -ne "all") { return $false }
  if ($file -notin @(
    "data\institution-tdcc-breakout.json",
    "data\institution-tdcc-breakout-top.json",
    "data\institution-tdcc-breakout.csv",
    "data\afterhours-supabase-status.json",
    "data\flow-health-latest.json"
  )) { return $false }
  $now = Get-Date
  $minutes = $now.Hour * 60 + $now.Minute
  return $minutes -ge (8 * 60 + 30) -and $minutes -le (13 * 60 + 45)
}
function Copy-CodeRepoCacheFile($file, $source, $label) {
  if ($publishToCodeRepo) {
    if ($env:CACHE_SYNC_WRITE_CODE_REPO_CRITICAL_ONLY -eq "1" -and $file -notin (Get-CriticalDataReleaseFiles)) {
      Write-Log "Skipping code repo cache copy ($label non-critical): $file"
      return
    }
    Copy-CacheFile $file $source $codeRepo $label
    return
  }
  Write-Log "Skipping code repo cache copy ($label): $file"
}

function Copy-MainDeployCacheFile($file, $source, $label) {
  if (-not $mainDeployRepo) { return }
  if (-not (Test-Path -LiteralPath $mainDeployRepo)) {
    Write-Log "Skipping main deploy cache copy ($label): missing $mainDeployRepo"
    return
  }
  $sourceRoot = [System.IO.Path]::GetFullPath($codeRepo).TrimEnd('\')
  $targetRoot = [System.IO.Path]::GetFullPath($mainDeployRepo).TrimEnd('\')
  if ($sourceRoot -ieq $targetRoot) {
    Write-Log "Skipping main deploy cache copy ($label): same as code repo"
    return
  }
  Copy-CacheFile $file $source $mainDeployRepo "main-deploy $label"
}

function Update-SlimCacheFiles {
  $stocksScript = Join-Path $codeRepo "scripts\generate-stocks-slim.js"
  if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $stocksScript)) {
    Write-Log "=== Generate full stocks slim file $(Get-Date) ==="
    $stocksOutput = & $nodeExe $stocksScript 2>&1
    foreach ($line in $stocksOutput) {
      if (-not [string]::IsNullOrWhiteSpace([string]$line)) { Write-Log $line }
    }
    if ($LASTEXITCODE -ne 0) {
      Write-Log "Full stocks slim generation exited with code $LASTEXITCODE; continuing with existing stocks-slim if available"
    }
  }
  $marketSummaryScript = Join-Path $codeRepo "scripts\generate-market-summary.js"
  if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $marketSummaryScript)) {
    Write-Log "=== Generate market summary file $(Get-Date) ==="
    $marketSummaryOutput = & $nodeExe $marketSummaryScript 2>&1
    foreach ($line in $marketSummaryOutput) {
      if (-not [string]::IsNullOrWhiteSpace([string]$line)) { Write-Log $line }
    }
    if ($LASTEXITCODE -ne 0) {
      Write-Log "Market summary generation exited with code $LASTEXITCODE; stale market-summary will be skipped by freshness guard if encountered"
    }
  }
  $scriptPath = Join-Path $codeRepo "scripts\generate-slim-cache.js"
  if (-not (Test-Path -LiteralPath $nodeExe) -or -not (Test-Path -LiteralPath $scriptPath)) {
    Write-Log "Slim cache generation skipped: node or script missing"
    return
  }
  Write-Log "=== Generate slim cache files $(Get-Date) ==="
  $output = & $nodeExe $scriptPath 2>&1
  foreach ($line in $output) {
    if (-not [string]::IsNullOrWhiteSpace([string]$line)) { Write-Log $line }
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Log "Slim cache generation exited with code $LASTEXITCODE; continuing with available files"
  }
  $perfScript = Join-Path $codeRepo "scripts\generate-performance-report.js"
  if (Test-Path -LiteralPath $perfScript) {
    $qualityScripts = @(
      "scripts\generate-signal-quality-report.js",
      "scripts\generate-data-quality-report.js",
      "scripts\generate-consistency-report.js",
      "scripts\generate-strategy-weight-report.js"
    )
    foreach ($qualityScript in $qualityScripts) {
      $fullQualityScript = Join-Path $codeRepo $qualityScript
      if (Test-Path -LiteralPath $fullQualityScript) {
        Write-Log "=== Generate $qualityScript $(Get-Date) ==="
        $qualityOutput = & $nodeExe $fullQualityScript 2>&1
        foreach ($line in $qualityOutput) {
          if (-not [string]::IsNullOrWhiteSpace([string]$line)) { Write-Log $line }
        }
      }
    }
    Write-Log "=== Generate performance report $(Get-Date) ==="
    $perfOutput = & $nodeExe $perfScript 2>&1
    foreach ($line in $perfOutput) {
      if (-not [string]::IsNullOrWhiteSpace([string]$line)) { Write-Log $line }
    }
  }
}

function Get-TextSha256($text) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(([string]$text).Trim())
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha.ComputeHash($bytes)) -replace "-", "")
  } finally {
    $sha.Dispose()
  }
}

function Test-DesktopApiOnlyStaticDataFile($file) {
  # DESKTOP_API_ONLY_STATIC_FILTER: these desktop terminal datasets must be served by Supabase latest APIs only.
  $normalized = ([string]$file) -replace "/", "\"
  if ($normalized -match "\\mobile-" -or $normalized -match "-mobile-" -or $normalized -match "tdcc-breakout") { return $false }
  return $normalized -match "^data\\(open-buy|strategy2-intraday|strategy3|strategy4|strategy5|institution|warrant-flow|warrant-priority|warrant-single-signal|cb-detect).+\.json$"
}

function Test-VercelCacheVisibility($file) {
  if (Test-DesktopApiOnlyStaticDataFile $file) {
    Write-Log "VERCEL_VISIBLE_SKIPPED file=$file reason=desktop-api-only-static-disabled"
    return
  }
  $baseUrl = $env:FUMAN_VERCEL_BASE_URL
  if (-not $baseUrl) { $baseUrl = "https://fuman-terminal.vercel.app" }
  $localPath = Join-Path $syncRepo $file
  if (-not (Test-Path -LiteralPath $localPath)) {
    Write-Log "VERCEL_VISIBLE_SKIPPED file=$file reason=missing-local-sync-file"
    return
  }

  $urlPath = ($file -replace "\\", "/")
  $url = "$($baseUrl.TrimEnd('/'))/$urlPath?v=$(Get-Date -Format yyyyMMddHHmmss)"
  $attempts = if ($env:VERCEL_VISIBLE_ATTEMPTS -match '^\d+$') { [int]$env:VERCEL_VISIBLE_ATTEMPTS } else { 3 }
  $delaySeconds = if ($env:VERCEL_VISIBLE_RETRY_SECONDS -match '^\d+$') { [int]$env:VERCEL_VISIBLE_RETRY_SECONDS } else { 30 }
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    try {
      Write-Log "=== Vercel visibility check $file attempt $attempt/$attempts $(Get-Date) ==="
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
      $remoteText = [string]$response.Content
      $localText = Get-Content -LiteralPath $localPath -Raw
      $remoteJson = $remoteText | ConvertFrom-Json -ErrorAction Stop
      $localJson = $localText | ConvertFrom-Json -ErrorAction Stop
      $sameHash = (Get-TextSha256 $remoteText) -eq (Get-TextSha256 $localText)
      $remoteCount = if ($null -ne $remoteJson.count) { [int]$remoteJson.count } else { -1 }
      $localCount = if ($null -ne $localJson.count) { [int]$localJson.count } else { -1 }
      $sameSummary = (
        [string]$remoteJson.updatedAt -eq [string]$localJson.updatedAt -and
        [string]$remoteJson.usedDate -eq [string]$localJson.usedDate -and
        $remoteCount -eq $localCount
      )
      if ($sameHash -or $sameSummary) {
        Write-Log "VERCEL_VISIBLE_OK file=$file updatedAt=$($remoteJson.updatedAt) usedDate=$($remoteJson.usedDate) count=$remoteCount attempt=$attempt"
        return
      }
      Write-Log "VERCEL_VISIBLE_WAIT file=$file remote differs localUpdatedAt=$($localJson.updatedAt) remoteUpdatedAt=$($remoteJson.updatedAt) localCount=$localCount remoteCount=$remoteCount"
    } catch {
      $message = $_.Exception.Message
      if ($message -match '\(404\)|404') {
        Write-Log "VERCEL_VISIBLE_WARN file=$file not found on Vercel; skipping retries for this non-blocking visibility check."
        return
      }
      Write-Log "VERCEL_VISIBLE_WAIT file=$file check failed: $message"
    }
    if ($attempt -lt $attempts) { Start-Sleep -Seconds $delaySeconds }
  }
  Write-Log "VERCEL_VISIBLE_WARN file=$file not visible after $attempts attempts"
}

function Get-RocTradeDateAgeDays($tradeDate) {
  $text = [string]$tradeDate
  if ($text -match "^\d{8}$") {
    return Get-YmdAgeDays $text
  }
  if ($text -notmatch "^\d{7}$") {
    return [double]::PositiveInfinity
  }
  $year = [int]$text.Substring(0, 3) + 1911
  $month = [int]$text.Substring(3, 2)
  $day = [int]$text.Substring(5, 2)
  $date = Get-Date -Year $year -Month $month -Day $day -Hour 0 -Minute 0 -Second 0
  $today = Get-Date -Hour 0 -Minute 0 -Second 0
  return [math]::Floor(($today - $date).TotalDays)
}

function Get-YmdAgeDays($ymd) {
  $text = [string]$ymd
  if ($text -notmatch "^\d{8}$") {
    return [double]::PositiveInfinity
  }
  $date = Get-Date -Year ([int]$text.Substring(0, 4)) -Month ([int]$text.Substring(4, 2)) -Day ([int]$text.Substring(6, 2)) -Hour 0 -Minute 0 -Second 0
  $today = Get-Date -Hour 0 -Minute 0 -Second 0
  return [math]::Floor(($today - $date).TotalDays)
}

function Should-SkipCacheFile($file, $source) {
  $content = Get-Content -LiteralPath $source -Raw
  if ($content -match "github-actions-backup-readonly") {
    Write-Log "$file is a fallback copy from a failed scan; skipped."
    return $true
  }

  if ($file -eq "data\market-summary.json") {
    $json = Assert-ReadableJsonFile $file $source
    $today = Get-Date -Format "yyyyMMdd"
    $summaryDate = [string]$json.resolvedTradeDate
    if (-not $summaryDate -and $json.stocks -and $json.stocks.Count -gt 0) { $summaryDate = [string]$json.stocks[0].quoteDate }
    if ($summaryDate -ne $today -or $json.isFallbackDate -eq $true) {
      Write-Log "$file is stale: resolvedTradeDate $summaryDate, today $today, isFallbackDate $($json.isFallbackDate); skipped."
      return $true
    }
  }
  if ($file -eq "data\institution-latest.json") {
    $json = Assert-ReadableJsonFile $file $source
    $age = Get-YmdAgeDays $json.usedDate
    if ($age -gt 3) {
      Write-Log "$file is stale: usedDate $($json.usedDate), age $age days; skipped."
      return $true
    }
  }

  if ($file -eq "data\warrant-flow-latest.json") {
    $json = Assert-ReadableJsonFile $file $source
    $matchesProp = $json.PSObject.Properties["matches"]
    $matches = @($matchesProp.Value)
    if (-not $matches.Length) {
      Write-Log "$file has no warrant matches; skipped."
      return $true
    }
    $firstTradeDate = $matches[0].tradeDate
    $age = Get-RocTradeDateAgeDays $firstTradeDate
    if ($age -gt 3) {
      Write-Log "$file is stale: tradeDate $firstTradeDate, age $age days; skipped."
      return $true
    }
  }

  return $false
}

$lockStartedAt = Get-Date
$lockAttempt = 1
while (Test-Path -LiteralPath $lockFile) {
  $waitAge = (Get-Date) - $lockStartedAt
  if ($waitAge.TotalSeconds -ge $cacheLockMaxWaitSeconds) { break }
  $lockInfo = Read-CacheSyncLockInfo
  $age = (Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime
  $ownerAlive = Test-CacheSyncLockOwnerAlive $lockInfo
  if (-not $ownerAlive) {
    Write-Log "Removing orphaned cache sync lock; pid=$($lockInfo.pid) scope=$($lockInfo.scope) age=$([math]::Round($age.TotalMinutes, 1)) minutes."
    Remove-Item -LiteralPath $lockFile -Force
    break
  }
  if ($age.TotalMinutes -ge $cacheLockStaleMinutes) {
    Write-Log "Removing stale cache sync lock; lock age $([math]::Round($age.TotalMinutes, 1)) minutes, pid=$($lockInfo.pid), scope=$($lockInfo.scope)."
    Remove-Item -LiteralPath $lockFile -Force
    break
  }
  Write-Log "Another cache sync is running; waiting for lock release attempt $lockAttempt, pid=$($lockInfo.pid), scope=$($lockInfo.scope), age=$([math]::Round($age.TotalMinutes, 1)) minutes."
  Start-Sleep -Seconds $cacheLockPollSeconds
  $lockAttempt++
}
if (Test-Path -LiteralPath $lockFile) {
  throw "Cache sync lock did not clear after $cacheLockMaxWaitSeconds seconds; refusing to skip publish silently."
}

New-CacheSyncLock

try {
  Write-Log "=== Cache sync start $(Get-Date) scope=$Scope ==="
  Update-SlimCacheFiles

  if ($Scope -eq "flow") {
    $criticalLatestFiles = @(
      "data\institution-latest.json",
      "data\institution-tdcc-breakout-top.json",
      "data\warrant-flow-latest.json"
    )

    $dataFiles = @(
      "data\institution-latest.json",
      "data\institution-summary.json",
      "data\institution-slim.json",
      "data\institution-joint-top.json",
      "data\institution-foreign-top.json",
      "data\institution-trust-top.json",
      "data\institution-mobile-top.json",
      "data\institution-tdcc-breakout.json",
      "data\institution-tdcc-breakout-top.json",
      "data\institution-tdcc-breakout.csv",
      "data\institution-backup.json",
      "data\warrant-flow-latest.json",
      "data\warrant-flow-summary.json",
      "data\warrant-flow-slim.json",
      "data\warrant-priority-top.json",
      "data\warrant-single-signal-top.json",
      "data\warrant-flow-mobile-top.json",
      "data\warrant-flow-backup.json",
      "data\afterhours-supabase-status.json",
      "data\flow-health-latest.json",
      "data\data-status-index.json"
    )
  } elseif ($Scope -eq "institution") {
    $criticalLatestFiles = @(
      "data\institution-latest.json",
      "data\institution-tdcc-breakout-top.json"
    )

    $dataFiles = @(
      "data\institution-latest.json",
      "data\institution-summary.json",
      "data\institution-slim.json",
      "data\institution-joint-top.json",
      "data\institution-foreign-top.json",
      "data\institution-trust-top.json",
      "data\institution-mobile-top.json",
      "data\institution-tdcc-breakout.json",
      "data\institution-tdcc-breakout-top.json",
      "data\institution-tdcc-breakout.csv",
      "data\institution-backup.json",
      "data\afterhours-supabase-status.json",
      "data\flow-health-latest.json",
      "data\data-status-index.json"
    )
  } elseif ($Scope -eq "warrant") {
    $criticalLatestFiles = @(
      "data\warrant-flow-latest.json"
    )

    $dataFiles = @(
      "data\warrant-flow-latest.json",
      "data\warrant-flow-summary.json",
      "data\warrant-flow-slim.json",
      "data\warrant-priority-top.json",
      "data\warrant-single-signal-top.json",
      "data\warrant-flow-mobile-top.json",
      "data\warrant-flow-backup.json",
      "data\afterhours-supabase-status.json",
      "data\flow-health-latest.json",
      "data\data-status-index.json"
    )
  } elseif ($Scope -eq "openBuy") {
    $criticalLatestFiles = @(
      "data\open-buy-latest.json",
      "data\star-preopen-latest.json"
    )

    $dataFiles = @(
      "data\open-buy-latest.json",
      "data\open-buy-backup.json",
      "data\open-buy-scorecard-source.json",
      "data\star-preopen-latest.json",
      "data\star-preopen-backup.json",
      "data\star-preopen-scorecard-source.json"
    )
  } elseif ($Scope -eq "strategy3") {
    $criticalLatestFiles = @()
    $dataFiles = @()
  } elseif ($Scope -eq "strategy2") {
    $criticalLatestFiles = @()
    $dataFiles = @()
  } elseif ($Scope -eq "strategy4") {
    $criticalLatestFiles = @()
    $dataFiles = @()
  } elseif ($Scope -eq "strategy5") {
    $criticalLatestFiles = @()
    $dataFiles = @()
  } elseif ($Scope -eq "cb") {
    $criticalLatestFiles = @()

    $dataFiles = @(
      "data\afterhours-supabase-status.json",
      "data\data-status-index.json"
    )
  } else {
    $criticalLatestFiles = @(
      "data\institution-latest.json",
      "data\institution-tdcc-breakout-top.json",
      "data\warrant-flow-latest.json",
      "data\open-buy-latest.json",
      "data\strategy3-latest.json",
      "data\strategy4-latest.json",
      "data\strategy5-latest.json",
      "data\cb-detect-latest.json"
    )

    $dataFiles = @(
      "data\institution-latest.json",
      "data\institution-summary.json",
      "data\institution-slim.json",
      "data\institution-joint-top.json",
      "data\institution-foreign-top.json",
      "data\institution-trust-top.json",
      "data\institution-mobile-top.json",
      "data\institution-tdcc-breakout.json",
      "data\institution-tdcc-breakout-top.json",
      "data\institution-tdcc-breakout.csv",
      "data\institution-backup.json",
      "data\warrant-flow-latest.json",
      "data\warrant-flow-summary.json",
      "data\warrant-flow-slim.json",
      "data\warrant-priority-top.json",
      "data\warrant-single-signal-top.json",
      "data\warrant-flow-mobile-top.json",
      "data\warrant-flow-backup.json",
      "data\afterhours-supabase-status.json",
      "data\flow-health-latest.json",
      "data\market-summary.json",
      "data\health-summary.json",
      "data\terminal-home-bundle.json",
      "data\data-status-index.json",
      "data\stocks-slim.json",
      "data\stocks-index.json",
      "data\stocks-quotes-slim.json",
      "data\stocks-quotes-mobile-top.json",
      "data\performance-report.json",
      "data\signal-quality-report.json",
      "data\data-quality-report.json",
      "data\data-consistency-report.json",
      "data\strategy-weight-report.json",
      "data\open-buy-latest.json",
      "data\open-buy-backup.json",
      "data\open-buy-scorecard-source.json",
      "data\strategy3-latest.json",
      "data\strategy3-backup.json",
      "data\strategy3-scorecard-source.json",
      "data\strategy2-intraday-latest.json",
      "data\strategy2-intraday-slim.json",
      "data\strategy2-intraday-top.json",
      "data\strategy2-intraday-live-top.json",
      "data\strategy2-intraday-delta.json",
      "data\strategy2-scorecard-source.json",
      "data\strategy4-latest.json",
      "data\strategy4-summary.json",
      "data\strategy4-slim.json",
      "data\strategy4-zone-a.json",
      "data\strategy4-zone-b.json",
      "data\strategy4-zone-c.json",
      "data\strategy4-score-top.json",
      "data\strategy4-backup.json",
      "data\strategy5-latest.json",
      "data\strategy5-backup.json",
      "data\cb-detect-latest.json",
      "data\realtime-radar-latest.json"
    )
    foreach ($page in 1..48) {
      $dataFiles += "data\strategy4-zone-b-page-$page.json"
      $dataFiles += "data\strategy4-zone-c-page-$page.json"
    }
  }

  if ($Scope -eq "all") {
    $criticalLatestFiles = @($criticalLatestFiles | Where-Object { -not (Test-IntradayFlowProtectedFile $_) })
  }

  $desktopApiOnlyStaticFiles = @($dataFiles | Where-Object { Test-DesktopApiOnlyStaticDataFile $_ })
  if ($desktopApiOnlyStaticFiles.Count -gt 0) {
    Write-Log "DESKTOP_API_ONLY_STATIC_FILTER removed=$($desktopApiOnlyStaticFiles -join ', ')"
  }
  $dataFiles = @($dataFiles | Where-Object { -not (Test-DesktopApiOnlyStaticDataFile $_) })
  $criticalLatestFiles = @($criticalLatestFiles | Where-Object { -not (Test-DesktopApiOnlyStaticDataFile $_) })

  $copiedFiles = New-Object System.Collections.Generic.List[string]
  $localPublishedFiles = @()
  if (-not (Test-Path (Join-Path $syncRepo ".git"))) {
    if (Test-Path $syncRepo) {
      throw "$syncRepo exists but is not a git repository. Rename or remove it before cache sync can initialize."
    }
    Run-Git "Clone clean sync repository" @("clone", $repoUrl, $syncRepo) (Split-Path $syncRepo -Parent)
  }

  try {
    Run-GitWithRetry "Fetch origin main" @("fetch", "origin", "main")
  } catch {
    Save-OutboxSnapshot "fetch failed: $($_.Exception.Message)" $dataFiles $localPublishedFiles
    throw
  }
  Clear-StaleSyncGitIndexLock 'reset clean sync repository'
  Run-Git "Reset clean sync repository" @("reset", "--hard", "origin/main")
  Run-Git "Clean generated sync repository files" @("clean", "-fd")

  Replay-OutboxSnapshots

  foreach ($file in $dataFiles) {
    $source = Join-Path $sourceRepo $file
    $target = Join-Path $syncRepo $file
    if (Test-IntradayFlowProtectedFile $file) {
      Write-Log "$file skipped during intraday protected window for all-scope sync."
      continue
    }
    if (-not (Test-Path $source)) {
      Write-Log "Missing source file, skipped: $source"
      continue
    }
    if (Should-SkipCacheFile $file $source) {
      continue
    }
    Copy-CacheFile $file $source $syncRepo "sync"
    Copy-CodeRepoCacheFile $file $source "local"
    Copy-MainDeployCacheFile $file $source "local"
    $copiedFiles.Add($file) | Out-Null
  }

  foreach ($file in $localPublishedFiles) {
    $source = Join-Path $codeRepo $file
    if (-not (Test-Path $source)) {
      Write-Log "Missing local published file, skipped: $source"
      continue
    }
    Copy-CacheFile $file $source $syncRepo "local-published"
    $copiedFiles.Add($file) | Out-Null
  }

  Write-Log "=== Refresh derived cache files after raw cache copy $(Get-Date) ==="
  Update-SlimCacheFiles

  $refreshedDerivedFiles = @(
    "data\market-summary.json",
    "data\mobile-home-summary.json",
    "data\terminal-home-bundle.json",
    "data\data-status-index.json",
    "data\stocks-slim.json",
    "data\stocks-index.json",
    "data\stocks-quotes-slim.json",
    "data\stocks-quotes-mobile-top.json",
    "data\performance-report.json",
    "data\signal-quality-report.json",
    "data\data-quality-report.json",
    "data\data-consistency-report.json",
    "data\strategy-weight-report.json",
    "data\strategy-match-index.json"
  )

  foreach ($file in @(($copiedFiles + $refreshedDerivedFiles) | Select-Object -Unique)) {
    $source = Join-Path $codeRepo $file
    if (-not (Test-Path $source)) {
      Write-Log "Missing refreshed code repo file, skipped: $source"
      continue
    }
    Copy-CacheFile $file $source $syncRepo "refreshed"
    Copy-MainDeployCacheFile $file $source "refreshed"
    if (-not $copiedFiles.Contains($file)) {
      $copiedFiles.Add($file) | Out-Null
    }
  }

  foreach ($requiredFile in $criticalLatestFiles) {
    if (-not $copiedFiles.Contains($requiredFile)) {
      throw "$requiredFile was not copied; refusing to publish partial latest cache set."
    }
  }

  $stageFiles = @($copiedFiles | Select-Object -Unique)
  if (-not $stageFiles.Count) {
    Write-Log "No copied cache files to stage."
    exit 0
  }

  $stageChunkSize = 20
  for ($offset = 0; $offset -lt $stageFiles.Count; $offset += $stageChunkSize) {
    $end = [Math]::Min($offset + $stageChunkSize - 1, $stageFiles.Count - 1)
    $stageChunk = @($stageFiles[$offset..$end])
    Run-Git "Stage cache files $($offset + 1)-$($end + 1)/$($stageFiles.Count)" (@("add", "-f") + $stageChunk)
  }

  $changed = & $gitExe -C $syncRepo diff --cached --name-only
  if (-not $changed) {
    Write-Log "No cache changes to sync."
    Invoke-PublishedDataVerification
    exit 0
  }

  if (Test-FastGateCommitDebounce @($changed) $criticalLatestFiles) {
    Run-Git "Reset debounced fast gate staged files" @("reset", "--hard", "HEAD")
    Invoke-PublishedDataVerification
    exit 0
  }

  $criticalDataReleaseNeeded = Test-CriticalDataReleaseNeeded @($changed)

Invoke-PrePublishDataFreshnessGate

  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
  Run-Git "Commit cache files" @("commit", "-m", "Update scheduled cache $stamp")

  try {
    Run-GitWithRetry "Push cache commit" @("push", "origin", "main")
    if ($criticalDataReleaseNeeded) {
      Invoke-CriticalDataReleasePipeline "cache commit pushed"
    }
  } catch {
    Write-Log "Push failed; resetting to latest origin/main, replaying cache files, and retrying once."
    Save-OutboxSnapshot "push failed: $($_.Exception.Message)" $dataFiles $localPublishedFiles
    Run-GitWithRetry "Fetch origin main after push failure" @("fetch", "origin", "main")
    Run-Git "Reset after push failure" @("reset", "--hard", "origin/main")
    $retryStageFiles = New-Object System.Collections.Generic.List[string]
    foreach ($file in $dataFiles) {
      $source = Join-Path $sourceRepo $file
      $target = Join-Path $syncRepo $file
      if (Test-IntradayFlowProtectedFile $file) {
        Write-Log "$file skipped during intraday protected window for all-scope sync retry."
        continue
      }
      if (Test-Path $source) {
        if (Should-SkipCacheFile $file $source) {
          continue
        }
        Copy-CacheFile $file $source $syncRepo "sync retry"
        Copy-CodeRepoCacheFile $file $source "local retry"
        Copy-MainDeployCacheFile $file $source "local retry"
        $retryStageFiles.Add($file) | Out-Null
      }
    }
    foreach ($file in $localPublishedFiles) {
      $source = Join-Path $codeRepo $file
      if (Test-Path $source) {
        Copy-CacheFile $file $source $syncRepo "local-published retry"
        $retryStageFiles.Add($file) | Out-Null
      }
    }
    $retryStageFiles = @($retryStageFiles | Select-Object -Unique)
    if (-not $retryStageFiles.Count) {
      Write-Log "No copied cache files to stage after retry reset."
      return
    }
    $retryStageChunkSize = 20
    for ($offset = 0; $offset -lt $retryStageFiles.Count; $offset += $retryStageChunkSize) {
      $end = [Math]::Min($offset + $retryStageChunkSize - 1, $retryStageFiles.Count - 1)
      $retryStageChunk = @($retryStageFiles[$offset..$end])
      Run-Git "Stage cache files after retry reset $($offset + 1)-$($end + 1)/$($retryStageFiles.Count)" (@("add", "-f") + $retryStageChunk)
    }
    $retryChanged = & $gitExe -C $syncRepo diff --cached --name-only
    if ($retryChanged) {
      $criticalDataReleaseNeededAfterRetry = Test-CriticalDataReleaseNeeded @($retryChanged)
      Invoke-PrePublishDataFreshnessGate
      Run-Git "Commit cache files after retry reset" @("commit", "-m", "Update scheduled cache $stamp retry")
      Run-GitWithRetry "Retry push cache commit" @("push", "origin", "main")
      if ($criticalDataReleaseNeededAfterRetry) {
        Invoke-CriticalDataReleasePipeline "cache commit pushed after retry"
      }
      $scopeDir = Get-OutboxScopeDir
      if (Test-Path -LiteralPath $scopeDir) {
        Get-ChildItem -LiteralPath $scopeDir -Directory -ErrorAction SilentlyContinue |
          Sort-Object Name -Descending |
          Select-Object -First 1 |
          ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force
            Write-Log "OUTBOX_REMOVED_AFTER_RETRY scope=$Scope path=$($_.FullName)"
          }
      }
    } else {
      Write-Log "No cache changes after retry reset."
      Invoke-PublishedDataVerification
    }
  }

  if ($Scope -eq "flow" -or $Scope -eq "institution" -or $Scope -eq "all") {
    Test-VercelCacheVisibility "data\institution-latest.json"
    Test-VercelCacheVisibility "data\institution-tdcc-breakout-top.json"
  }
  if ($Scope -eq "flow" -or $Scope -eq "warrant" -or $Scope -eq "all") {
    Test-VercelCacheVisibility "data\warrant-flow-latest.json"
  }

  if ($Scope -eq "strategy3" -or $Scope -eq "all") {
    Test-VercelCacheVisibility "data\strategy3-latest.json"
  }
  if ($Scope -eq "strategy5" -or $Scope -eq "all") {
    Test-VercelCacheVisibility "data\strategy5-latest.json"
  }
  if ($Scope -eq "cb" -or $Scope -eq "all") {
    Test-VercelCacheVisibility "data\cb-detect-latest.json"
  }

  if ($Scope -eq "strategy2") {
    Test-VercelCacheVisibility "data\strategy2-intraday-top.json"
    Test-VercelCacheVisibility "data\strategy2-intraday-live-top.json"
  }

  Invoke-PublishedDataVerification

  Write-Log "=== Cache sync end $(Get-Date) ==="
} finally {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}



