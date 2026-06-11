$ErrorActionPreference = "Continue"

function Get-FumanRuntimeDir {
  if ($env:FUMAN_RUNTIME_DIR) { return $env:FUMAN_RUNTIME_DIR }
  return "C:\fuman-runtime"
}

function Write-FumanFlowHealth {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("institution", "warrant", "publish", "freshness", "flow")][string]$Scope,
    [Parameter(Mandatory = $true)][string]$Status,
    [string]$Message = "",
    [hashtable]$Detail = @{}
  )

  $runtime = Get-FumanRuntimeDir
  $stateDir = Join-Path $runtime "state"
  $dataDir = Join-Path $runtime "data"
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $path = Join-Path $stateDir "flow-health-latest.json"
  $dataPath = Join-Path $dataDir "flow-health-latest.json"
  $payload = @{}
  if (Test-Path -LiteralPath $path) {
    try {
      $existing = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
      foreach ($property in $existing.PSObject.Properties) { $payload[$property.Name] = $property.Value }
    } catch {}
  }

  $record = [ordered]@{
    scope = $Scope
    status = $Status
    message = $Message
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    detail = $Detail
  }
  $payload[$Scope] = $record
  $payload["updatedAt"] = (Get-Date).ToUniversalTime().ToString("o")
  $jsonText = $payload | ConvertTo-Json -Depth 8
  $stateTemp = "$path.tmp"
  $dataTemp = "$dataPath.tmp"
  $jsonText | Set-Content -LiteralPath $stateTemp -Encoding utf8
  $jsonText | Set-Content -LiteralPath $dataTemp -Encoding utf8
  Move-Item -LiteralPath $stateTemp -Destination $path -Force
  Move-Item -LiteralPath $dataTemp -Destination $dataPath -Force
}
