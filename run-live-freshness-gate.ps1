param(
  [switch]$SkipRealtime,
  [switch]$SkipStrategy2,
  [switch]$SkipWarrant,
  [switch]$SkipInstitution,
  [switch]$SkipTerminalCopy,
  [switch]$Fast
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$syncRoot = $PSScriptRoot
$publishRoot = if ($env:FUMAN_PUBLISH_SYNC_REPO) { $env:FUMAN_PUBLISH_SYNC_REPO } else { "C:\fuman-terminal-publish-sync" }
$terminalRoot = if ($env:FUMAN_MAIN_DEPLOY_REPO) { $env:FUMAN_MAIN_DEPLOY_REPO } else { "C:\fuman-terminal" }
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$lockFile = Join-Path $runtimeRoot "locks\live-freshness-gate.lock"
$logDir = Join-Path $runtimeRoot "logs"
$log = Join-Path $logDir ("live-freshness-gate-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$nodeExe = "C:\Program Files\nodejs\node.exe"
$gitExe = "C:\Program Files\Git\cmd\git.exe"
$rawRefreshResults = New-Object System.Collections.Generic.List[object]

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lockFile) | Out-Null

function Write-GateLog($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Read-GateLock {
  if (-not (Test-Path -LiteralPath $lockFile)) { return $null }
  try {
    $raw = Get-Content -LiteralPath $lockFile -Raw -ErrorAction Stop
    if ($raw.Trim().StartsWith("{")) { return $raw | ConvertFrom-Json }
  } catch {}
  return $null
}

function Test-GateLockOwnerAlive($lockInfo) {
  $pidValue = 0
  if ($lockInfo -and $lockInfo.pid) { [void][int]::TryParse([string]$lockInfo.pid, [ref]$pidValue) }
  if ($pidValue -le 0) { return $true }
  return [bool](Get-Process -Id $pidValue -ErrorAction SilentlyContinue)
}

function Enter-GateLock {
  if (Test-Path -LiteralPath $lockFile) {
    $lockInfo = Read-GateLock
    $age = (Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime
    if ((-not (Test-GateLockOwnerAlive $lockInfo)) -or $age.TotalMinutes -ge 30) {
      Write-GateLog "Removing stale live freshness gate lock age=$([math]::Round($age.TotalMinutes, 1))m"
      Remove-Item -LiteralPath $lockFile -Force
    } else {
      Write-GateLog "Another live freshness gate is already running; skipping this overlapping run. lock=$lockFile pid=$($lockInfo.pid) log=$($lockInfo.log)"
      exit 0
    }
  }
  [ordered]@{
    pid = $PID
    startedAt = (Get-Date).ToString("o")
    log = $log
  } | ConvertTo-Json -Compress | Set-Content -LiteralPath $lockFile -Encoding utf8
}

function Invoke-GateCommand($label, [scriptblock]$command, [switch]$AllowFailure) {
  Write-GateLog "START $label"
  $exitCode = 0
  try {
    & $command *>&1 | ForEach-Object {
      $text = [string]$_
      Write-Host $text
      Add-Content -LiteralPath $log -Value $text -Encoding utf8
    }
    $exitCode = $LASTEXITCODE
  } catch {
    $text = [string]$_.Exception.Message
    Write-Host $text
    Add-Content -LiteralPath $log -Value $text -Encoding utf8
    $exitCode = 1
    if (-not $AllowFailure) {
      Write-GateLog "END $label exit=$exitCode"
      throw
    }
  }
  Write-GateLog "END $label exit=$exitCode"
  if ($label -like "*raw refresh") {
    $rawRefreshResults.Add([ordered]@{
      label = $label
      ok = ($exitCode -eq 0)
      exitCode = $exitCode
      checkedAt = (Get-Date).ToString("o")
    }) | Out-Null
  }
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "$label failed with exit code $exitCode"
  }
  return $exitCode
}

function Invoke-NpmAt($root, $scriptName) {
  Push-Location $root
  try {
    Invoke-GateCommand "npm run $scriptName ($root)" { npm run $scriptName }
  } finally {
    Pop-Location
  }
}

function Assert-Path($path, $label) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "$label missing: $path"
  }
}

