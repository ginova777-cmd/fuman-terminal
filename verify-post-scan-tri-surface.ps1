function Write-PostScanTriSurfaceReceipt {
  param(
    [string]$RuntimeRoot,
    [string]$Route,
    [string]$RunId,
    [string]$ExpectedDate,
    [string]$LogPath,
    [string]$ReportPath,
    [string]$Status,
    [int]$Attempts,
    $Row = $null,
    [string]$Reason = ""
  )

  $receiptDir = Join-Path $RuntimeRoot "data\scan-receipts\tri-surface-closures"
  New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
  $payload = [ordered]@{
    contract = "post-scan-tri-surface-closure-v1"
    route = $Route
    runId = $RunId
    expectedDate = $ExpectedDate
    status = $Status
    complete = ($Status -eq "complete")
    verifiedAt = (Get-Date).ToString("o")
    attempts = $Attempts
    reportPath = $ReportPath
    logPath = $LogPath
    desktopRunId = if ($null -ne $Row) { [string]$Row.desktopSnapshot.runId } else { "" }
    mobileRunId = if ($null -ne $Row) { [string]$Row.mobileFragment.runId } else { "" }
    scorecardRunId = if ($null -ne $Row) { [string]$Row.scorecard.runId } else { "" }
    count = if ($null -ne $Row) { [int]($Row.supabase.count) } else { 0 }
    reason = $Reason
  }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptDir "$Route.json") -Encoding utf8
}

function Update-PostScanReceiptEvidence {
  param(
    [string]$RuntimeRoot,
    [string]$Route,
    [string]$RunId,
    [string]$ExpectedDate,
    $Row
  )

  $receiptPath = Join-Path $RuntimeRoot ("data\scan-receipts\{0}.json" -f $Route)
  if (-not (Test-Path -LiteralPath $receiptPath)) { return }
  try {
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    if ([string]$receipt.runId -ne $RunId) { return }
    $fields = [ordered]@{
      triSurfaceStatus = "complete"
      triSurfaceVerifiedAt = (Get-Date).ToString("o")
      triSurfaceExpectedDate = $ExpectedDate
      verifiedResultCount = [int]$Row.supabase.count
      desktopRunId = [string]$Row.desktopSnapshot.runId
      mobileRunId = [string]$Row.mobileFragment.runId
      scorecardRunId = [string]$Row.scorecard.runId
    }
    foreach ($entry in $fields.GetEnumerator()) {
      $receipt | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value -Force
    }
    $receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $receiptPath -Encoding utf8
  } catch {
    "[$Route] receipt evidence update warning: $($_.Exception.Message)" | Out-File -LiteralPath (Join-Path $RuntimeRoot "logs\post-scan-tri-surface-evidence-warnings.log") -Append -Encoding utf8
  }
}
function Assert-PostScanTriSurfaceClosure {
  param(
    [Parameter(Mandatory = $true)][string]$Route,
    [Parameter(Mandatory = $true)][string]$RunId,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  if ([string]::IsNullOrWhiteSpace($RunId)) { throw "post-scan tri-surface verify missing runId for $Route" }
  $repoRoot = $PSScriptRoot
  $runtimeRoot = if ([string]::IsNullOrWhiteSpace($env:FUMAN_RUNTIME_DIR)) { "C:\fuman-runtime" } else { $env:FUMAN_RUNTIME_DIR }
  $expectedDate = (Get-Date).ToString("yyyyMMdd")
  $safeRunId = $RunId -replace "[^A-Za-z0-9._-]", "_"
  $outDir = Join-Path $runtimeRoot "outputs\post-scan-tri-surface\$Route\$safeRunId"
  $reportPath = Join-Path $outDir "terminal-resource-chain-audit.json"
  $nodeExe = if ($env:NODE_EXE) { $env:NODE_EXE } else { "node" }
  $lastError = ""

  for ($attempt = 1; $attempt -le 6; $attempt++) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    "[$Route] strict tri-surface verification attempt=$attempt runId=$RunId expectedDate=$expectedDate" | Tee-Object -FilePath $LogPath -Append | Out-Null
    Push-Location $repoRoot
    try {
      & $nodeExe "scripts\verify-terminal-resource-chain.js" "--routes=$Route" "--expected-date=$expectedDate" "--require-unattended" "--out=$outDir" *>&1 | Tee-Object -FilePath $LogPath -Append | Out-Null
      $verifyExit = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
    } finally {
      Pop-Location
    }
    try {
      $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
      $row = @($report.results | Where-Object { $_.key -eq $Route }) | Select-Object -First 1
      if ($verifyExit -eq 0 -and $report.ok -eq $true -and $null -ne $row -and $row.ok -eq $true -and [string]$row.supabase.runId -eq $RunId) {
        Write-PostScanTriSurfaceReceipt -RuntimeRoot $runtimeRoot -Route $Route -RunId $RunId -ExpectedDate $expectedDate -LogPath $LogPath -ReportPath $reportPath -Status "complete" -Attempts $attempt -Row $row
        Update-PostScanReceiptEvidence -RuntimeRoot $runtimeRoot -Route $Route -RunId $RunId -ExpectedDate $expectedDate -Row $row
        "[$Route] strict tri-surface verification passed runId=$RunId" | Tee-Object -FilePath $LogPath -Append | Out-Null
        return $row
      }
      $actualRunId = if ($null -ne $row) { [string]$row.supabase.runId } else { "missing" }
      $lastError = "tri-surface verifier exit=$verifyExit ok=$($report.ok) routeOk=$($row.ok) expectedRunId=$RunId actualRunId=$actualRunId"
    } catch {
      $lastError = "tri-surface verifier report error: $($_.Exception.Message)"
    }
    if ($attempt -lt 6) { Start-Sleep -Seconds 10 }
  }
  Write-PostScanTriSurfaceReceipt -RuntimeRoot $runtimeRoot -Route $Route -RunId $RunId -ExpectedDate $expectedDate -LogPath $LogPath -ReportPath $reportPath -Status "failed" -Attempts 6 -Reason $lastError
  throw "post-scan $Route strict tri-surface closure failed: $lastError"
}