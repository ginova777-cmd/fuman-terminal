param(
  [string]$Source = "scanner",
  [string]$LogPath = "",
  [switch]$AllowFailure,
  [switch]$SkipVerify,
  [int]$VerifyMaxAgeSeconds = 600
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $runtime "data" }
$env:FUMAN_CACHE_DIR = if ($env:FUMAN_CACHE_DIR) { $env:FUMAN_CACHE_DIR } else { Join-Path $runtime "cache" }
$env:FUMAN_STATE_DIR = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $runtime "state" }
$env:NODE_OPTIONS = "--use-system-ca"

$nodeExe = "C:\Program Files\nodejs\node.exe"
$receiptDir = Join-Path $runtime "data\scan-receipts"
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null

function Write-SnapshotLog($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  if ($LogPath) {
    Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
  } else {
    Write-Host $line
  }
}

$safeSource = ([string]$Source).Trim()
if (-not $safeSource) { $safeSource = "scanner" }
$routeBySource = @{
  "open-buy" = "strategy1"
  "strategy1" = "strategy1"
  "strategy3" = "strategy3"
  "strategy4" = "strategy4"
  "strategy5" = "strategy5"
  "institution" = "institution"
  "warrant" = "warrant"
  "warrant-flow" = "warrant"
  "cb" = "cb"
  "cb-detect" = "cb"
}
$routeKey = $routeBySource[$safeSource.ToLowerInvariant()]

Write-SnapshotLog "Desktop route snapshot refresh start source=$safeSource"
Push-Location $PSScriptRoot
try {
  $exitCode = 1
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    if ($attempt -gt 1) {
      Write-SnapshotLog "Desktop route snapshot refresh retry source=$safeSource attempt=$attempt"
      Start-Sleep -Seconds 5
    }
    & $nodeExe "scripts\write-desktop-route-snapshot.js" "--fail-on-partial" "--source=$safeSource" 2>&1 | ForEach-Object {
      $text = [string]$_
      if ($LogPath) {
        Add-Content -LiteralPath $LogPath -Value $text -Encoding utf8
      } else {
        Write-Host $text
      }
    }
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) { break }
  }
} finally {
  Pop-Location
}

if ($exitCode -ne 0) {
  Write-SnapshotLog "Desktop route snapshot refresh failed source=$safeSource exit=$exitCode"
  if (-not $AllowFailure) { exit $exitCode }
} else {
  Write-SnapshotLog "Desktop route snapshot refresh ok source=$safeSource"
  if (-not $SkipVerify) {
    $verifyScript = Join-Path $PSScriptRoot "scripts\verify-post-scan-snapshot-refresh-contract.js"
    if (-not (Test-Path -LiteralPath $verifyScript)) {
      Write-SnapshotLog "Post-scan snapshot refresh contract verifier missing source=$safeSource"
      if (-not $AllowFailure) { exit 90 }
    } else {
      $maxAgeMs = [Math]::Max(0, $VerifyMaxAgeSeconds * 1000)
      $verifyArgs = @("scripts\verify-post-scan-snapshot-refresh-contract.js", "--max-age-ms=$maxAgeMs")
      if ($routeKey) { $verifyArgs += "--routes=$routeKey" }
      $routeLabel = if ($routeKey) { $routeKey } else { "all" }
      Write-SnapshotLog "Post-scan snapshot refresh contract verify start source=$safeSource routes=$routeLabel"
      Push-Location $PSScriptRoot
      try {
        & $nodeExe @verifyArgs 2>&1 | ForEach-Object {
          $text = [string]$_
          if ($LogPath) {
            Add-Content -LiteralPath $LogPath -Value $text -Encoding utf8
          } else {
            Write-Host $text
          }
        }
        $verifyExitCode = $LASTEXITCODE
      } finally {
        Pop-Location
      }
      if ($verifyExitCode -ne 0) {
        Write-SnapshotLog "Post-scan snapshot refresh contract failed source=$safeSource exit=$verifyExitCode"
        if (-not $AllowFailure) { exit $verifyExitCode }
      } else {
        Write-SnapshotLog "Post-scan snapshot refresh contract ok source=$safeSource"
      }
    }
  }
}

exit 0
