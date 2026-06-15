param(
  [string]$CommitMessage = "",
  [switch]$SkipDeploy,
  [switch]$ForceBump
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$root = $PSScriptRoot
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
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

function Invoke-MainReleaseChain {
  Invoke-ReleaseStep "npm run snapshot:data" { npm run snapshot:data }

  $releaseArgs = @("run", "release:main", "--")
  if ($CommitMessage) {
    $releaseArgs += @("-CommitMessage", $CommitMessage)
  }
  if ($SkipDeploy) {
    $releaseArgs += "-SkipDeploy"
  }
  if ($ForceBump) {
    $releaseArgs += "-ForceBump"
  }

  Invoke-ReleaseStep "npm run release:main" { npm @releaseArgs }
}

Push-Location $root
try {
  Enter-Lock
  Write-ReleaseLog "Auto main release started root=$root"
  Write-ReleaseLog "Daily publish chain is delegated to npm run release:main: main -> bump -> deploy -> live verify -> push GitHub."
  Invoke-MainReleaseChain
  Write-ReleaseLog "Auto main release complete."
} finally {
  Pop-Location
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  Write-ReleaseLog "Log: $log"
}
