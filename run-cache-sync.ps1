param(
  [ValidateSet("all", "strategy3", "strategy4")]
  [string]$Scope = "all"
)

$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false

$sourceRepo = "C:\fuman-runtime"
$codeRepo = "C:\fuman-terminal"
$syncRepo = "C:\fuman-terminal-sync"
$repoUrl = "https://github.com/ginova777-cmd/fuman-terminal.git"
$logDir = Join-Path $sourceRepo "logs"
$lockFile = Join-Path $sourceRepo "locks\cache-sync.lock"
$gitExe = "C:\Program Files\Git\cmd\git.exe"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("cache-sync-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Write-Log($message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Run-Git($description, $arguments, $cwd = $syncRepo) {
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
  if ($process.ExitCode -ne 0) {
    throw "$description failed with exit code $($process.ExitCode)"
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

function Copy-CacheFile($file, $source, $targetRoot, $label) {
  $target = Join-Path $targetRoot $file
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
  Assert-CopiedFile "$label $file" $source $target
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

  if ($Scope -eq "strategy3") {
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
      "data\strategy4-latest.json",
      "data\strategy4-backup.json",
      "data\strategy5-latest.json",
      "data\strategy5-backup.json",
      "data\realtime-radar-latest.json"
    )
  }

  $copiedFiles = New-Object System.Collections.Generic.List[string]
  $localPublishedFiles = @(
    "data\strategy2-intraday-latest.json"
  )

  if (-not (Test-Path (Join-Path $syncRepo ".git"))) {
    if (Test-Path $syncRepo) {
      throw "$syncRepo exists but is not a git repository. Rename or remove it before cache sync can initialize."
    }
    Run-Git "Clone clean sync repository" @("clone", $repoUrl, $syncRepo) (Split-Path $syncRepo -Parent)
  }

  Run-Git "Fetch origin main" @("fetch", "origin", "main")
  Run-Git "Reset clean sync repository" @("reset", "--hard", "origin/main")
  Run-Git "Clean generated sync repository files" @("clean", "-fd")

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
    Copy-CacheFile $file $source $codeRepo "local"
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
    Run-Git "Push cache commit" @("push", "origin", "main")
  } catch {
    Write-Log "Push failed; resetting to latest origin/main, replaying cache files, and retrying once."
    Run-Git "Fetch origin main after push failure" @("fetch", "origin", "main")
    Run-Git "Reset after push failure" @("reset", "--hard", "origin/main")
    foreach ($file in $dataFiles) {
      $source = Join-Path $sourceRepo $file
      $target = Join-Path $syncRepo $file
      if (Test-Path $source) {
        if (Should-SkipCacheFile $file $source) {
          continue
        }
        Copy-CacheFile $file $source $syncRepo "sync retry"
        Copy-CacheFile $file $source $codeRepo "local retry"
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
      Run-Git "Retry push cache commit" @("push", "origin", "main")
    } else {
      Write-Log "No cache changes after retry reset."
    }
  }

  Write-Log "=== Cache sync end $(Get-Date) ==="
} finally {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}






