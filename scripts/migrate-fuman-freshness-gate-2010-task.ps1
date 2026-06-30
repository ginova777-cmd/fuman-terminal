[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [string]$LegacyTaskName = "",
  [string]$CanonicalTaskName = "Fuman Freshness Gate Full 2010",
  [string]$TaskPath = "\",
  [string]$KeepTime = "20:10",
  [string]$RemoveTime = "06:10"
)

$ErrorActionPreference = "Stop"

if (-not $LegacyTaskName) {
  $LegacyTaskName = "Fuman Freshness Gate Full " + ($RemoveTime -replace ":", "") + " 2010"
}

function Get-TriggerTimeText($Trigger) {
  try {
    return ([datetime]$Trigger.StartBoundary).ToString("HH:mm")
  } catch {
    return ""
  }
}

function New-DailyTriggerFromTime($TimeText) {
  $parts = $TimeText.Split(":")
  if ($parts.Count -ne 2) { throw "invalid time: $TimeText" }
  $hour = [int]$parts[0]
  $minute = [int]$parts[1]
  return New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours($hour).AddMinutes($minute))
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

$legacy = Get-TaskOrNull $LegacyTaskName
$canonical = Get-TaskOrNull $CanonicalTaskName
$source = if ($canonical) { $canonical } else { $legacy }

if (-not $source) {
  throw "neither legacy task '$LegacyTaskName' nor canonical task '$CanonicalTaskName' exists"
}

$sourceTriggers = @($source.Triggers)
$sourceTimes = @($sourceTriggers | ForEach-Object { Get-TriggerTimeText $_ })
$keepTriggers = @($sourceTriggers | Where-Object { (Get-TriggerTimeText $_) -eq $KeepTime })
if ($keepTriggers.Count -lt 1) {
  $keepTriggers = @(New-DailyTriggerFromTime $KeepTime)
}

if (@($keepTriggers | Where-Object { (Get-TriggerTimeText $_) -eq $RemoveTime }).Count -gt 0) {
  throw "refusing to register canonical task because $RemoveTime trigger is still in keep set"
}

$description = "Official full freshness gate. Final success requires live data freshness. Runs at $KeepTime only."

Invoke-Step "$TaskPath$CanonicalTaskName" "register canonical $KeepTime-only freshness gate" {
  Register-ScheduledTask `
    -TaskName $CanonicalTaskName `
    -TaskPath $TaskPath `
    -Action $source.Actions `
    -Trigger $keepTriggers `
    -Settings $source.Settings `
    -Principal $source.Principal `
    -Description $description `
    -Force |
    Out-Null
}

if ($legacy) {
  Invoke-Step "$TaskPath$LegacyTaskName" "unregister legacy freshness gate task containing $RemoveTime" {
    Unregister-ScheduledTask -TaskName $LegacyTaskName -TaskPath $TaskPath -Confirm:$false
  }
}

$updated = Get-TaskOrNull $CanonicalTaskName
if (-not $updated) {
  throw "canonical task was not found after migration: $CanonicalTaskName"
}

$updatedTimes = @($updated.Triggers | ForEach-Object { Get-TriggerTimeText $_ })
if ($updatedTimes -contains $RemoveTime) {
  throw "migration failed: canonical task still has $RemoveTime trigger"
}
if ($updatedTimes -notcontains $KeepTime) {
  throw "migration failed: canonical task does not have $KeepTime trigger"
}
if (Get-TaskOrNull $LegacyTaskName) {
  throw "migration failed: legacy task still exists: $LegacyTaskName"
}

$freshnessTasks = @(Get-ScheduledTask -TaskPath $TaskPath -ErrorAction SilentlyContinue |
  Where-Object { $_.TaskName -like "Fuman Freshness Gate Full*" })
$removeCompactTime = $RemoveTime -replace ":", ""
$violations = @($freshnessTasks | Where-Object {
  $_.TaskName -match [regex]::Escape($removeCompactTime) -or
  @($_.Triggers | Where-Object { (Get-TriggerTimeText $_) -eq $RemoveTime }).Count -gt 0
})
if ($violations.Count -gt 0) {
  throw "freshness gate $RemoveTime policy violation remains: $($violations.TaskName -join ', ')"
}

Write-Host "[freshness-2010-migration] ok canonical=$CanonicalTaskName triggers=$($updatedTimes -join ', ') previousTriggers=$($sourceTimes -join ', ')"
