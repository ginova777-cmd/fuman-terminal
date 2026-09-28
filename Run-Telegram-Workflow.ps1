[CmdletBinding()]
param(
 [string]$StaticFile,
 [string]$TradeDate,
 [string]$BaseDate,
 [string]$AsOf,
 [string]$TrialFile,
 [string]$CalendarFile,
 [string]$IntradayFile,
 [string]$RuntimeRoot='C:\fuman-runtime',
 [string]$OutputDirectory,
 [switch]$VerifyUI
)
$ErrorActionPreference='Stop'
if (-not $OutputDirectory) {
 $OutputDirectory=Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('Codex\Telegram-Workflow\'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
}
$runner=Join-Path $PSScriptRoot 'scripts\run-telegram-workflow.cjs'
if (-not (Test-Path -LiteralPath $runner)) { throw 'Telegram workflow runner missing beside this entry. Run from the installed checkout.' }
$arguments=@(('--runtime-root='+$RuntimeRoot),('--output='+$OutputDirectory))
foreach ($item in @(@('static',$StaticFile),@('date',$TradeDate),@('base-date',$BaseDate),@('as-of',$AsOf),@('trials',$TrialFile),@('calendar',$CalendarFile),@('intraday',$IntradayFile))) {
 if ($item[1]) { $arguments+=('--'+$item[0]+'='+$item[1]) }
}
if ($VerifyUI) { $arguments+='--verify-ui' }
Write-Host 'Telegram 三階段入口｜通知停送｜不下單'
Write-Host '執行三階段資料驗證'
& node --use-system-ca $runner @arguments
$code=$LASTEXITCODE
Write-Host ('結果目錄：'+$OutputDirectory)
if ($code -eq 2) { Write-Host '已輸出結果；資料或正式規則尚未完整，請查看 workflow-receipt.json。' }
exit $code


