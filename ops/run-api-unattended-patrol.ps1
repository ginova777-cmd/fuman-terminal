param(
  [string]$Root = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$ProductionUrl = "https://fuman-terminal.vercel.app",
  [string]$ReleaseSha = "",
  [string]$ComputerLabel = $env:COMPUTERNAME,
  [string]$Checkpoint = "scheduled",
  [int]$TimeoutMs = 45000,
  [int]$VerifierTimeoutMs = 120000,
  [switch]$NoAlert,
  [switch]$DryRunAlert
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  param([string]$Path)
  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
  if (-not (Test-Path -LiteralPath (Join-Path $resolved "package.json"))) {
    throw "package.json not found under $resolved"
  }
  return $resolved.ProviderPath
}

function Invoke-Step {
  param(
    [string]$Name,
    [string]$Command,
    [string[]]$Arguments
  )

  Add-Content -LiteralPath $script:LogFile -Value ""
  Add-Content -LiteralPath $script:LogFile -Value ("[{0}] STEP {1}" -f (Get-Date -Format o), $Name)
  Add-Content -LiteralPath $script:LogFile -Value ("> {0} {1}" -f $Command, ($Arguments -join " "))

  & $Command @Arguments 2>&1 | Tee-Object -FilePath $script:LogFile -Append
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  if ($exitCode -ne 0) {
    throw "step $Name failed with exit code $exitCode"
  }
}

function Invoke-OptionalStep {
  param(
    [string]$Name,
    [string]$Command,
    [string[]]$Arguments
  )

  Add-Content -LiteralPath $script:LogFile -Value ""
  Add-Content -LiteralPath $script:LogFile -Value ("[{0}] OPTIONAL STEP {1}" -f (Get-Date -Format o), $Name)
  Add-Content -LiteralPath $script:LogFile -Value ("> {0} {1}" -f $Command, ($Arguments -join " "))

  & $Command @Arguments 2>&1 | Tee-Object -FilePath $script:LogFile -Append
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  if ($exitCode -ne 0) {
    Add-Content -LiteralPath $script:LogFile -Value ("[{0}] OPTIONAL STEP {1} recorded blocker exit={2}; preserving latest and continuing patrol" -f (Get-Date -Format o), $Name, $exitCode)
  }
  return $exitCode
}

function Write-PatrolState {
  param(
    [string]$Status,
    [string]$Message = ""
  )

  $payload = [ordered]@{
    ok = ($Status -eq "ok")
    status = $Status
    message = $Message
    checkpoint = $Checkpoint
    releaseSha = $ReleaseSha
    productionUrl = $ProductionUrl
    computer = $ComputerLabel
    checkedAt = (Get-Date).ToUniversalTime().ToString("o")
    logFile = $script:LogFile
  }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:StateFile -Encoding UTF8
}

function Send-FailureAlert {
  param([string]$Message)

  if ($NoAlert) {
    Add-Content -LiteralPath $script:LogFile -Value "[alert] skipped by -NoAlert"
    return
  }

  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    $node = Get-Command node -ErrorAction Stop
  }

  $receipt = Join-Path $script:ReceiptDir ("api-unattended-patrol-alert-{0}-{1}.json" -f $Checkpoint, (Get-Date -Format "yyyyMMdd-HHmmss"))
  $env:FUMAN_RUNTIME_DIR = $RuntimeDir
  $env:FUMAN_ALERT_KIND = "api-unattended-patrol"
  $env:FUMAN_ALERT_SOURCE = "Fuman API Unattended Patrol"
  $env:FUMAN_ALERT_SUBJECT = "Fuman API 無人值守巡邏失敗｜$Checkpoint"
  $env:FUMAN_ALERT_TEXT = @(
    "Fuman API 無人值守巡邏失敗",
    "",
    "checkpoint：$Checkpoint",
    "releaseSha：$ReleaseSha",
    "production：$ProductionUrl",
    "computer：$ComputerLabel",
    "message：$Message",
    "log：$script:LogFile",
    "",
    "這是 read-only 巡邏；代表 API scorecard、freshness contract、production guard 或 monitor 至少一項失敗。"
  ) -join "`n"

  $args = @("--use-system-ca", "scripts\send-workflow-alert.js", "--kind", "api-unattended-patrol", "--receipt", $receipt)
  if ($DryRunAlert) {
    $args += "--dry-run"
  }

  try {
    Invoke-Step -Name "failure-alert" -Command $node.Source -Arguments $args
  }
  catch {
    Add-Content -LiteralPath $script:LogFile -Value ("[alert] failed: {0}" -f ($_.Exception.Message))
  }
}

