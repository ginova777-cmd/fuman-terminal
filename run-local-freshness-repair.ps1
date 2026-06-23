$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$syncRoot = $PSScriptRoot
$terminalRoot = if ($env:FUMAN_MAIN_DEPLOY_REPO) { $env:FUMAN_MAIN_DEPLOY_REPO } else { "C:\fuman-terminal" }
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$logDir = Join-Path $runtimeRoot "logs"
$log = Join-Path $logDir ("local-freshness-repair-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-RepairLog($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Invoke-LoggedNpm($root, $scriptName) {
  Push-Location $root
  try {
    Write-RepairLog "START npm run $scriptName ($root)"
    npm run $scriptName *>&1 | ForEach-Object {
      $text = [string]$_
      Write-Host $text
      Add-Content -LiteralPath $log -Value $text -Encoding utf8
    }
    $exitCode = $LASTEXITCODE
    Write-RepairLog "END npm run $scriptName ($root) exit=$exitCode"
    return $exitCode
  } finally {
    Pop-Location
  }
}

Write-RepairLog "Local freshness repair started"
Write-RepairLog "Legacy data freshness verifier removed; running fast freshness gate repair directly"
$gateExit = Invoke-LoggedNpm $syncRoot "freshness:gate:fast"
if ($gateExit -ne 0) {
  Write-RepairLog "FAILED fast freshness gate repair exit=$gateExit"
  exit $gateExit
}

Write-RepairLog "SUCCESS local terminal repair completed"
exit 0
