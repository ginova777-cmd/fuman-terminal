param(
  [string]$CommitMessage = "",
  [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$root = $PSScriptRoot
$terminalRoot = if ($env:FUMAN_MAIN_DEPLOY_REPO) { $env:FUMAN_MAIN_DEPLOY_REPO } else { "C:\fuman-terminal" }
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$gitExe = "C:\Program Files\Git\cmd\git.exe"
$logDir = Join-Path $runtimeRoot "logs"
$lockFile = Join-Path $runtimeRoot "locks\auto-main-release.lock"
$log = Join-Path $logDir ("auto-main-release-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lockFile) | Out-Null

function Write-ReleaseLog($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Invoke-ReleaseStep($label, [scriptblock]$command) {
  Write-ReleaseLog "START $label"
  & $command *>&1 | ForEach-Object {
    Write-Host $_
    Add-Content -LiteralPath $log -Value ([string]$_) -Encoding utf8
  }
  $exitCode = $LASTEXITCODE
  Write-ReleaseLog "END $label exit=$exitCode"
  if ($exitCode -ne 0) {
    throw "$label failed with exit code $exitCode"
  }
}

function Invoke-Npm($scriptName) {
  Invoke-ReleaseStep "npm run $scriptName" { npm run $scriptName }
}

function Invoke-NpmAt($workingRoot, $scriptName) {
  Push-Location $workingRoot
  try {
    $previousAllowDeployRoot = $env:FUMAN_ALLOW_DEPLOY_ROOT
    try {
      if ($scriptName -eq "deploy") {
        $env:FUMAN_ALLOW_DEPLOY_ROOT = "1"
      }
      Invoke-Npm $scriptName
    } finally {
      if ($null -eq $previousAllowDeployRoot) {
        Remove-Item Env:FUMAN_ALLOW_DEPLOY_ROOT -ErrorAction SilentlyContinue
      } else {
        $env:FUMAN_ALLOW_DEPLOY_ROOT = $previousAllowDeployRoot
      }
    }
  } finally {
    Pop-Location
  }
}

function Invoke-Strategy4FullScan {
  $previous = @{
    STRATEGY4_SUPABASE_FIRST = $env:STRATEGY4_SUPABASE_FIRST
    STRATEGY4_SUPABASE_SKIP_RETRY = $env:STRATEGY4_SUPABASE_SKIP_RETRY
    STRATEGY4_ALLOW_PARTIAL_PUBLISH = $env:STRATEGY4_ALLOW_PARTIAL_PUBLISH
    STRATEGY4_FAIL_ON_INCOMPLETE = $env:STRATEGY4_FAIL_ON_INCOMPLETE
    FULL_SCAN = $env:FULL_SCAN
    STRATEGY4_SUPABASE_URL = $env:STRATEGY4_SUPABASE_URL
  }
  try {
    $env:STRATEGY4_SUPABASE_FIRST = "1"
    $env:STRATEGY4_SUPABASE_SKIP_RETRY = "1"
    $env:STRATEGY4_ALLOW_PARTIAL_PUBLISH = "1"
    $env:STRATEGY4_FAIL_ON_INCOMPLETE = "0"
    $env:FULL_SCAN = "1"
    if (-not $env:STRATEGY4_SUPABASE_URL) {
      $env:STRATEGY4_SUPABASE_URL = "https://cpmpfhbzutkiecccekfr.supabase.co"
    }
    Invoke-ReleaseStep "strategy4 full scan" { & "C:\Program Files\nodejs\node.exe" (Join-Path $root "scripts\scan-strategy4-cache.js") }
  } finally {
    foreach ($key in $previous.Keys) {
      if ($null -eq $previous[$key]) {
        Remove-Item "Env:$key" -ErrorAction SilentlyContinue
      } else {
        Set-Item "Env:$key" $previous[$key]
      }
    }
  }
}

function Invoke-Git($label, [string[]]$arguments) {
  Invoke-ReleaseStep $label { & $gitExe -C $root @arguments }
}

function Get-GitLines([string[]]$arguments) {
  $output = & $gitExe -C $root @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($arguments -join ' ') failed"
  }
  return @($output | Where-Object { [string]$_ -ne "" })
}

function Save-Changes($message) {
  Invoke-Git "git add changes" @("add", "-A")
  $staged = Get-GitLines @("diff", "--cached", "--name-only")
  if ($staged.Count -eq 0) {
    Write-ReleaseLog "No staged changes for commit."
    return $false
  }
  Invoke-Git "git commit" @("commit", "-m", $message)
  return $true
}

function Enter-Lock {
  if (Test-Path -LiteralPath $lockFile) {
    $age = (Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime
    if ($age.TotalMinutes -lt 60) {
      Write-ReleaseLog "Another auto main release appears to be running; skipping. lock=$lockFile"
      exit 0
    }
    Write-ReleaseLog "Removing stale auto main release lock age=$([math]::Round($age.TotalMinutes, 1))m"
    Remove-Item -LiteralPath $lockFile -Force
  }
  [ordered]@{
    pid = $PID
    startedAt = (Get-Date).ToString("o")
    log = $log
  } | ConvertTo-Json -Compress | Set-Content -LiteralPath $lockFile -Encoding utf8
}

Push-Location $root
try {
  Enter-Lock
  Write-ReleaseLog "Auto main release started root=$root terminalRoot=$terminalRoot"

  Invoke-Git "git fetch origin main" @("fetch", "origin", "main")
  $dirtyBeforePull = (Get-GitLines @("status", "--porcelain=v1")).Count
  if ($dirtyBeforePull -eq 0) {
    Invoke-Git "git pull --ff-only origin main" @("pull", "--ff-only", "origin", "main")
  } else {
    $behind = Get-GitLines @("rev-list", "--count", "HEAD..origin/main")
    if (([int]$behind[0]) -gt 0) {
      throw "Local tree has uncommitted changes and is behind origin/main; refusing automatic release."
    }
    Write-ReleaseLog "Dirty tree detected but not behind origin/main; continuing with local generated changes."
  }

  Invoke-Strategy4FullScan
  Invoke-Npm "bump:version"
  Invoke-Npm "sync:source"
  Invoke-Npm "verify:version"
  Invoke-Npm "verify:sw"
  Invoke-Npm "verify:data-freshness"
  Invoke-Npm "verify:source-sync"

  if (-not $SkipDeploy) {
    Invoke-NpmAt $terminalRoot "deploy"
  } else {
    Write-ReleaseLog "SkipDeploy selected; deploy skipped."
  }

  Invoke-Npm "verify:live-version"
  $message = if ($CommitMessage) { $CommitMessage } else { "Auto terminal release $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
  [void](Save-Changes $message)

  Invoke-Npm "freshness:gate:fast"
  Invoke-Npm "verify:data-freshness:live"
  [void](Save-Changes "Refresh live freshness gate $(Get-Date -Format 'yyyy-MM-dd HH:mm')")

  Invoke-Git "git push origin HEAD:main" @("push", "origin", "HEAD:main")
  Write-ReleaseLog "Auto main release complete."
} finally {
  Pop-Location
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  Write-ReleaseLog "Log: $log"
}
