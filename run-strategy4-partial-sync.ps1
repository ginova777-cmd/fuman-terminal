$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false

$codeRepo = "${PSScriptRoot}"
$syncRepo = if ($env:FUMAN_PUBLISH_SYNC_REPO) { $env:FUMAN_PUBLISH_SYNC_REPO } else { "C:\fuman-terminal-publish-sync" }
$gitExe = "C:\Program Files\Git\cmd\git.exe"
$logDir = Join-Path $codeRepo "logs"
$lockFile = Join-Path $codeRepo "locks\strategy4-partial-sync.lock"
$files = @("data\strategy4-latest.json", "data\strategy4-summary.json", "data\strategy4-slim.json", "data\strategy4-backup.json")

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $lockFile -Parent) | Out-Null
$log = Join-Path $logDir ("strategy4-partial-sync-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Write-Log($message) {
  $message | Tee-Object -FilePath $log -Append
}

function Run-Git($description, $arguments) {
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
  $psi.WorkingDirectory = $syncRepo
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

function Test-Json($path) {
  try {
    $null = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -ErrorAction Stop
    return $true
  } catch {
    Write-Log "Invalid JSON skipped: $path :: $($_.Exception.Message)"
    return $false
  }
}

if (Test-Path $lockFile) {
  $age = (Get-Date) - (Get-Item $lockFile).LastWriteTime
  if ($age.TotalMinutes -lt 10) {
    Write-Log "Another strategy4 partial sync is running; lock age $([math]::Round($age.TotalMinutes, 1)) minutes."
    exit 0
  }
  Remove-Item -LiteralPath $lockFile -Force
}

New-Item -ItemType File -Force -Path $lockFile | Out-Null

try {
  Write-Log "=== Strategy4 partial sync start $(Get-Date) ==="

  if (-not (Test-Path (Join-Path $syncRepo ".git"))) {
    throw "$syncRepo is not a git repository."
  }

  Run-Git "Fetch origin main" @("fetch", "origin", "main")
  Run-Git "Reset sync repository" @("reset", "--hard", "origin/main")

  $copied = New-Object System.Collections.Generic.List[string]
  foreach ($file in $files) {
    $source = Join-Path $codeRepo $file
    if (-not (Test-Path $source)) {
      Write-Log "Missing source file, skipped: $source"
      continue
    }
    if (-not (Test-Json $source)) {
      continue
    }
    $target = Join-Path $syncRepo $file
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
    $copied.Add($file) | Out-Null
    Write-Log "Copied $file"
  }

  if (-not $copied.Contains("data\strategy4-latest.json")) {
    throw "strategy4-latest.json was not copied; refusing to publish."
  }

  Run-Git "Stage strategy4 cache" (@("add") + $files)
  $changed = & $gitExe -C $syncRepo diff --cached --name-only -- $files
  if (-not $changed) {
    Write-Log "No strategy4 cache changes to sync."
    exit 0
  }

  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Run-Git "Commit strategy4 cache" @("commit", "-m", "Update strategy4 cache $stamp")
  Run-Git "Push strategy4 cache" @("push", "origin", "main")
  Write-Log "=== Strategy4 partial sync end $(Get-Date) ==="
} finally {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
