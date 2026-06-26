$ErrorActionPreference = "Stop"

function Invoke-ScannerResourceHealthGate {
  param(
    [Parameter(Mandatory = $true)][string]$Strategy,
    [string]$LogPath = "",
    [switch]$AllowStale
  )

  $nodeExe = if ($script:nodeExe) { $script:nodeExe } else { "C:\Program Files\nodejs\node.exe" }
  $scriptPath = Join-Path $PSScriptRoot "scripts\check-scanner-resource-health.js"
  if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "scanner resource health checker missing: $scriptPath"
  }

  $args = @($scriptPath, "--strategy=$Strategy")
  if ($AllowStale) { $args += "--allow-stale" }
  $output = (& $nodeExe @args 2>&1) -join "`n"
  $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }

  if ($LogPath) {
    Add-Content -LiteralPath $LogPath -Encoding utf8 -Value "Scanner resource health preflight ($Strategy) exit=$exitCode $output"
  }

  $payload = $null
  try {
    $payload = $output | ConvertFrom-Json -ErrorAction Stop
  } catch {
    $payload = [pscustomobject]@{
      ok = $false
      blocked = $true
      requested = $Strategy
      strategy = $Strategy
      status = "failed"
      reason = "invalid scanner resource health output: $($_.Exception.Message)"
      suggestedScannerBehavior = "preserve latest complete run"
      raw = $output
    }
  }

  $status = ([string]$payload.status).ToLowerInvariant()
  $publishAllowed = $status -eq "ready"
  $fallbackWarningOnly = $status -eq "stale"
  $preserveLatest = $status -in @("stale", "not_ready", "failed") -or $exitCode -ne 0
  return [pscustomobject]@{
    Ok = $publishAllowed
    PublishAllowed = $publishAllowed
    FallbackWarningOnly = $fallbackWarningOnly
    PreserveLatest = $preserveLatest
    Status = if ($status) { $status } else { "failed" }
    Reason = [string]($payload.reason ?? $payload.error ?? "")
    SuggestedScannerBehavior = [string]($payload.suggestedScannerBehavior ?? "")
    Payload = $payload
    ExitCode = $exitCode
  }
}
