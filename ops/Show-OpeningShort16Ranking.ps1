param([string]$InputPath="outputs\opening-short-16-latest.json",[int]$Top=30,[string]$CsvPath="")
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $InputPath)){throw "Input not found: $InputPath"}
$r=Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8|ConvertFrom-Json
if($r.contract -ne 'opening_short_16_inspection_v1'){throw "Contract mismatch: $($r.contract)"}
$rows=@($r.rows|Sort-Object @{e='matched_count';Descending=$true},@{e='symbol';Descending=$false})
Write-Host "Opening short 16-condition readonly scan" -ForegroundColor Cyan
Write-Host ("date={0} checked={1} qualified={2} action_guard={3}" -f $r.trade_date,$r.checked_count,$r.qualified_count,$r.action_guard)
$out=foreach($x in ($rows|Select-Object -First $Top)){
 $b=if($x.top_buy_branch){"{0} price={1} buy={2} sell={3}"-f $x.top_buy_branch.securities_trader,$x.top_buy_branch.price,$x.top_buy_branch.buy,$x.top_buy_branch.sell}else{'-'}
 $d=$x.daily_metrics;$de=$x.dealer;$tb=$x.telegram_tail_burst
 [pscustomobject]@{Rank=($rows.IndexOf($x)+1);Symbol=$x.symbol;Name=$x.name;Matches=$x.matched_count;Volume='';Foreign='';Trust='';MainForce='';Monthly='';DailyMA=("MA5={0};MA10={1};MA20={2}"-f $d.ma5,$d.ma10,$d.ma20);Bollinger='';Turnover='';Change='';LimitStatus=if($d.limit_opened_or_unlocked){'OPENED'}elseif($d.limit_locked){'LOCKED'}else{'-'};Dealer=("buy={0};sell={1};net={2}"-f $de.buy,$de.sell,$de.net);TailBurst=if($tb.matched){'YES'}else{'NO'};TopBranchCost=$b;Decision=if($x.qualified){'SHORT'}else{'WATCH'};Reason=if($x.data_gaps.Count){$x.data_gaps -join ';'}else{'Matched strategies: '+($x.matched_strategy_numbers -join ',')}}
}
$out|Format-Table -AutoSize
if($CsvPath){$out|Export-Csv -LiteralPath $CsvPath -NoTypeInformation -Encoding UTF8;Write-Host ("CSV: "+$CsvPath) -ForegroundColor Green}
