Set-Location "C:\fuman-terminal"

New-Item -ItemType Directory -Force -Path "C:\fuman-terminal\logs" | Out-Null
$log = "C:\fuman-terminal\logs\trade-manager-$(Get-Date -Format yyyyMMdd-HHmmss).log"

"=== Trade manager start $(Get-Date) ===" | Out-File $log -Encoding utf8

node scripts\trade-manager.js >> $log 2>&1
$tradeExit = $LASTEXITCODE

if ($tradeExit -ne 0) {
  "Trade manager failed with exit code $tradeExit" >> $log
  exit $tradeExit
}

"=== Trade manager end $(Get-Date) ===" >> $log
