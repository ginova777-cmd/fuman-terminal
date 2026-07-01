param(
  [string]$Root = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$ProductionUrl = "https://fuman-terminal.vercel.app",
  [string]$ComputerLabel = $env:COMPUTERNAME,
  [string]$ReleaseSha = "",
  [switch]$SkipVerifiers,
  [switch]$NoFail,
  [int]$TimeoutMs = 45000,
  [int]$VerifierTimeoutMs = 120000
)

$ErrorActionPreference = "Stop"

function Resolve-NodeRoot {
  param([string]$Path)
  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
  if (-not (Test-Path -LiteralPath (Join-Path $resolved "package.json"))) {
    throw "package.json not found under $resolved"
  }
  return $resolved.ProviderPath
}

$repoRoot = Resolve-NodeRoot -Path $Root
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
New-Item -ItemType Directory -Force -Path $stateDir, $reportDir, $logDir | Out-Null

$safeComputer = ($ComputerLabel -replace "[^A-Za-z0-9_.-]", "_")
$jsonOut = Join-Path $stateDir ("api-unattended-scorecard-{0}.json" -f $safeComputer)
$mdOut = Join-Path $reportDir ("api-unattended-scorecard-{0}.md" -f $safeComputer)
$logFile = Join-Path $logDir ("api-unattended-scorecard-{0}-{1}.log" -f $safeComputer, (Get-Date -Format "yyyyMMdd-HHmmss"))

$env:FUMAN_RUNTIME_DIR = $RuntimeDir
$env:FUMAN_API_UNATTENDED_COMPUTER = $ComputerLabel
$env:FUMAN_API_UNATTENDED_PRODUCTION_URL = $ProductionUrl
$env:FUMAN_API_UNATTENDED_SCORECARD_FILE = $jsonOut
$env:FUMAN_API_UNATTENDED_REPORT_FILE = $mdOut
$env:FUMAN_RELEASE_SHA = $ReleaseSha

$scriptArgs = @(
  "run",
  "verify:api-unattended-scorecard",
  "--",
  "--production-url=$ProductionUrl",
  "--computer=$ComputerLabel",
  "--release-sha=$ReleaseSha",
  "--out=$jsonOut",
  "--md=$mdOut",
  "--timeout-ms=$TimeoutMs",
  "--verifier-timeout-ms=$VerifierTimeoutMs"
)

if ($SkipVerifiers) {
  $scriptArgs += "--skip-verifiers"
}
if ($NoFail) {
  $scriptArgs += "--no-fail"
}

Push-Location $repoRoot
try {
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) {
    $npm = Get-Command npm -ErrorAction Stop
  }
  "[$(Get-Date -Format o)] root=$repoRoot computer=$ComputerLabel production=$ProductionUrl releaseSha=$ReleaseSha" | Tee-Object -FilePath $logFile
  & $npm.Source @scriptArgs 2>&1 | Tee-Object -FilePath $logFile -Append
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -and -not $NoFail) {
    throw "api unattended scorecard failed with exit code $exitCode. See $logFile"
  }
  if (-not (Test-Path -LiteralPath $jsonOut)) {
    throw "scorecard JSON was not written: $jsonOut"
  }
  Write-Host "[api-unattended-ps1] json=$jsonOut"
  Write-Host "[api-unattended-ps1] md=$mdOut"
  Write-Host "[api-unattended-ps1] log=$logFile"
  exit $exitCode
}
finally {
  Pop-Location
}
