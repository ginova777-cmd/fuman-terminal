param(
  [ValidateSet("all", "flow", "institution", "warrant", "openBuy", "strategy3", "strategy4")]
  [string]$Scope = "all"
)

$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false

$sourceRepo = "C:\fuman-runtime"
$codeRepo = "C:\fuman-terminal"
$syncRepo = "C:\fuman-terminal-sync"
$publishToCodeRepo = $env:CACHE_SYNC_WRITE_CODE_REPO -eq "1"
$repoUrl = "https://github.com/ginova777-cmd/fuman-terminal.git"
$logDir = Join-Path $sourceRepo "logs"
$lockFile = Join-Path $sourceRepo "locks\cache-sync.lock"
$outboxRoot = Join-Path $sourceRepo "outbox\cache-sync"
$gitExe = "C:\Program Files\Git\cmd\git.exe"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("cache-sync-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$gitRetryCount = if ($env:CACHE_SYNC_GIT_RETRY_COUNT -match '^\d+$') { [int]$env:CACHE_SYNC_GIT_RETRY_COUNT } else { 5 }
$gitRetryDelaySeconds = if ($env:CACHE_SYNC_GIT_RETRY_DELAY_SECONDS -match '^\d+$') { [int]$env:CACHE_SYNC_GIT_RETRY_DELAY_SECONDS } else { 45 }

function Write-Log($message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
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

function Save-OutboxSnapshot($reason, $dataFiles, $localPublishedFiles) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $snapshotDir = Join-Path (Get-OutboxScopeDir) $stamp
  New-Item -ItemType Directory -Force -Path $snapshotDir | Out-Null
  $savedFiles = New-Object System.Collections.Generic.List[string]

  foreach ($file in $dataFiles) {
    $source = Join-Path $sourceRepo $file
    if (Test-Path -LiteralPath $source) {
      $target = Join-Path $snapshotDir $file
      New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
      Copy-Item -LiteralPath $source -Destination $target -Force
      $savedFiles.Add($file) | Out-Null
    }
  }

  foreach ($file in $localPublishedFiles) {
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
  if ($file -notlike "data\open-buy-*.json") { return }
  $maxBytes = 1048576
  $parsedMaxBytes = 0
  if ([int64]::TryParse($env:OPEN_BUY_SYNC_MAX_BYTES, [ref]$parsedMaxBytes) -and $parsedMaxBytes -gt 0) {
    $maxBytes = $parsedMaxBytes
  }
  $size = (Get-Item -LiteralPath $source).Length
  if ($size -gt $maxBytes) {
    throw "$file is too large for openBuy sync: $size bytes > $maxBytes bytes"
  }
}

function Copy-CacheFile($file, $source, $targetRoot, $label) {
  Assert-CacheFileSize $file $source
  $target = Join-Path $targetRoot $file
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
  Assert-CopiedFile "$label $file" $source $target
}
function Copy-CodeRepoCacheFile($file, $source, $label) {
  if ($publishToCodeRepo) {
    Copy-CacheFile $file $source $codeRepo $label
    return
  }
  Write-Log "Skipping code repo cache copy ($label): $file"
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

function Test-VercelCacheVisibility($file) {
  $baseUrl = $env:FUMAN_VERCEL_BASE_URL
  if (-not $baseUrl) { $baseUrl = "https://fuman-terminal.vercel.app" }
  $localPath = Join-Path $syncRepo $file
  if (-not (Test-Path -LiteralPath $localPath)) {
    Write-Log "VERCEL_VISIBLE_SKIPPED file=$file reason=missing-local-sync-file"
    return
  }

  $urlPath = ($file -replace "\\", "/")
  $url = "$($baseUrl.TrimEnd('/'))/$urlPath?v=$(Get-Date -Format yyyyMMddHHmmss)"
  try {
    Write-Log "=== Vercel visibility check $file $(Get-Date) ==="
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
      Write-Log "VERCEL_VISIBLE_OK file=$file updatedAt=$($remoteJson.updatedAt) usedDate=$($remoteJson.usedDate) count=$remoteCount"
    } else {
      Write-Log "VERCEL_VISIBLE_WARN file=$file remote differs from pushed cache localUpdatedAt=$($localJson.updatedAt) remoteUpdatedAt=$($remoteJson.updatedAt) localCount=$localCount remoteCount=$remoteCount"
    }
  } catch {
    Write-Log "VERCEL_VISIBLE_WARN file=$file check failed: $($_.Exception.Message)"
  }
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

if (Test-Path $lockFile) {
  $age = (Get-Date) - (Get-Item $lockFile).LastWriteTime
  if ($age.TotalMinutes -lt 30) {
    Write-Log "Another cache sync appears to be running; lock age $([math]::Round($age.TotalMinutes, 1)) minutes."
    exit 0
  }
  Remove-Item -LiteralPath $lockFile -Force
}

New-Item -ItemType File -Force -Path $lockFile | Out-Null

try {
  Write-Log "=== Cache sync start $(Get-Date) scope=$Scope ==="

  if ($Scope -eq "flow") {
    $criticalLatestFiles = @(
      "data\institution-latest.json",
      "data\warrant-flow-latest.json"
    )

    $dataFiles = @(
      "data\institution-latest.json",
      "data\institution-backup.json",
      "data\warrant-flow-latest.json",
      "data\warrant-flow-backup.json"
    )
  } elseif ($Scope -eq "institution") {
    $criticalLatestFiles = @(
      "data\institution-latest.json"
    )

    $dataFiles = @(
      "data\institution-latest.json",
      "data\institution-backup.json"
    )
  } elseif ($Scope -eq "warrant") {
    $criticalLatestFiles = @(
      "data\warrant-flow-latest.json"
    )

    $dataFiles = @(
      "data\warrant-flow-latest.json",
      "data\warrant-flow-backup.json"
    )
  } elseif ($Scope -eq "openBuy") {
    $criticalLatestFiles = @(
      "data\open-buy-latest.json"
    )

    $dataFiles = @(
      "data\open-buy-latest.json",
      "data\open-buy-backup.json",
      "data\open-buy-scorecard-source.json"
    )
  } elseif ($Scope -eq "strategy3") {
    $criticalLatestFiles = @(
      "data\strategy3-latest.json"
    )

    $dataFiles = @(
      "data\strategy3-latest.json",
      "data\strategy3-backup.json",
      "data\strategy3-scorecard-source.json"
    )
  } elseif ($Scope -eq "strategy4") {
    $criticalLatestFiles = @(
      "data\strategy4-latest.json"
    )

    $dataFiles = @(
      "data\strategy4-latest.json",
      "data\strategy4-backup.json"
    )
  } else {
    $criticalLatestFiles = @(
      "data\institution-latest.json",
      "data\warrant-flow-latest.json",
      "data\open-buy-latest.json",
      "data\strategy3-latest.json",
      "data\strategy4-latest.json",
      "data\strategy5-latest.json"
    )

    $dataFiles = @(
      "data\institution-latest.json",
      "data\institution-backup.json",
      "data\warrant-flow-latest.json",
      "data\warrant-flow-backup.json",
      "data\open-buy-latest.json",
      "data\open-buy-backup.json",
      "data\open-buy-scorecard-source.json",
      "data\strategy3-latest.json",
      "data\strategy3-backup.json",
      "data\strategy3-scorecard-source.json",
      "data\strategy2-scorecard-source.json",
      "data\strategy4-latest.json",
      "data\strategy4-backup.json",
      "data\strategy5-latest.json",
      "data\strategy5-backup.json",
      "data\realtime-radar-latest.json"
    )
  }

  $copiedFiles = New-Object System.Collections.Generic.List[string]
  $localPublishedFiles = @()
  if ($env:SYNC_STRATEGY2_FULL_LATEST -eq "1") {
    $localPublishedFiles += "data\strategy2-intraday-latest.json"
  }
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
  Run-Git "Reset clean sync repository" @("reset", "--hard", "origin/main")
  Run-Git "Clean generated sync repository files" @("clean", "-fd")

  Replay-OutboxSnapshots

  foreach ($file in $dataFiles) {
    $source = Join-Path $sourceRepo $file
    $target = Join-Path $syncRepo $file
    if (-not (Test-Path $source)) {
      Write-Log "Missing source file, skipped: $source"
      continue
    }
    if (Should-SkipCacheFile $file $source) {
      continue
    }
    Copy-CacheFile $file $source $syncRepo "sync"
    Copy-CodeRepoCacheFile $file $source "local"
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

  foreach ($requiredFile in $criticalLatestFiles) {
    if ((Test-Path (Join-Path $sourceRepo $requiredFile)) -and (-not $copiedFiles.Contains($requiredFile))) {
      throw "$requiredFile was not copied; refusing to publish partial latest cache set."
    }
  }

  Run-Git "Stage cache files" (@("add", "-f") + $dataFiles + $localPublishedFiles)

  $changed = & $gitExe -C $syncRepo diff --cached --name-only -- ($dataFiles + $localPublishedFiles)
  if (-not $changed) {
    Write-Log "No cache changes to sync."
    exit 0
  }

  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
  Run-Git "Commit cache files" @("commit", "-m", "Update scheduled cache $stamp")

  try {
    Run-GitWithRetry "Push cache commit" @("push", "origin", "main")
  } catch {
    Write-Log "Push failed; resetting to latest origin/main, replaying cache files, and retrying once."
    Save-OutboxSnapshot "push failed: $($_.Exception.Message)" $dataFiles $localPublishedFiles
    Run-GitWithRetry "Fetch origin main after push failure" @("fetch", "origin", "main")
    Run-Git "Reset after push failure" @("reset", "--hard", "origin/main")
    foreach ($file in $dataFiles) {
      $source = Join-Path $sourceRepo $file
      $target = Join-Path $syncRepo $file
      if (Test-Path $source) {
        if (Should-SkipCacheFile $file $source) {
          continue
        }
        Copy-CacheFile $file $source $syncRepo "sync retry"
        Copy-CodeRepoCacheFile $file $source "local retry"
      }
    }
    foreach ($file in $localPublishedFiles) {
      $source = Join-Path $codeRepo $file
      if (Test-Path $source) {
        Copy-CacheFile $file $source $syncRepo "local-published retry"
      }
    }
    Run-Git "Stage cache files after retry reset" (@("add", "-f") + $dataFiles + $localPublishedFiles)
    $retryChanged = & $gitExe -C $syncRepo diff --cached --name-only -- ($dataFiles + $localPublishedFiles)
    if ($retryChanged) {
      Run-Git "Commit cache files after retry reset" @("commit", "-m", "Update scheduled cache $stamp retry")
      Run-GitWithRetry "Retry push cache commit" @("push", "origin", "main")
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
    }
  }

  if ($Scope -eq "flow" -or $Scope -eq "institution" -or $Scope -eq "all") {
    Test-VercelCacheVisibility "data\institution-latest.json"
  }
  if ($Scope -eq "flow" -or $Scope -eq "warrant" -or $Scope -eq "all") {
    Test-VercelCacheVisibility "data\warrant-flow-latest.json"
  }

  if ($Scope -eq "strategy3" -or $Scope -eq "all") {
    Test-VercelCacheVisibility "data\strategy3-latest.json"
  }

  Write-Log "=== Cache sync end $(Get-Date) ==="
} finally {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}

