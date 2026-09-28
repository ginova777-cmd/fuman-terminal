[CmdletBinding()]
param(
 [string]$InputDirectory,
 [ValidateRange(1,500)][int]$Top=30,
 [string]$Runner='C:\Users\ginov\Documents\Codex\2026-09-24\new-chat\work\telegram-deploy-297\Run-Telegram-Workflow.ps1'
)
$ErrorActionPreference='Stop'
function Show-Title([string]$Text) { Write-Host ''; Write-Host $Text -ForegroundColor Cyan; Write-Host ('─'*65) -ForegroundColor DarkGray }
function Show-Price($Value) { if ($null -eq $Value) {return '未確認'}; return ('{0:N2}' -f [double]$Value) }
$historyView=[bool]$InputDirectory
if (-not $InputDirectory) {
 $scanRoot=Join-Path $PSScriptRoot ('telegram-console-runs\'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
 New-Item -ItemType Directory -Path $scanRoot -Force | Out-Null
 $scanFile=Join-Path $scanRoot 'previous-session.json'
 Write-Host '正在依市場日曆掃描上一交易日日K…' -ForegroundColor Cyan
 & node 'C:\fuman-release-owner\fuman-terminal\scripts\scan-telegram-previous-session.cjs' ('--output='+$scanFile) *> (Join-Path $scanRoot 'scan.log')
 if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $scanRoot 'scan.log') | Out-Host; throw '上一交易日掃描失敗，未改用其他日期。' }
 $scan=Get-Content -LiteralPath $scanFile -Raw -Encoding UTF8 | ConvertFrom-Json
 Show-Title 'Telegram｜上一交易日劇本前置篩選'
 Write-Host ('資料日：'+$scan.base_date+'｜等待試撮交易日：'+$scan.trade_date) -ForegroundColor Green
 Write-Host ('已檢查 '+$scan.examined+' 檔價格快取；同日資料可計算 '+$scan.evaluated+' 檔；缺項 '+@($scan.gaps).Count+' 檔。')
 Write-Host '通知停送｜不下單｜以下是日K前置條件數排序，尚非完整劇本名次' -ForegroundColor Yellow
 foreach($side in @('long','short')) {
  $key=if($side -eq 'long'){'long_condition_count'}else{'short_condition_count'}
  Show-Title $(if($side -eq 'long'){'① 多方日K候選（至少兩項向上）'}else{'① 空方日K候選（至少兩項向下）'})
  $items=@($scan.rows | Where-Object daily_direction -eq $side | Sort-Object @{Expression={$_.${key}};Descending=$true},stock_id)
  Write-Host ('候選 '+$items.Count+' 檔，顯示前 '+$Top+' 檔；同數量依代號排列。')
  $items | Select-Object -First $Top | ForEach-Object {
   [pscustomobject]@{股票=$_.stock_id;名稱=$_.name;收盤=(Show-Price $_.previous.close);符合項數=$_.${key};外資=$(if($_.institutions){[math]::Round($_.institutions.foreign/1000,1)}else{'未確認'});投信=$(if($_.institutions){[math]::Round($_.institutions.trust/1000,1)}else{'未確認'});自營=$(if($_.institutions){[math]::Round($_.institutions.dealer_total/1000,1)}else{'未確認'});主力成本='待同日分點'}
  } | Format-Table -AutoSize | Out-Host
 }
 Show-Title '② 試撮與開盤判斷'
 Write-Host ('此入口先掃 '+$scan.base_date+'，不依賴试撮；'+$scan.trade_date+' 試撮由既有盤前流程接續確認。')
 Show-Title '③ 盤中偵測'
 Write-Host '等待交易時段及已確認方向；本次不啟動盤中通知。'
 Write-Host ''; Write-Host '尚缺：完整市場資料、同日分點成本及完整劇本資格；目前不得視為全市場掃描完成。' -ForegroundColor Yellow
 Write-Host ('完整結果：'+$scanFile)
 return
}
$receiptFile=Join-Path $InputDirectory 'workflow-receipt.json'
$reportFile=Join-Path $InputDirectory 'workflow.json'
$receipt=$null; $report=$null
if (Test-Path -LiteralPath $receiptFile) { $receipt=Get-Content -LiteralPath $receiptFile -Raw -Encoding UTF8 | ConvertFrom-Json }
if (Test-Path -LiteralPath $reportFile) { $report=Get-Content -LiteralPath $reportFile -Raw -Encoding UTF8 | ConvertFrom-Json }
Show-Title 'Telegram 多空劇本｜三階段監看'
Write-Host ('查詢時間：'+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Write-Host '通知停送｜不下單｜本畫面不會重啟正式排程' -ForegroundColor Yellow
if ($historyView) { Write-Host '模式：指定資料檢視；不是今日即時行情' -ForegroundColor Yellow }
if ($report) {
 Write-Host ('資料日期：T '+$report.trade_date+' ／ T−1 '+$report.base_date)
 Write-Host ('來源涵蓋：'+$report.coverage.evaluated+' 檔；尚未證明全市場完整')
} else { Write-Host '當日可展示資料尚未取得；未拿舊資料替代。' -ForegroundColor Yellow }
Show-Title '① T−1 多空劇本與排名'
Write-Host '多方排名：尚未完成通用評分，不能列為正式名次。' -ForegroundColor Yellow
if ($report -and @($report.daily).Count -gt 0) {
 Write-Host '空方條件分數（僅供檢視，不等於已放行空方名單）：' -ForegroundColor Yellow
 $report.daily | Select-Object -First $Top | ForEach-Object {
  [pscustomobject]@{股票=$_.stock_id;主力成本=(Show-Price $_.cost);空方分數=$(if ($null -eq $_.short_ranking.score){'待補'}else{$_.short_ranking.score});缺項數=@($_.short_ranking.missing).Count}
 } | Format-Table -AutoSize | Out-Host
} else { Write-Host '目前沒有可列出的排名資料。' }
Show-Title '② T 日試撮／支撐壓力／開盤判斷'
if ($report -and @($report.trials).Count -gt 0) {
 $report.trials | Select-Object -First $Top | ForEach-Object {
  $row=$_; $cost=($row.references | Where-Object source -eq 'plan_cost' | Select-Object -First 1).price
  [pscustomobject]@{股票=$row.stock_id;試撮=(Show-Price $row.trial.price);成本=(Show-Price $cost);成本加3=(Show-Price ($row.references | Where-Object source -eq 'plan_cost_plus_3pct' | Select-Object -First 1).price);方向=$(switch ($row.direction_candidate){'long'{'多'} 'short'{'空'} default{'待確認'}})}
 } | Format-Table -AutoSize | Out-Host
 Write-Host '缺試撮就保留未確認，不用實際開盤價代替。' -ForegroundColor DarkGray
} else { Write-Host '目前沒有可核對的試撮與價位資料。' }
Show-Title '③ 盤中瞬間巨量／瞬間拉抬＋技術分析'
Write-Host '1分K｜RSI(5,15)｜KD(5,3,3)｜MACD(5,9,20)'
if ($report -and @($report.intraday).Count -gt 0) {
 $report.intraday | Select-Object -First $Top | ForEach-Object {
  [pscustomobject]@{股票=$_.stock_id;方向=$_.required_direction;偵測器=$_.event.event_type;確認狀態=$_.gate.status;通知='未發送'}
 } | Format-Table -AutoSize | Out-Host
} else { Write-Host '目前無可展示訊號；不代表全日完整掃描為零。' }
Show-Title '執行狀態'
if ($receipt) {
 $reason=switch ($receipt.first_blocker) {
  'PREVIOUS_TRADING_DAY_NOT_PROVEN' {'當日來源／交易日交接未成立（休市判定仍須依市場日曆）'}
  'STATIC_SOURCE_MISSING' {'缺當日靜態資料'}
  'FULL_MARKET_LONG_SHORT_RANKING_NOT_COMPLETE' {'全市場多空排名尚未接齊'}
  default { [string]$receipt.first_blocker }
 }
 Write-Host ('狀態：'+$(if($receipt.complete){'完成'}else{'未完成'})+'｜'+$reason) -ForegroundColor Yellow
 foreach($gap in @($receipt.source_blockers)) {if($gap.source){Write-Host ('缺項：'+$gap.source) -ForegroundColor DarkGray}}
} else { Write-Host '找不到執行收據，請檢查來源目錄或 runner.log。' -ForegroundColor Red }
Write-Host ('完整紀錄：'+$InputDirectory) -ForegroundColor DarkGray

