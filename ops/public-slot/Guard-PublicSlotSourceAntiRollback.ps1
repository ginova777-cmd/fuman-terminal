param(
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$Repair
)

$ErrorActionPreference = "Continue"

$LogDir = Join-Path $RuntimeDir "logs"
$LogFile = Join-Path $LogDir "public-slot-anti-rollback.log"
$ConfigPath = Join-Path $RuntimeDir "config\public-slot-shared-source.json"
$RunnerPath = Join-Path $FumanRoot "ops\public-slot\Run-PublicSlotSharedSource.ps1"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-GuardLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
}

function Read-Text {
  param([string]$Path)
  try {
    if (Test-Path -LiteralPath $Path) { return Get-Content -LiteralPath $Path -Raw -ErrorAction Stop }
  } catch {}
  return ""
}

function Write-DefaultRuntimeConfig {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ConfigPath) | Out-Null
  [ordered]@{
    loopSeconds = 10
    stopAt = "12:05"
    minAvgVolume5Lots = 0
    restQuoteBatchSize = 80
    restQuoteEverySeconds = 10
    direct1mBatchSize = 8
    direct1mEverySeconds = 20
    futoptQuoteBatchSize = 120
    futoptQuoteEverySeconds = 20
    futoptQuoteDelayMilliseconds = 100
    futoptTickersEverySeconds = 300
    publicSlotUpsertTimeoutSec = 45
    publicSlotUpsertBatchSize = 300
    writePreopenRows = $true
    writePreopenRowsMode = "preopen"
    strategy2ReadyPageSize = 250
  } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ConfigPath -Encoding utf8
}

function Test-RepoRuntimeConfigSupport {
  $runner = Read-Text -Path $RunnerPath
  $helper = Read-Text -Path (Join-Path $FumanRoot "ops\public-slot\SupabasePublicSlotSource.ps1")
  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($marker in @(
    "Apply-PublicSlotRuntimeConfig",
    "public-slot-shared-source.json",
    "FUMAN_PUBLIC_SLOT_UPSERT_TIMEOUT_SEC",
    "Test-ShouldWritePreopenRows",
    "Get-Strategy2ReadyRefreshBody",
    "Test-Intraday1mMa35Required",
    "zero_volume_hold",
    "quoteFreshEnoughForRegular",
    "sourceCoreOk",
    "intraday_1m_ma35_required"
  )) {
    if (-not $runner.Contains($marker)) { $missing.Add("runner:$marker") }
  }
  foreach ($marker in @("FUMAN_PUBLIC_SLOT_UPSERT_TIMEOUT_SEC", "FUMAN_PUBLIC_SLOT_UPSERT_BATCH_SIZE", "safeBatchSize")) {
    if (-not $helper.Contains($marker)) { $missing.Add("helper:$marker") }
  }
  return $missing.ToArray()
}

function Test-RuntimeConfig {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { return @("missing:$ConfigPath") }
  try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw -ErrorAction Stop | ConvertFrom-Json
  } catch {
    return @("invalid-json:$ConfigPath")
  }
  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($name in @(
    "minAvgVolume5Lots",
    "restQuoteBatchSize",
    "restQuoteEverySeconds",
    "direct1mBatchSize",
    "direct1mEverySeconds",
    "futoptQuoteBatchSize",
    "futoptQuoteEverySeconds",
    "futoptQuoteDelayMilliseconds",
    "publicSlotUpsertTimeoutSec",
    "publicSlotUpsertBatchSize",
    "writePreopenRowsMode",
    "strategy2ReadyPageSize"
  )) {
    if ($null -eq $config.PSObject.Properties[$name]) { $missing.Add("config:$name") }
  }
  $expected = [ordered]@{
    loopSeconds = 10
    stopAt = "12:05"
    minAvgVolume5Lots = 0
    restQuoteBatchSize = 80
    restQuoteEverySeconds = 10
    direct1mBatchSize = 8
    direct1mEverySeconds = 20
    futoptQuoteBatchSize = 120
    futoptQuoteEverySeconds = 20
    futoptQuoteDelayMilliseconds = 100
    futoptTickersEverySeconds = 300
    publicSlotUpsertTimeoutSec = 45
    publicSlotUpsertBatchSize = 300
    writePreopenRowsMode = "preopen"
    strategy2ReadyPageSize = 250
  }
  foreach ($name in $expected.Keys) {
    $prop = $config.PSObject.Properties[$name]
    if ($null -eq $prop) { continue }
    if ([string]$prop.Value -ne [string]$expected[$name]) {
      $missing.Add("config-value:$name=$($prop.Value) expected=$($expected[$name])")
    }
  }
  return $missing.ToArray()
}

$repoMissing = @(Test-RepoRuntimeConfigSupport)
if ($repoMissing.Count -gt 0 -and $Repair) {
  Write-GuardLog "repo runtime config support missing; repair disabled for tracked files: $($repoMissing -join ', ')"
}
if ($repoMissing.Count -gt 0) {
  Write-GuardLog "FAILED repo runtime config support missing: $($repoMissing -join ', ')"
  exit 2
}

$configMissing = @(Test-RuntimeConfig)
if ($configMissing.Count -gt 0 -and $Repair) {
  Write-GuardLog "runtime config missing before repair: $($configMissing -join ', ')"
  Write-DefaultRuntimeConfig
  $configMissing = @(Test-RuntimeConfig)
}

if ($configMissing.Count -gt 0) {
  Write-GuardLog "FAILED runtime config missing: $($configMissing -join ', ')"
  exit 3
}

Write-GuardLog "ok public slot runtime config guard"
