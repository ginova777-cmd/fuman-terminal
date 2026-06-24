$ErrorActionPreference = "Stop"

$repo = "C:\fuman-terminal"
$node = "C:\Program Files\nodejs\node.exe"
$logDir = "C:\fuman-runtime\logs"
$dataDir = "C:\fuman-terminal\data"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $logDir "tdcc-weekly-sync-$stamp.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Step {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $logFile -Value $line
}

function Invoke-LoggedNode {
  param([string[]]$Arguments)
  Write-Step ("node " + ($Arguments -join " "))
  Push-Location $repo
  try {
    $env:FUMAN_DATA_DIR = $dataDir
    & $node @Arguments 2>&1 | Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) {
      throw "node exited with code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Write-Step "TDCC weekly sync start"
Invoke-LoggedNode @("--use-system-ca", "scripts\sync-tdcc-shareholding-cache.js", "--latest")
Invoke-LoggedNode @("--use-system-ca", "scripts\generate-institution-tdcc-breakout.js")

$mainDataDir = "C:\fuman-terminal\data"
if (Test-Path -LiteralPath $mainDataDir) {
  foreach ($file in @(
    "tdcc-shareholding-1000-history.json",
    "institution-tdcc-breakout.json",
    "institution-tdcc-breakout-top.json",
    "institution-tdcc-breakout.csv"
  )) {
    $source = Join-Path $dataDir $file
    $target = Join-Path $mainDataDir $file
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination $target -Force
      Write-Step "copied $file to main deploy data"
    }
  }
}

Write-Step "TDCC weekly sync done"
