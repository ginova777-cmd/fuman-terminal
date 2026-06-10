$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repo = "${PSScriptRoot}"
$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$log = Join-Path $logDir ("verify-data-freshness-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
"=== verify data freshness start $(Get-Date) ===" | Out-File -LiteralPath $log -Encoding utf8

Push-Location $repo
try {
  npm run verify:data-freshness 2>&1 | Tee-Object -FilePath $log -Append
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    "verify:data-freshness failed with exit code $exitCode" | Out-File -LiteralPath $log -Append -Encoding utf8
    exit $exitCode
  }
} finally {
  Pop-Location
}

"=== verify data freshness end $(Get-Date) ===" | Out-File -LiteralPath $log -Append -Encoding utf8
