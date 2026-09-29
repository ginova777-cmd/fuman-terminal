param(
  [string]$TradeDate = "",
  [string]$TerminalDir = "C:\fuman-release-owner\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"
Write-Host '& "C:\Program Files\PowerShell\7\pwsh.exe" -File "C:\fuman-release-owner\fuman-terminal\ops\Run-OpeningShortOnlyReadonly.ps1"   # 第一行：開盤空'
Write-Host '& "C:\Users\ginov\Documents\Codex\2026-09-06\su3\outputs\terminal-345-institution-ranking.ps1"   # 第二行：開盤多／綜合（顯示指令）'
if ([string]::IsNullOrWhiteSpace($TradeDate)) {
  $TradeDate = (Get-Date).ToString("yyyy-MM-dd")
}

$env:FUMAN_RUNTIME_DIR = $RuntimeDir
$script = Join-Path $TerminalDir "scripts\opening-short-only-readonly.js"
if (-not (Test-Path -LiteralPath $script)) {
  throw "空方唯讀程式不存在：$script"
}

& node --use-system-ca $script "--trade-date=$TradeDate"
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