function Set-FumanRuntimeEnv {
  $env:FUMAN_RUNTIME_DIR = $runtimeRoot
  $env:FUMAN_DATA_DIR = Join-Path $runtimeRoot "data"
  $env:FUMAN_CACHE_DIR = Join-Path $runtimeRoot "cache"
  $env:FUMAN_STATE_DIR = Join-Path $runtimeRoot "state"
  $env:NODE_OPTIONS = "--use-system-ca"
}

function Set-Strategy2IntradayEnv {
  $env:INTRADAY_PATROL_INTERVAL_MS = "3000"
  $env:STRATEGY2_SCAN_START_MINUTES = "525"
  $env:STRATEGY2_ENTRY_START_MINUTES = "545"
  $env:STRATEGY2_ENTRY_END_MINUTES = "720"
  $env:STRATEGY2_SCAN_END_MINUTES = "720"
  $env:STRATEGY2_REALTIME_FUGLE_ONLY = "1"
  $env:STRATEGY2_REALTIME_FALLBACK_CANDIDATE_LIMIT = "1200"
  $env:STRATEGY2_1M_WARMUP_LIMIT = "120"
  $env:STRATEGY2_REALTIME_BATCH_SIZE = "12"
  $env:STRATEGY2_REALTIME_RETRY_BATCH_SIZE = "4"
  $env:STRATEGY2_REALTIME_BATCH_CONCURRENCY = "3"
  $env:STRATEGY2_MIN_REALTIME_COVERAGE = "0.25"
  $env:STRATEGY2_REALTIME_RESCUE_COVERAGE = "0.70"
  $env:STRATEGY2_REALTIME_RESCUE_LIMIT = "300"
  $env:STRATEGY2_REALTIME_RESCUE_COOLDOWN_MS = "30000"
  $env:STRATEGY2_ENABLE_FINMIND_REALTIME = "0"
  $env:STRATEGY2_ENABLE_FINMIND_RESCUE = "0"
  $env:STRATEGY2_MIN_ENTRY_SOURCE_COVERAGE = "0.50"
  $env:STRATEGY2_HISTORY_WRITE_INTERVAL_MS = "60000"
}

Assert-Path $publishRoot "publish root"
Assert-Path $terminalRoot "terminal root"
Assert-Path $nodeExe "node"
Assert-Path $gitExe "git"

Enter-GateLock

