param(
  [switch]$SkipReceiptCheck,
  [int]$MaxReceiptAgeHours = 18
)

$ErrorActionPreference = "Stop"
$syncRoot = $PSScriptRoot
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$receiptDir = Join-Path $runtimeRoot "data\scan-receipts"

Push-Location $syncRoot
try {
  & npm.cmd run verify:publish-gate
  $contractExit = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($contractExit -ne 0) {
  exit $contractExit
}

function Read-JsonFile($path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try { return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
}

if (-not $SkipReceiptCheck) {
  $required = @("open-buy", "strategy3", "strategy4", "strategy5")
  $issues = New-Object System.Collections.Generic.List[string]
  foreach ($strategy in $required) {
    $receipt = Read-JsonFile (Join-Path $receiptDir "$strategy.json")
    if (-not $receipt) {
      $issues.Add("missing scan receipt: $strategy") | Out-Null
      continue
    }
    $ageHours = ([datetimeoffset]::Now - [datetimeoffset]::Parse([string]$receipt.finishedAt)).TotalHours
    if ($ageHours -gt $MaxReceiptAgeHours) {
      $issues.Add("stale scan receipt: $strategy age=$([math]::Round($ageHours, 1))h") | Out-Null
    }
    if (@("complete", "degraded") -notcontains [string]$receipt.status) {
      $issues.Add("blocking scan receipt: $strategy status=$($receipt.status) reason=$($receipt.blockingReason)") | Out-Null
    }
  }
  if ($issues.Count -gt 0) {
    throw "Publish gate blocked by scan receipts: $($issues -join '; ')"
  }
}

& (Join-Path $syncRoot "run-live-freshness-gate.ps1") -SkipRawRefresh
exit $LASTEXITCODE
