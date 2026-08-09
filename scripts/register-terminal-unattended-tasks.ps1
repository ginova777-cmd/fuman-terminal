param(
  [string]$ProjectRoot = $(if ($env:FUMAN_PRODUCTION_MIRROR_ROOT) { $env:FUMAN_PRODUCTION_MIRROR_ROOT } else { "C:\fuman-terminal" }),
  [string]$RuntimeRoot = $(if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }),
  [string]$ReceiptPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $ReceiptPath) { $ReceiptPath = Join-Path $RuntimeRoot "state\power-recovery-task-registration.json" }
$RequiredArtifacts = @(
  "scripts\run-terminal-unattended-final-audit.js",
  "scripts\collect-terminal-module-receipts.js",
  "scripts\write-terminal-active-module-registry.js",
  "scripts\write-terminal-daily-manifest.js",
  "scripts\verify-terminal-final-audit-contract.js",
  "scripts\verify-terminal-power-recovery.js"
)
$TaskNames = @(
  "Fuman Terminal Autonomous Root Monitor",
  "Fuman Terminal Full Unattended Final Audit"
)
$LegacyConflictTaskNames = @(
  "Fuman Terminal Autonomous Ops 5m"
)
$startedAt = (Get-Date).ToUniversalTime().ToString("o")
$result = [ordered]@{
  contract = "terminal-power-recovery-task-registration-v1"
  checked_at = $startedAt
  project_root = $ProjectRoot
  runtime_root = $RuntimeRoot
  requested_logon_type = "S4U"
  requested_run_level = "Highest"
  elevated = $false
  actions = @()
  tasks = @()
  legacy_tasks = @()
  failures = @()
  ok = $false
}

function Write-RegistrationReceipt {
  $parent = Split-Path -Parent $ReceiptPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $result.checked_at = (Get-Date).ToUniversalTime().ToString("o")
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
  $result | ConvertTo-Json -Depth 8
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$missingArtifacts = @($RequiredArtifacts | Where-Object { -not (Test-Path -LiteralPath (Join-Path $ProjectRoot $_)) })
if ($missingArtifacts.Count) {
  $result.failures += ("canonical_artifacts_missing:" + ($missingArtifacts -join ","))
}
$result.elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($missingArtifacts.Count -or -not $result.elevated) {
  $result.failures += "administrator_elevation_required"
  Write-RegistrationReceipt
  exit 1
}

try {
  & (Join-Path $PSScriptRoot "install-terminal-full-unattended-final-audit-task.ps1") -ProjectRoot $ProjectRoot -RuntimeRoot $RuntimeRoot
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "final audit task installer exited with code $LASTEXITCODE" }
  $result.actions += "final_audit_task_registered"

  & (Join-Path $PSScriptRoot "install-terminal-autonomous-root-task.ps1") -ProjectRoot $ProjectRoot -RuntimeRoot $RuntimeRoot -ApplyScanners -RequireProtectedReadback
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "autonomous root task installer exited with code $LASTEXITCODE" }
  $result.actions += "autonomous_root_task_registered"

  foreach ($legacyTaskName in $LegacyConflictTaskNames) {
    $legacyTask = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
    if ($null -ne $legacyTask) {
      if ([string]$legacyTask.State -ne "Disabled") {
        Disable-ScheduledTask -TaskName $legacyTaskName -ErrorAction Stop | Out-Null
        $result.actions += "legacy_task_disabled:$legacyTaskName"
      }
      $legacyTask = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
    }
    $result.legacy_tasks += [ordered]@{
      task_name = $legacyTaskName
      installed = ($null -ne $legacyTask)
      disabled = ($null -ne $legacyTask -and [string]$legacyTask.State -eq "Disabled")
      state = if ($null -ne $legacyTask) { [string]$legacyTask.State } else { "Missing" }
    }
    if ($null -ne $legacyTask -and [string]$legacyTask.State -ne "Disabled") {
      $result.failures += "legacy_task_not_disabled:$legacyTaskName"
    }
  }

  foreach ($taskName in $TaskNames) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $principalInfo = $task.Principal
    $row = [ordered]@{
      task_name = $taskName
      state = [string]$task.State
      enabled = ($task.State -ne "Disabled")
      logon_type = [string]$principalInfo.LogonType
      run_level = [string]$principalInfo.RunLevel
    }
    $result.tasks += $row
    if ([string]$principalInfo.LogonType -ne "S4U" -or [string]$principalInfo.RunLevel -ne "Highest") {
      $result.failures += "task_not_s4u_highest:$taskName"
    }
  }
  $result.ok = @($result.failures).Count -eq 0
} catch {
  $result.failures += ("registration_exception:" + $_.Exception.Message)
}

Write-RegistrationReceipt
if (-not $result.ok) { exit 1 }
exit 0