$repoRoot = Resolve-RepoRoot -Path $Root
if ([string]::IsNullOrWhiteSpace($ReleaseSha)) {
  $git = Get-Command git.exe -ErrorAction SilentlyContinue
  if (-not $git) {
    $git = Get-Command git -ErrorAction Stop
  }
  $ReleaseSha = (& $git.Source -C $repoRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ReleaseSha)) {
    throw "unable to resolve fixed release SHA from $repoRoot"
  }
}
$stateDir = Join-Path $RuntimeDir "state"
$reportDir = Join-Path $RuntimeDir "reports"
$logDir = Join-Path $RuntimeDir "logs"
$script:ReceiptDir = Join-Path $RuntimeDir "data\scan-receipts"
New-Item -ItemType Directory -Force -Path $stateDir, $reportDir, $logDir, $script:ReceiptDir | Out-Null

$safeCheckpoint = ($Checkpoint -replace "[^A-Za-z0-9_.-]", "_")
$safeComputer = ($ComputerLabel -replace "[^A-Za-z0-9_.-]", "_")
$script:LogFile = Join-Path $logDir ("api-unattended-patrol-{0}-{1}-{2}.log" -f $safeCheckpoint, $safeComputer, (Get-Date -Format "yyyyMMdd-HHmmss"))
$script:StateFile = Join-Path $stateDir ("api-unattended-patrol-{0}-{1}.json" -f $safeCheckpoint, $safeComputer)

$env:FUMAN_RUNTIME_DIR = $RuntimeDir
$env:FUMAN_RELEASE_SHA = $ReleaseSha
$env:FUMAN_DEPLOY_SHA = $ReleaseSha
$env:FUMAN_API_UNATTENDED_PRODUCTION_URL = $ProductionUrl

Push-Location $repoRoot
try {
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) {
    $npm = Get-Command npm -ErrorAction Stop
  }
  $pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if (-not $pwsh) {
    $pwsh = Get-Command powershell.exe -ErrorAction Stop
  }
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    $node = Get-Command node -ErrorAction Stop
  }

  $scorecardJson = Join-Path $stateDir ("api-unattended-scorecard-{0}.json" -f $safeComputer)
  $scorecardMd = Join-Path $reportDir ("api-unattended-scorecard-{0}.md" -f $safeComputer)

  Add-Content -LiteralPath $script:LogFile -Value ("[{0}] Fuman API unattended patrol start" -f (Get-Date -Format o))
  Add-Content -LiteralPath $script:LogFile -Value ("root={0}" -f $repoRoot)
  Add-Content -LiteralPath $script:LogFile -Value ("checkpoint={0}" -f $Checkpoint)
  Add-Content -LiteralPath $script:LogFile -Value ("releaseSha={0}" -f $ReleaseSha)

  Invoke-Step -Name "production-guard" -Command $npm.Source -Arguments @("run", "guard:production")
  Invoke-Step -Name "production-monitor" -Command $npm.Source -Arguments @("run", "monitor:production")
  $freshnessExitCode = Invoke-OptionalStep -Name "production-api-freshness" -Command $npm.Source -Arguments @("run", "verify:production-api-freshness")
  Invoke-Step -Name "api-unattended-scorecard" -Command $node.Source -Arguments @(
    "--dns-result-order=ipv4first",
    "--use-system-ca",
    "scripts\verify-api-unattended-scorecard.js",
    "--production-url=$ProductionUrl",
    "--computer=$ComputerLabel",
    "--release-sha=$ReleaseSha",
    "--out=$scorecardJson",
    "--md=$scorecardMd",
    "--timeout-ms=$TimeoutMs",
    "--verifier-timeout-ms=$VerifierTimeoutMs"
  )

  if ($freshnessExitCode -ne 0) {
    Write-PatrolState -Status "degraded" -Message "production-api-freshness recorded blockers; previous good preserved"
    Add-Content -LiteralPath $script:LogFile -Value ("[{0}] Fuman API unattended patrol degraded: production-api-freshness exit={1}; previous good preserved" -f (Get-Date -Format o), $freshnessExitCode)
    exit 0
  }

  Write-PatrolState -Status "ok"
  Add-Content -LiteralPath $script:LogFile -Value ("[{0}] Fuman API unattended patrol ok" -f (Get-Date -Format o))
  exit 0
}
catch {
  $message = $_.Exception.Message
  Write-PatrolState -Status "critical" -Message $message
  Add-Content -LiteralPath $script:LogFile -Value ("[{0}] Fuman API unattended patrol failed: {1}" -f (Get-Date -Format o), $message)
  Send-FailureAlert -Message $message
  exit 1
}
finally {
  Pop-Location
}