try {
  Write-GateLog "Live freshness gate started"
  Write-GateLog "syncRoot=$syncRoot publishRoot=$publishRoot terminalRoot=$terminalRoot"
  Set-FumanRuntimeEnv

  if (-not $SkipRealtime) {
    $env:REALTIME_RADAR_PATROL_INTERVAL_MS = "3000"
    Push-Location $syncRoot
    try {
      $null = Invoke-GateCommand "realtime radar raw refresh" { & $nodeExe "scripts\patrol-realtime-radar-cache.js" } -AllowFailure
    } finally {
      Pop-Location
    }
  }

  if (-not $SkipStrategy2) {
    Set-Strategy2IntradayEnv
    Push-Location $syncRoot
    try {
      $null = Invoke-GateCommand "strategy2 intraday raw refresh" { & $nodeExe "scripts\patrol-intraday-signals.js" } -AllowFailure
    } finally {
      Pop-Location
    }
  }

  if (-not $SkipInstitution) {
    Push-Location $syncRoot
    try {
      $null = Invoke-GateCommand "institution raw refresh" { & $nodeExe "scripts\scan-institution-cache.js" } -AllowFailure
    } finally {
      Pop-Location
    }
  }

  if (-not $SkipWarrant) {
    Push-Location $syncRoot
    try {
      $null = Invoke-GateCommand "warrant flow raw refresh" { & $nodeExe "scripts\scan-warrant-flow-cache.js" } -AllowFailure
    } finally {
      Pop-Location
    }
  }

  if (-not $Fast) {
    Push-Location $syncRoot
    try {
      $null = Invoke-GateCommand "open buy raw refresh" { & $nodeExe "scripts\scan-open-buy-cache.js" } -AllowFailure
      $null = Invoke-GateCommand "strategy3 raw refresh" { & $nodeExe "scripts\scan-strategy3-cache.js" } -AllowFailure
      $null = Invoke-GateCommand "strategy4 raw refresh" { & $nodeExe "scripts\scan-strategy4-cache.js" } -AllowFailure
      $previousStrategy5UseMis = $env:STRATEGY5_USE_MIS
      try {
        $env:STRATEGY5_USE_MIS = "0"
        $null = Invoke-GateCommand "strategy5 raw refresh" { & $nodeExe "scripts\scan-strategy5-cache.js" } -AllowFailure
      } finally {
        if ($null -eq $previousStrategy5UseMis) {
          Remove-Item Env:STRATEGY5_USE_MIS -ErrorAction SilentlyContinue
        } else {
          $env:STRATEGY5_USE_MIS = $previousStrategy5UseMis
        }
      }
      $null = Invoke-GateCommand "cb detect raw refresh" { & $nodeExe "scripts\generate-cb-detect.js" } -AllowFailure
    } finally {
      Pop-Location
    }
  } else {
    Write-GateLog "Fast gate selected; long raw scans skipped and existing verified caches will be reused."
  }

  $previousInsideGate = $env:FUMAN_INSIDE_FRESHNESS_GATE
  try {
    $env:FUMAN_INSIDE_FRESHNESS_GATE = "1"
    $syncExit = Invoke-GateCommand "cache sync all" { & (Join-Path $syncRoot "run-cache-sync.ps1") -Scope all } -AllowFailure
  } finally {
    if ($null -eq $previousInsideGate) {
      Remove-Item Env:FUMAN_INSIDE_FRESHNESS_GATE -ErrorAction SilentlyContinue
    } else {
      $env:FUMAN_INSIDE_FRESHNESS_GATE = $previousInsideGate
    }
  }
  if ($syncExit -ne 0) {
    $logText = Get-Content -LiteralPath $log -Raw
    if ($logText -match "Pre-publish data freshness gate failed|refusing to commit or push cache files") {
      throw "Pre-publish data freshness gate blocked the publish. Live data was not accepted. See log: $log"
    }
    Write-GateLog "cache sync returned non-zero after publish; final live freshness check is now authoritative"
  }

  Invoke-NpmAt $publishRoot "verify:data-freshness"
  Invoke-NpmAt $publishRoot "verify:data-freshness:live"
  Invoke-NpmAt $publishRoot "verify:live-version"

  $head = & $gitExe -C $publishRoot log -1 --oneline --decorate
  $statusPath = Join-Path $publishRoot "data\live-freshness-ok.json"
  $status = [ordered]@{
    ok = $true
    checkedAt = (Get-Date).ToString("o")
    publishHead = [string]$head
    verifier = "npm run verify:data-freshness:live"
    log = $log
    mode = if ($Fast) { "fast" } else { "full" }
    rawRefresh = @($rawRefreshResults)
  }
  $status | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statusPath -Encoding utf8

  if (-not $SkipTerminalCopy) {
    Write-GateLog "Copying verified publish data back to terminal root"
    Copy-Item -Path (Join-Path $publishRoot "data\*.json") -Destination (Join-Path $terminalRoot "data") -Force
    Invoke-NpmAt $terminalRoot "verify:data-freshness"
  }

  Write-GateLog "SUCCESS live freshness gate passed; publishHead=$head"
  Write-GateLog "Log: $log"
  exit 0
} catch {
  Write-GateLog "FAILED $($_.Exception.Message)"
  Write-GateLog "Log: $log"
  exit 1
} finally {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
