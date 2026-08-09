param(
  [string]$Root = 'C:\fuman-terminal',
  [string]$RuntimeRoot = 'C:\fuman-runtime',
  [string]$MasterTaskName = 'Fuman Terminal Autonomous Ops 5m',
  [string]$LegacyTaskName = 'Fuman Terminal Autonomous Root Monitor',
  [switch]$ConfirmDisableLegacyRoot
)

$ErrorActionPreference = 'Stop'
$masterRunner = Join-Path $Root 'scripts\run-terminal-autonomous-ops.js'
$scheduleVerifier = Join-Path $Root 'scripts\verify-terminal-autonomous-schedule-contract.js'
$cutoverDir = Join-Path $RuntimeRoot 'state\autonomous-master-cutover'

if (-not (Test-Path -LiteralPath $masterRunner)) { throw "master runner missing: $masterRunner" }
if (-not (Test-Path -LiteralPath $scheduleVerifier)) { throw "schedule verifier missing: $scheduleVerifier" }

$master = Get-ScheduledTask -TaskName $MasterTaskName -ErrorAction Stop
$legacy = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
$masterInfo = Get-ScheduledTaskInfo -TaskName $MasterTaskName

$report = [ordered]@{
  contract = 'terminal-master-cutover-v1'
  checkedAt = (Get-Date).ToString('o')
  masterTask = [ordered]@{
    name = $MasterTaskName
    state = [string]$master.State
    lastResult = $masterInfo.LastTaskResult
    runner = $masterRunner
  }
  legacyTask = if ($legacy) { [ordered]@{ name = $LegacyTaskName; state = [string]$legacy.State; taskPath = [string]$legacy.TaskPath } } else { $null }
  action = if ($ConfirmDisableLegacyRoot) { 'disable_legacy_after_backup' } else { 'read_only_plan' }
}

if (-not $ConfirmDisableLegacyRoot) {
  $report.nextStep = "Re-run with -ConfirmDisableLegacyRoot only after Release Owner approves the legacy task cutover."
  $report | ConvertTo-Json -Depth 8
  exit 0
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'cutover requires an elevated PowerShell window'
}
if (-not $legacy) { throw "legacy task not found: $LegacyTaskName" }

New-Item -ItemType Directory -Force -Path $cutoverDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupXml = Join-Path $cutoverDir (($LegacyTaskName -replace '[^A-Za-z0-9_-]', '_') + "-$stamp.xml")
Export-ScheduledTask -TaskName $LegacyTaskName -TaskPath $legacy.TaskPath | Set-Content -LiteralPath $backupXml -Encoding UTF8
Disable-ScheduledTask -TaskName $LegacyTaskName -TaskPath $legacy.TaskPath | Out-Null
$after = Get-ScheduledTask -TaskName $LegacyTaskName -TaskPath $legacy.TaskPath
if ($after.State -ne 'Disabled') { throw "legacy task was not disabled: $LegacyTaskName" }

$receiptPath = Join-Path $cutoverDir 'latest.json'
$report.legacyTask.stateAfter = [string]$after.State
$report.legacyBackupXml = $backupXml
$report.rollback = "Register-ScheduledTask -TaskName `"$LegacyTaskName`" -Xml (Get-Content -Raw -LiteralPath `"$backupXml`") -Force"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding UTF8

$verify = & node --use-system-ca $scheduleVerifier --require-live 2>&1
$verifyExit = $LASTEXITCODE
$report.verifierExitCode = $verifyExit
$report.verifierOutput = @($verify)
$report.receipt = $receiptPath
$report | ConvertTo-Json -Depth 10
if ($verifyExit -ne 0) { exit $verifyExit }
