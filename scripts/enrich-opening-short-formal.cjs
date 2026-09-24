"use strict";
const fs=require('fs'),path=require('path');
const arg=(n,d)=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3)||d;
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const conditionScore=require('./short-condition-score.cjs');
const premarket=require('./short-premarket-final.cjs');
const dual=require('./short-dual-scenario.cjs');
const branchPriority=require('./short-branch-priority.cjs');
const openingMap=require('./short-opening-map.cjs');
const tech=require('./short-technical-sources.cjs');
const ab=require('./short-ab-v1.cjs'),abConfig=require('./short-ab-v1.config.json');
const boll=require('./bollinger-position.cjs'),priority=require('./short-position-priority.cjs');
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
async function main(){
 const file=arg('report'); const r=JSON.parse(fs.readFileSync(file,'utf8'));const date=r.trade_date;
 const bc=boll.config(JSON.parse(fs.readFileSync(arg('boll-config',path.join(__dirname,'bollinger-position.config.json')))));
 const pc=JSON.parse(fs.readFileSync(arg('priority-config',path.join(__dirname,'short-position-priority.config.json'))));
 const techSources=tech.read(date);
 const tgPath='C:/fuman-runtime/data/scan-receipts/daytrade-intraday-burst-telegram-'+date.replaceAll('-','')+'.json';let tg=null;try{tg=JSON.parse(fs.readFileSync(tgPath));}catch{}
 const tgValid=tg?.trade_date===date&&tg?.complete===true;const tgSent=Array.isArray(tg?.sent_events)?tg.sent_events:[];

 const keylib=require(arg('root','C:/fuman-release-owner/fuman-terminal')+'/lib/server-supabase-key');
 const cache=path.join(path.dirname(file),'opening-short-sources-'+date);fs.mkdirSync(cache,{recursive:true});
 async function rest(table,params){const rows=[];for(let offset=0;;offset+=1000){const q=new URLSearchParams(params);q.set('limit','1000');q.set('offset',String(offset));const k=keylib.terminalSupabaseKey();const res=await fetch(keylib.terminalSupabaseUrl()+'/rest/v1/'+table+'?'+q,{headers:{apikey:k,Authorization:'Bearer '+k},signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error(table+' HTTP '+res.status);const a=await res.json();if(!Array.isArray(a))throw Error('INVALID_ROWS');rows.push(...a);if(a.length<1000)break;}return rows}
 async function cached(name,fetcher){const f=path.join(cache,name+'.json');if(fs.existsSync(f))return JSON.parse(fs.readFileSync(f,'utf8'));const a=await fetcher();fs.writeFileSync(f,JSON.stringify(a));return a}
 const start=new Date(Date.parse(date)-70*86400000).toISOString().slice(0,10);
 const daily=arg('daily-source')?JSON.parse(fs.readFileSync(arg('daily-source'))).rows:await cached('daily',()=>rest('strategy4_daily_ohlcv_view',[['select','symbol,name,trade_date,open,high,low,close,volume_lots,volume_shares,source,updated_at'],['trade_date','gte.'+start],['trade_date','lte.'+date],['order','symbol.asc,trade_date.asc']]));
 const inst=arg('institution-source')?JSON.parse(fs.readFileSync(arg('institution-source'))).data:await cached('institution',async()=>{const token=process.env.FINMIND_TOKEN||fs.readFileSync('C:/fuman-runtime/secrets/finmind-token.txt','utf8').trim();const q=new URLSearchParams({dataset:'TaiwanStockInstitutionalInvestorsBuySell',start_date:date,end_date:date});const res=await fetch('https://api.finmindtrade.com/api/v4/data?'+q,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});const j=await res.json();if(!res.ok||j.status!==200)throw Error('FINMIND_INSTITUTION_FAILED');return j.data});
 const previousTradeDate=[...new Set(daily.map(x=>x.trade_date).filter(x=>x<date))].sort().at(-1);
 let prevInst=[];try{prevInst=await cached('institution-previous',async()=>{if(!previousTradeDate)return [];const token=process.env.FINMIND_TOKEN||fs.readFileSync('C:/fuman-runtime/secrets/finmind-token.txt','utf8').trim();const q=new URLSearchParams({dataset:'TaiwanStockInstitutionalInvestorsBuySell',start_date:previousTradeDate,end_date:previousTradeDate});const res=await fetch('https://api.finmindtrade.com/api/v4/data?'+q,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});const j=await res.json();if(!res.ok||j.status!==200)throw Error('PREVIOUS_INSTITUTION_FAILED');return j.data;});}catch{}
 const previousInstitutions=new Map();for(const x of prevInst){if(x.date!==previousTradeDate)continue;const list=previousInstitutions.get(x.stock_id)||[];list.push(x);previousInstitutions.set(x.stock_id,list);}
 const counts=new Map();for(const d of daily)counts.set(d.symbol,(counts.get(d.symbol)||0)+1);
 for(const row of r.rows){if((counts.get(row.symbol)||0)>=23)continue;const extra=await cached('history-'+row.symbol,()=>rest('strategy4_daily_ohlcv_view',{select:'symbol,name,trade_date,open,high,low,close,volume_lots,volume_shares,source,updated_at',symbol:'eq.'+row.symbol,trade_date:'lte.'+date,order:'trade_date.desc'}));daily.push(...extra);}
 const capital=await cached('capital',()=>rest('stock_capital_latest',{select:'code,issued_shares,updated_at',order:'code.asc'}));
 const quotes=await cached('quotes',()=>rest('fugle_daytrade_quotes_live',{select:'symbol,trade_date,limit_up_price,previous_close',trade_date:'eq.'+date,order:'symbol.asc'}));
 const cap=new Map(capital.map(x=>[x.code,x])),qp=new Map(quotes.map(x=>[x.symbol,x]));
 const branchMap=new Map();const token=process.env.FINMIND_TOKEN||fs.readFileSync('C:/fuman-runtime/secrets/finmind-token.txt','utf8').trim();
 const branchRows=r.rows.filter(row=>{const bars=daily.filter(x=>x.symbol===row.symbol),z=premarket.calculate(row.symbol,date,bars),last=bars.filter(x=>x.trade_date===date).at(-1);const scenarios=dual.evaluate(z);return (scenarios.a.pass||scenarios.b.pass||scenarios.b.needs_evidence)&&Number(last?.volume_lots)>2000;});
 let next=0;await Promise.all(Array.from({length:3},async()=>{while(next<branchRows.length){const row=branchRows[next++];try{const data=await cached('branch-'+row.symbol,async()=>{const q=new URLSearchParams({dataset:'TaiwanStockTradingDailyReport',data_id:row.symbol,start_date:date,end_date:date});const res=await fetch('https://api.finmindtrade.com/api/v4/data?'+q,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});const j=await res.json();if(!res.ok||j.status!==200)throw Error('BRANCH_HTTP_'+res.status);return j.data});const m=new Map();for(const x of data){if(x.date!==date||String(x.stock_id)!==row.symbol)continue;const id=x.securities_trader_id;if(!id||num(x.buy)===null||num(x.sell)===null||num(x.price)===null)continue;const b=m.get(id)||{securities_trader:x.securities_trader,buy:0,sell:0,amount:0,date};b.buy+=Number(x.buy);b.sell+=Number(x.sell);b.amount+=Number(x.buy)*Number(x.price);m.set(id,b)}const top=[...m.values()].filter(x=>x.buy>x.sell).sort((a,b)=>(b.buy-b.sell)-(a.buy-a.sell))[0];if(top)branchMap.set(row.symbol,{...top,price:top.amount/top.buy,cost_method:'buy_volume_weighted_average',source:'FinMind:TaiwanStockTradingDailyReport'});}catch(e){branchMap.set(row.symbol,{error:e.message})}}}));
 const limitTickers=new Map();
 for(const row of branchRows){
  const last=daily.find(x=>x.symbol===row.symbol&&x.trade_date===date),q=qp.get(row.symbol);
  const f=path.join(cache,'limit-ticker-'+row.symbol+'.json');
  if(!fs.existsSync(f)&&branchPriority.normalize(branchMap.get(row.symbol)?.securities_trader)!=='凱基城中'&&!(num(last?.high)>num(q?.limit_up_price)))continue;
  try{
   let j;if(fs.existsSync(f))j=JSON.parse(fs.readFileSync(f));else{
    const key=fs.readFileSync('C:/fuman-runtime/secrets/fugle-api-key.txt','utf8').trim();
    const res=await fetch('https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/'+row.symbol,{headers:{'X-API-KEY':key},signal:AbortSignal.timeout(20000)});
    if(!res.ok)throw Error('LIMIT_TICKER_HTTP_'+res.status);j=await res.json();
    if(j.date===date&&j.symbol===row.symbol)fs.writeFileSync(f,JSON.stringify(j));
   }
   if(j.date===date&&j.symbol===row.symbol&&num(j.limitUpPrice)>0)limitTickers.set(row.symbol,j);
  }catch{/* Keep unverified inconsistent limits UNKNOWN; never infer from a rounded return. */}
 }
 const by=new Map(),ib=new Map();for(const x of daily){if(x.trade_date>date)continue;const a=by.get(x.symbol)||[];a.push(x);by.set(x.symbol,a)}for(const x of inst){if(x.date!==date)continue;const a=ib.get(x.stock_id)||[];a.push(x);ib.set(x.stock_id,a)}
 const disabled=[1,4,8,10,12,13,16];
 for(const row of r.rows){
  const a=[...new Map((by.get(row.symbol)||[]).map(x=>[x.trade_date,x])).values()].sort((a,b)=>a.trade_date.localeCompare(b.trade_date)),d=a.at(-1),p=a.at(-2),current=d?.trade_date===date,cs=a.map(x=>num(x.close)),ma=k=>current&&cs.length>=k&&cs.slice(-k).every(v=>v!==null)?mean(cs.slice(-k)):null;
  row.name=d?.name||row.name;row.data_gaps=[];row.matched_strategy_numbers=(row.matched_strategy_numbers||[]).filter(n=>![...disabled,2,3,5,6,7,9,10,11,14,18].includes(n));row.checks={};
  function check(id,label,value){row.checks[label]={id,matched:value===true,status:value===null?'DATA_GAP':value?'MATCHED':'NOT_MATCHED'};if(value===true)row.matched_strategy_numbers.push(id);if(value===null)row.data_gaps.push(label+'資料缺口')}
  const m5=ma(5),m10=ma(10),m20=ma(20),prev20=current&&cs.length>=21&&cs.slice(-21,-1).every(v=>v!==null)?mean(cs.slice(-21,-1)):null;
  const sd=m20===null?null:Math.sqrt(mean(cs.slice(-20).map(x=>(x-m20)**2)));
  row.daily_metrics={source:'supabase:strategy4_daily_ohlcv_view',trade_date:d?.trade_date||null,history_count:a.length,ma5:m5,ma10:m10,ma20:m20,previous_ma20:prev20,close:current?d.close:null,volume_lots:current?num(d.volume_lots):null,previous_volume_lots:num(p?.volume_lots),change_percent:current&&num(p?.close)>0?(d.close/p.close-1)*100:null,bollinger_upper:sd===null?null:m20+2*sd,bollinger_middle:m20,bollinger_lower:sd===null?null:m20-2*sd};
  delete row.price_position; delete row.return_position;
  const bm=boll.calculate(a,date,bc);Object.assign(row,{...bm,symbol:row.symbol});row.name=d?.name||row.name;
  row.bollinger_position={...bm,value:bm.boll_position_raw,weak:bm.boll_position_raw===null?null:bm.position_status==='WEAK',grade:bm.position_zone,counts_toward_score:true};
  check(18,'布林位階弱勢門檻',row.bollinger_position.weak);
  check(2,'成交量放大',current&&num(d.volume_lots)!==null&&num(p?.volume_lots)!==null?d.volume_lots>p.volume_lots:null);
  const previousMa=k=>current&&cs.length>=k+1&&cs.slice(-k-1,-1).every(Number.isFinite)?mean(cs.slice(-k-1,-1)):null;
  const previous=[previousMa(5),previousMa(10),previousMa(20)],latest=[m5,m10,m20];
  row.daily_metrics.previous_ma5=previous[0];row.daily_metrics.previous_ma10=previous[1];
  row.daily_metrics.all_ma_down=[...latest,...previous].every(Number.isFinite)?latest.every((v,i)=>v<previous[i]):null;
  row.daily_metrics.price_below_all_ma=current&&[num(d.close),m5,m10,m20].every(Number.isFinite)?[m5,m10,m20].every(v=>Number(d.close)<v):null;
  row.daily_metrics.ma20_slope_percent=Number.isFinite(m20)&&Number.isFinite(prev20)&&prev20>0?(m20/prev20-1)*100:null;
  check(5,'月線下彎',row.daily_metrics.ma20_slope_percent===null?null:row.daily_metrics.ma20_slope_percent<0);check(6,'股價低於三均線',row.daily_metrics.price_below_all_ma);
  check(7,'布林中軌以上',m20!==null?d.close>=m20:null);
  function group(names,input=ib.get(row.symbol)||[]){const z=input.filter(x=>names.includes(x.name));if(!names.every(n=>z.some(x=>x.name===n))||z.some(x=>num(x.buy)===null||num(x.sell)===null))return null;const buy=z.reduce((s,x)=>s+Number(x.buy),0)/1000,sell=z.reduce((s,x)=>s+Number(x.sell),0)/1000;return{buy,sell,net:buy-sell,unit:'lots',trade_date:date,source:'FinMind:TaiwanStockInstitutionalInvestorsBuySell'}}
  row.foreign=group(['Foreign_Investor','Foreign_Dealer_Self']);row.trust=group(['Investment_Trust']);row.dealer=group(['Dealer_self','Dealer_Hedging']);if(!row.dealer)row.dealer=group(['Dealer']);
  // Institutional flows are display-only in the current premarket filter.
  const shares=num(cap.get(row.symbol)?.issued_shares),ticker=limitTickers.get(row.symbol),rawLimit=num(ticker?.limitUpPrice??qp.get(row.symbol)?.limit_up_price);
  const limit=rawLimit>0&&current&&num(d.high)<=rawLimit+1e-8?rawLimit:null;
  row.daily_metrics.limit_source=ticker?'Fugle:intraday/ticker:'+date:'fugle_daytrade_quotes_live:'+date;
  row.daily_metrics.limit_source_status=limit===null?'MISSING_OR_INCONSISTENT':'OK';
  row.turnover_rate=current&&shares>0?d.volume_shares/shares*100:null;row.turnover_source={source:'stock_capital_latest.issued_shares + strategy4_daily_ohlcv_view.volume_shares',issued_shares:shares,capital_updated_at:cap.get(row.symbol)?.updated_at||null};check(9,'週轉率大於5%',row.turnover_rate===null?null:row.turnover_rate>5);
  row.daily_metrics.limit_price=limit;row.daily_metrics.limit_touched=current&&limit>0?d.high>=limit:null;row.daily_metrics.limit_locked=current&&limit>0?d.close===limit:null;row.daily_metrics.limit_opened_or_unlocked=current&&limit>0?d.high>=limit&&d.close<limit:null;check(11,'漲停觸及未收鎖',row.daily_metrics.limit_opened_or_unlocked);
  row.top_buy_branch=branchMap.get(row.symbol)||null;if(!row.top_buy_branch||row.top_buy_branch.error){row.branch_error=row.top_buy_branch?.error||'NO_BUY_BRANCH';row.top_buy_branch=null;row.data_gaps.push('當日買一分點資料缺口')}
  delete row.side_volume;
  row.matched_strategy_numbers=row.matched_strategy_numbers.filter(n=>n!==17);
  check(17,'總成交量大於2000張',row.daily_metrics.volume_lots===null?null:row.daily_metrics.volume_lots>2000);
  row.matched_strategy_numbers=[...new Set(row.matched_strategy_numbers)].sort((a,b)=>a-b);row.matched_count=row.matched_strategy_numbers.length;row.qualified=false;
  const dailyTrend=row.daily_metrics.price_below_all_ma===true?'BEARISH':current&&[m5,m10,m20,num(d?.close)].every(Number.isFinite)?[m5,m10,m20].every(v=>Number(d.close)>v)?'BULLISH':'NEUTRAL':'UNKNOWN';
  row.short_priority=priority.evaluate(bm,dailyTrend,'UNKNOWN','UNKNOWN',row.matched_strategy_numbers,pc);
  row.short_priority.symbol=row.symbol;Object.assign(row,row.short_priority);
  row.ma20_slope_percent=row.daily_metrics.ma20_slope_percent;
  row.first_priority_band=bm.boll_position_raw!==null&&bm.boll_position_raw>=pc.first_priority_band.min&&bm.boll_position_raw<pc.first_priority_band.max&&row.ma20_slope_percent<pc.first_priority_band.slope_max_exclusive;
  row.hourly_evidence=tech.hourly(techSources.get(row.symbol),date);if(row.hourly_evidence.trend==='UNKNOWN')row.hourly_evidence=tech.hourlyFrom30(cache,row.symbol,date);row.hourly_trend=row.hourly_evidence.trend;
  row.daily_indicator_evidence=current?tech.technical(a):{trend:'UNKNOWN',reason:'STALE_DAILY_SOURCE'};
  row.ema30_evidence=tech.ema30(cache,row.symbol,date);row.ema30_trend=row.ema30_evidence.trend;
  const pi=previousInstitutions.get(row.symbol)||[];const pf=group(['Foreign_Investor','Foreign_Dealer_Self'],pi),pt=group(['Investment_Trust'],pi),pd=group(['Dealer_self','Dealer_Hedging'],pi)||group(['Dealer'],pi);
  row.previous_institution={date:previousTradeDate,source:'FinMind:TaiwanStockInstitutionalInvestorsBuySell',foreign_net:pf?.net??null,trust_net:pt?.net??null,dealer_net:pd?.net??null,total_net:pf&&pt&&pd?pf.net+pt.net+pd.net:null};
  const sentBursts=tgSent.filter(e=>String(e.symbol)===row.symbol&&(e.trade_date||e.tradeDate)===date&&/volume_burst|瞬間巨量|盤中巨量/.test(String(e.trigger_type||'')+' '+String(e.notification_type||'')));
  row.telegram_intraday_notification={source:tgPath,status:sentBursts.length?'SENT':tgValid?'NO_SENT_BURST':'UNKNOWN',count:sentBursts.length};
  row.premarket_final=premarket.calculate(row.symbol,date,a);
  row.dual_scenario=dual.evaluate(row.premarket_final,row);
  row.branch_priority=branchPriority.evaluate(row,date);
  row.ab_v1=ab.evaluate(row,a,abConfig);row.ab_v1.open_map=openingMap.build(row,d);
  row.core_test_band=bm.boll_position_raw!==null&&bm.boll_position_raw>=pc.core_test_band.min&&bm.boll_position_raw<pc.core_test_band.max&&row.ma20_slope_percent!==null&&row.ma20_slope_percent>=pc.core_test_band.slope_min&&row.ma20_slope_percent<pc.core_test_band.slope_max_exclusive;

 }
 r.premarket_final={version:'MONTH_SLOPE_BOLL_DUAL_REVISED_HIGH_8_V1',scope:'PREMARKET_ONLY',symbols:r.rows.filter(x=>(x.dual_scenario.a.pass||x.dual_scenario.b.pass)&&x.daily_metrics.volume_lots>2000).map(x=>x.symbol)};
 for(const row of r.rows){row.condition_score=conditionScore.calculate(row);row.b_condition_score=conditionScore.calculate(row,'B');}
 const selected=r.rows.filter(x=>r.premarket_final.symbols.includes(x.symbol));
 const sorted=(rows,key)=>rows.sort((a,b)=>b[key].score-a[key].score||a.symbol.localeCompare(b.symbol)).map(x=>x.symbol);
 r.premarket_final.a_symbols=sorted(selected.filter(x=>x.dual_scenario.a.pass),'condition_score');
 r.premarket_final.b_symbols=sorted(selected.filter(x=>x.dual_scenario.b.pass),'b_condition_score');
 r.premarket_final.evidence_symbols=r.rows.filter(x=>x.daily_metrics.volume_lots>2000&&(x.dual_scenario.a.pass||x.dual_scenario.b.pass||x.dual_scenario.b.needs_evidence)).map(x=>x.symbol);
 r.premarket_final.counts={A:r.premarket_final.a_symbols.length,B:r.premarket_final.b_symbols.length,unique:selected.length};
 r.premarket_final.ranking_rule='Each scenario score descending then symbol; A/B independently evaluated; not win rate';
 r.ab_v1={version:'SHORT_AB_V1',config:abConfig,status:'PARTIAL_MISSING_SOURCES',score_policy:'A/B separate; null components not confirmed',a_symbols:r.rows.filter(x=>x.ab_v1.a_short_candidate===true).sort((a,b)=>b.ab_v1.a_short_score-a.ab_v1.a_short_score||a.symbol.localeCompare(b.symbol)).map(x=>x.symbol),b_symbols:r.rows.filter(x=>x.ab_v1.b_short_candidate===true).sort((a,b)=>b.ab_v1.b_short_score-a.ab_v1.b_short_score||a.symbol.localeCompare(b.symbol)).map(x=>x.symbol),unknown_count:r.rows.filter(x=>x.ab_v1.short_type==='UNDETERMINED').length,none_count:r.rows.filter(x=>x.ab_v1.short_type==='NONE').length,active_ranking:'AB_SEPARATE_SCORES',legacy_priority_ranking:'RESEARCH_ONLY'};
 r.bollinger_parameters=bc;r.priority_parameters=pc;
 r.short_watchlist=r.rows.filter(x=>x.main_list).sort((a,b)=>Number(b.first_priority_band)-Number(a.first_priority_band)||priority.compare(a,b)).map(x=>x.symbol);
 r.short_top5=r.short_watchlist.slice(0,5);
 r.short_tier_counts=Object.fromEntries(['A','B','C','EXCLUDE','UNKNOWN'].map(t=>[t,r.rows.filter(x=>x.candidate_tier===t).length]));
 r.priority_module_status='PARTIAL_MISSING_INTRADAY_TRENDS';
 r.daily_trend_contract='BEARISH: close below MA5,MA10,MA20; BULLISH: above all; NEUTRAL: otherwise; UNKNOWN: missing';
 r.rows.sort((a,b)=>b.matched_count-a.matched_count||a.symbol.localeCompare(b.symbol));r.qualified_count=0;r.formal_receipt_status='DEGRADED';r.source_contract.daily_price='supabase:strategy4_daily_ohlcv_view';r.source_contract.institutional='FinMind:TaiwanStockInstitutionalInvestorsBuySell';r.disabled_condition_ids=disabled;r.turnover_threshold_percent=5;r.failed_checks=[...new Set(r.rows.flatMap(x=>x.data_gaps))];r.first_blocker=r.failed_checks[0]||null;r.complete=false;
 delete r.source_contract.side_volume;
 r.source_contract.condition17='strategy4_daily_ohlcv_view.volume_lots > 2000';
 r.source_contract.bollinger_position={source:'strategy4_daily_ohlcv_view',parameters:bc,formula:'10*(close-mean)/(std_multiplier*population_sd)',condition18:'raw < weak_threshold'};
 r.bollinger_position_coverage={passed:r.rows.filter(x=>x.bollinger_position.status==='OK').length,total:r.rows.length,below8:r.rows.filter(x=>x.bollinger_position.weak===true).length};
 delete r.source_contract.price_position; delete r.source_contract.return_position;
 delete r.price_position_coverage; delete r.return_position_coverage;
 r.labels=[...new Set(r.rows.flatMap(x=>Object.keys(x.checks)))];
 const coverage=(test,minimum)=>{const passed=r.rows.filter(test).length;return{passed,total:r.rows.length,minimum,ratio:r.rows.length?passed/r.rows.length:0,ok:r.rows.length>0&&passed/r.rows.length>=minimum}};
 r.coverage_checks={daily:coverage(x=>x.daily_metrics.volume_lots!==null&&x.daily_metrics.change_percent!==null,.9),technical:coverage(x=>[x.daily_metrics.ma5,x.daily_metrics.ma10,x.daily_metrics.ma20,x.daily_metrics.previous_ma20,x.daily_metrics.bollinger_upper].every(Number.isFinite),.9),turnover:coverage(x=>Number.isFinite(x.turnover_rate),.9),institution:coverage(x=>x.foreign&&x.trust&&x.dealer,1),branch:coverage(x=>x.top_buy_branch,1)};
 const selectedRows=r.rows.filter(x=>r.premarket_final.symbols.includes(x.symbol));const selectedCoverage=test=>{const passed=selectedRows.filter(test).length;return{scope:'selected_candidates',passed,total:selectedRows.length,minimum:1,ratio:selectedRows.length?passed/selectedRows.length:1,ok:passed===selectedRows.length};};r.coverage_checks.branch=selectedCoverage(x=>x.top_buy_branch);r.coverage_checks.institution=selectedCoverage(x=>x.foreign&&x.trust&&x.dealer);
 r.limit_status_policy='Untriggered is NOT_MATCHED; missing is DATA_GAP, optional for overall coverage acceptance';
 r.failed_checks=Object.entries(r.coverage_checks).filter(([,x])=>!x.ok).map(([k])=>'COVERAGE_'+k);r.first_blocker=r.failed_checks[0]||null;
 r.coverage_accepted=r.failed_checks.length===0;r.formal_receipt_status=r.coverage_accepted?'COVERAGE_ACCEPTED':'DEGRADED';
 fs.writeFileSync(file,JSON.stringify(r,null,2));const readback=JSON.parse(fs.readFileSync(file));if(readback.rows.some(x=>x.matched_count!==x.matched_strategy_numbers.length))throw Error('COUNT_READBACK_FAILED');console.log(JSON.stringify({rows:r.rows.length,coverage:r.coverage_checks,status:r.formal_receipt_status}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
