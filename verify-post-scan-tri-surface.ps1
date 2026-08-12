function Assert-PostScanTriSurfaceClosure {
  param(
    [Parameter(Mandatory = $true)][string]$Route,
    [Parameter(Mandatory = $true)][string]$RunId,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  if ([string]::IsNullOrWhiteSpace($RunId)) { throw "post-scan tri-surface verify missing runId for $Route" }
  $repoRoot = $PSScriptRoot
  $runtimeRoot = if ([string]::IsNullOrWhiteSpace($env:FUMAN_RUNTIME_DIR)) { "C:\\fuman-runtime" } else { $env:FUMAN_RUNTIME_DIR }
  $expectedDate = (Get-Date).ToString("yyyyMMdd")
  $safeRunId = $RunId -replace "[^A-Za-z0-9._-]", "_"
  $outDir = Join-Path $runtimeRoot "outputs\\post-scan-tri-surface\\$Route\\$safeRunId"
  $nodeExe = if ($env:NODE_EXE) { $env:NODE_EXE } else { "node" }
  $lastError = ""

  for ($attempt = 1; $attempt -le 3; $attempt++) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    "[$Route] strict tri-surface verification attempt=$attempt runId=$RunId expectedDate=$expectedDate" | Tee-Object -FilePath $LogPath -Append | Out-Null
    Push-Location $repoRoot
    try {
      & $nodeExe "scripts\\verify-terminal-resource-chain.js" "--routes=$Route" "--expected-date=$expectedDate" "--require-unattended" "--out=$outDir" *>&1 | Tee-Object -FilePath $LogPath -Append | Out-Null
      $verifyExit = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
    } finally {
      Pop-Location
    }
    try {
      $report = Get-Content -LiteralPath (Join-Path $outDir "terminal-resource-chain-audit.json") -Raw | ConvertFrom-Json
      $row = @($report.results | Where-Object { $_.key -eq $Route }) | Select-Object -First 1
      if ($verifyExit -eq 0 -and $report.ok -eq $true -and $null -ne $row -and $row.ok -eq $true -and [string]$row.supabase.runId -eq $RunId) {
        "[$Route] strict tri-surface verification passed runId=$RunId" | Tee-Object -FilePath $LogPath -Append | Out-Null
        return $row
      }
      $actualRunId = if ($null -ne $row) { [string]$row.supabase.runId } else { "missing" }
      $lastError = "tri-surface verifier exit=$verifyExit ok=$($report.ok) routeOk=$($row.ok) expectedRunId=$RunId actualRunId=$actualRunId"
    } catch {
      $lastError = "tri-surface verifier report error: $($_.Exception.Message)"
    }
    if ($attempt -lt 3) { Start-Sleep -Seconds 10 }
  }
  throw "post-scan $Route strict tri-surface closure failed: $lastError"
}