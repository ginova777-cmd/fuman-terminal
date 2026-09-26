param([string]$TradeDate)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$env:NODE_OPTIONS = '--use-system-ca'
if (-not $TradeDate) { $TradeDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), 'Taipei Standard Time').ToString('yyyy-MM-dd') }
if ($TradeDate -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'invalid_trade_date' }
& 'C:\Program Files\nodejs\node.exe' scripts\verify-opening-report-release.js
if ($LASTEXITCODE -ne 0) { exit 1 }
& 'C:\Program Files\nodejs\node.exe' scripts\check-market-calendar-action.js "--date=$TradeDate" '--label=Morning-aggregate'
if ($LASTEXITCODE -eq 10) { exit 0 }
if ($LASTEXITCODE -ne 0) { exit 1 }
& 'C:\Program Files\nodejs\node.exe' scripts\supabase-incident-guard.js check '--class=guard' '--action=morning-aggregate-retry'
if ($LASTEXITCODE -ne 0) { exit 1 }
# Evidence-only retry: never invoke the source detector, bridge or LINE sender.
& 'C:\Program Files\nodejs\node.exe' scripts\verify-opening-report-two-stage.js "--date=$TradeDate" '--if-ready'
exit $LASTEXITCODE
