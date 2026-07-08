param(
  [switch]$SkipReceiptCheck,
  [switch]$StrictReceiptCheck,
  [int]$MaxReceiptAgeHours = 18
)

$ErrorActionPreference = "Stop"
$syncRoot = $PSScriptRoot
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$receiptDir = Join-Path $runtimeRoot "data\scan-receipts"

Push-Location $syncRoot
try {
  $previousAuditOnly = $env:FUMAN_PUBLISH_SOURCE_GATE_AUDIT_ONLY
  if ($env:FUMAN_DEPLOY_SOURCE_GATE_STRICT -ne "1") {
    $env:FUMAN_PUBLISH_SOURCE_GATE_AUDIT_ONLY = "1"
  }
  & npm.cmd run publish:source-gate
  $sourceGateExit = $LASTEXITCODE
  if ($sourceGateExit -ne 0) {
    exit $sourceGateExit
  }
  & npm.cmd run verify:publish-gate
  $contractExit = $LASTEXITCODE
} finally {
  if ($null -eq $previousAuditOnly) {
    Remove-Item Env:\FUMAN_PUBLISH_SOURCE_GATE_AUDIT_ONLY -ErrorAction SilentlyContinue
  } else {
    $env:FUMAN_PUBLISH_SOURCE_GATE_AUDIT_ONLY = $previousAuditOnly
  }
  Pop-Location
}
if ($contractExit -ne 0) {
  exit $contractExit
}

function Read-JsonFile($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try { return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
}

function Get-ReceiptValue($receipt, $name, $default = $null) {
  if (-not $receipt) { return $default }
  if ($receipt -is [System.Collections.IDictionary] -and $receipt.Contains($name)) {
    $value = $receipt[$name]
    if ($null -ne $value) { return $value }
  }
  $property = $receipt.PSObject.Properties[$name]
  if ($property -and $null -ne $property.Value) { return $property.Value }
  return $default
}

function Get-ReceiptBool($receipt, $name, $default = $false) {
  $value = Get-ReceiptValue $receipt $name $default
  return [bool]$value
}

function Get-ReceiptInt($receipt, $name, $default = 0) {
  $propertyValue = Get-ReceiptValue $receipt $name $default
  $value = 0
  if ([int]::TryParse([string]$propertyValue, [ref]$value)) { return $value }
  return [int]$default
}

function Get-ReceiptWarnings($receipt) {
  $value = Get-ReceiptValue $receipt "warnings" @()
  if ($null -eq $value) { return @() }
  return @($value)
}

function Test-PreservePreviousGoodWarningsOnly($warnings) {
  $items = @($warnings)
  if ($items.Count -eq 0) { return $false }
  foreach ($item in $items) {
    $text = [string]$item
    if ($text -match "^resource health not_ready:" -or $text -match "^blockedReceipt=") {
      continue
    }
    return $false
  }
  return $true
}

if (-not $SkipReceiptCheck) {
  $receiptStrict = $StrictReceiptCheck -or $env:FUMAN_STRICT_GLOBAL_SCAN_RECEIPTS -eq "1"
  $required = @("open-buy", "strategy3", "institution", "warrant-flow", "strategy4", "strategy5", "cb-detect")
  $issues = New-Object System.Collections.Generic.List[string]
  $summary = Read-JsonFile (Join-Path $receiptDir "scan-summary.json")
  if (-not $summary) {
    $issues.Add("missing scan summary: scan-summary.json") | Out-Null
  } else {
    if ($summary.ok -ne $true) {
      $issues.Add("scan summary ok is not true") | Out-Null
    }
    if ($summary.allCompleteOk -ne $true) {
      $strictText = (@($summary.strictFailures) -join "; ")
      $issues.Add("scan summary allCompleteOk is not true: $strictText") | Out-Null
    }
    if (@($summary.strictFailures).Count -gt 0) {
      $issues.Add("scan summary strictFailures present: $(@($summary.strictFailures) -join '; ')") | Out-Null
    }
  }
  foreach ($strategy in $required) {
    $receipt = Read-JsonFile (Join-Path $receiptDir "$strategy.json")
    if (-not $receipt) {
      $issues.Add("missing scan receipt: $strategy") | Out-Null
      continue
    }
    try {
      $ageHours = ([datetimeoffset]::Now - [datetimeoffset]::Parse([string]$receipt.finishedAt)).TotalHours
      if ($ageHours -gt $MaxReceiptAgeHours) {
        $issues.Add("stale scan receipt: $strategy age=$([math]::Round($ageHours, 1))h") | Out-Null
      }
    } catch {
      $issues.Add("invalid scan receipt timestamp: $strategy finishedAt=$($receipt.finishedAt)") | Out-Null
    }
    if ([string]$receipt.status -ne "complete" -or -not (Get-ReceiptBool $receipt "complete" $false)) {
      $issues.Add("blocking scan receipt: $strategy status=$($receipt.status) reason=$($receipt.blockingReason)") | Out-Null
    }
    $exitCode = Get-ReceiptInt $receipt "exitCode" 1
    if ($exitCode -ne 0) {
      $issues.Add("blocking scan receipt: $strategy exitCode=$exitCode") | Out-Null
    }
    if (Get-ReceiptBool $receipt "fallback" $false) {
      $issues.Add("blocking scan receipt: $strategy fallback=true") | Out-Null
    }
    $quality = [string]$receipt.qualityStatus
    if ($quality -in @("partial", "degraded", "incomplete")) {
      $issues.Add("blocking scan receipt: $strategy qualityStatus=$quality") | Out-Null
    }
    $warnings = Get-ReceiptWarnings $receipt
    if ($warnings.Count -gt 0 -and -not (Test-PreservePreviousGoodWarningsOnly $warnings)) {
      $issues.Add("blocking scan receipt: $strategy warnings=$($warnings.Count)") | Out-Null
    }
  }
  if ($issues.Count -gt 0) {
    $message = "Global scan receipt check has issues: $($issues -join '; ')"
    if ($receiptStrict) {
      throw "Publish gate blocked by scan receipts: $($issues -join '; ')"
    }
    Write-Warning "$message; continuing because overall unattended coupling is disabled. Use -StrictReceiptCheck or FUMAN_STRICT_GLOBAL_SCAN_RECEIPTS=1 for full-system audit."
  }
}

& (Join-Path $syncRoot "run-live-freshness-gate.ps1") -SkipRawRefresh
exit $LASTEXITCODE
