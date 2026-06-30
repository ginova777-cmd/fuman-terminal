[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [string]$RegistryPath = "",
  [string]$TaskPath = "\",
  [string[]]$TaskName = @()
)

$ErrorActionPreference = "Stop"

if (-not $RegistryPath) {
  $RegistryPath = Join-Path $PSScriptRoot "fuman-schedule-registry.json"
}

function Normalize-TaskName($Name) {
  $text = ([string]$Name).Trim()
  while ($text.StartsWith("\")) { $text = $text.Substring(1) }
  return $text
}

function Read-RetiredTaskNames {
  if ($TaskName.Count -gt 0) {
    return @($TaskName | ForEach-Object { Normalize-TaskName $_ } | Where-Object { $_ })
  }
  if (-not (Test-Path -LiteralPath $RegistryPath)) {
    throw "registry not found: $RegistryPath"
  }
  $registry = Get-Content -LiteralPath $RegistryPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
  return @($registry.policy.retiredTasks | ForEach-Object { Normalize-TaskName $_ } | Where-Object { $_ })
}

function Get-TaskOrNull($Name) {
  return Get-ScheduledTask -TaskName $Name -TaskPath $TaskPath -ErrorAction SilentlyContinue
}

function Invoke-Step($Target, $Action, [scriptblock]$Block) {
  if ($WhatIfPreference) {
    Write-Host "What if: Performing the operation '$Action' on target '$Target'."
    return
  }
  & $Block
}

$retired = @(Read-RetiredTaskNames | Sort-Object -Unique)
if ($retired.Count -eq 0) {
  Write-Host "[retired-schedule-tasks] no retired tasks declared"
  exit 0
}

$removed = @()
$missing = @()
foreach ($name in $retired) {
  $task = Get-TaskOrNull $name
  if (-not $task) {
    $missing += $name
    continue
  }
  Invoke-Step "$TaskPath$name" "unregister retired Fuman schedule task" {
    Unregister-ScheduledTask -TaskName $name -TaskPath $TaskPath -Confirm:$false
  }
  $removed += $name
}

$remaining = @($retired | Where-Object { Get-TaskOrNull $_ })
if ($remaining.Count -gt 0 -and -not $WhatIfPreference) {
  throw "retired tasks still present: $($remaining -join ', ')"
}

Write-Host "[retired-schedule-tasks] ok removed=$($removed.Count) missing=$($missing.Count)"
if ($removed.Count) { Write-Host "[retired-schedule-tasks] removed: $($removed -join ', ')" }
if ($missing.Count) { Write-Host "[retired-schedule-tasks] already absent: $($missing -join ', ')" }
