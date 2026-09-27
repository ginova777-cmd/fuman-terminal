'use strict';
const fs=require('fs'),path=require('path');
const {costTopBuyer}=require('./main-broker-cost.cjs');
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
function normalize({symbol,tradeDate,previousDate,source,bars,quote,now}){
 const gaps=[],daily=source?.price_rows?.filter(x=>x.stock_id===symbol&&x.date===previousDate)||[];
 const available=source?.trade_date===tradeDate&&source?.symbol===symbol&&source?.signal_date===previousDate&&Number.isFinite(Date.parse(source?.fetched_at))&&Date.parse(source.fetched_at)<=Date.parse(now);
 const d=available&&daily.length===1?daily[0]:null;
 if(!d||!positive(d.close)||!positive(d.min))gaps.push('PREVIOUS_DAILY_SOURCE_MISSING');
 const result=costTopBuyer({rows:available?source.branch_rows:null,symbol,baseDate:previousDate});
 const top=result.selected?.[0],cost=result.valid?result.value:null;
 if(!result.valid)gaps.push(...result.failed_checks.map(reason=>'PREVIOUS_BRANCH_'+reason));
 const opens=bars.filter(b=>b.timestamp&&new Date(Date.parse(b.timestamp)+28800000).toISOString().slice(11,16)==='09:00'&&b.complete===true&&b.is_synthetic===false&&b.stock_id===symbol&&b.trade_date===tradeDate);
 const qt=Date.parse(quote?.exchangeTime),received=Date.parse(quote?.receivedAt||quote?.quoteSeenAt);
 const quoteOpen=quote?.code===symbol&&quote?.isTrial===false&&quote?.isSynthetic===false&&quote?.quoteSource==='fugle-ws'&&Number.isFinite(qt)&&new Date(qt+28800000).toISOString().slice(0,10)===tradeDate&&qt<=Date.parse(now)&&Number.isFinite(received)&&received<=Date.parse(now)&&positive(quote?.open)?quote.open:null;
 const open=opens.length===1&&positive(opens[0].open)?opens[0].open:quoteOpen;if(open===null)gaps.push('ACTUAL_OPEN_SOURCE_MISSING');
 return {stock_id:symbol,trade_date:tradeDate,previous_trade_date:previousDate,available_at:available?source.fetched_at:now,cost:positive(cost)?cost:null,open,previous_close:positive(d?.close)?d.close:null,previous_low:positive(d?.min)?d.min:null,gaps,source:'opening-limit-order-0850-static-sources + Fugle.websocket.09:00',cost_method:'top_net_buy_branch_buy_vwap',cost_evidence:result,branch_id:top?.id||null,branch_name:top?.name||null};
}
function load({runtimeRoot,tradeDate,previousDate,groups,quotes={},now}){
 const file=path.join(runtimeRoot,'data/opening-limit-order','opening-limit-order-0850-static-sources-'+tradeDate.replaceAll('-','')+'.json');
 let snapshot=null;try{snapshot=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{}
 const sources=new Map((snapshot?.trade_date===tradeDate&&Array.isArray(snapshot.symbols)?snapshot.symbols:[]).map(x=>[x.symbol,x]));
 return Object.fromEntries(Object.entries(groups).map(([symbol,bars])=>[symbol,{bars,levelInput:normalize({symbol,tradeDate,previousDate,source:sources.get(symbol),bars,quote:quotes[symbol],now})}]));
}
// Fill only symbols needed by an active anomaly. Never fetch the whole market on
// each minute, and cache successful prior-session responses for this trade date.
async function hydrate({runtimeRoot,tradeDate,previousDate,groups,quotes={},symbols,now,fetcher=fetch}){
 const contexts=load({runtimeRoot,tradeDate,previousDate,groups,quotes,now});
 const needed=[...new Set(symbols)].filter(s=>/^\d{4}$/.test(s)&&contexts[s]?.levelInput.gaps.some(g=>g.startsWith('PREVIOUS_')));
 let token=process.env.FINMIND_TOKEN;try{if(!token)token=fs.readFileSync(path.join(runtimeRoot,'secrets/finmind-token.txt'),'utf8').trim();}catch{}
 let cursor=0;
 await Promise.all(Array.from({length:Math.min(3,needed.length)},async()=>{
  while(cursor<needed.length){const symbol=needed[cursor++],file=path.join(runtimeRoot,'data/telegram-detectors/level-sources',tradeDate,symbol+'.json');
   let source;try{source=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
   if(source?.signal_date!==previousDate||source?.trade_date!==tradeDate||source?.symbol!==symbol)source=null;
   if(!source&&token){try{
    async function get(dataset){const q=new URLSearchParams({dataset,data_id:symbol,start_date:previousDate});if(dataset==='TaiwanStockPrice')q.set('end_date',previousDate);const r=await fetcher('https://api.finmindtrade.com/api/v4/data?'+q,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('LEVEL_PROVIDER_HTTP_'+r.status);const j=await r.json();if(j.status!==200||!Array.isArray(j.data)||!j.data.length)throw Error('LEVEL_PROVIDER_EMPTY');return j.data;}
    const [price_rows,branch_rows]=await Promise.all([get('TaiwanStockPrice'),get('TaiwanStockTradingDailyReport')]);
    source={symbol,trade_date:tradeDate,signal_date:previousDate,fetched_at:new Date().toISOString(),price_rows,branch_rows};
    fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(source));fs.renameSync(tmp,file);
   }catch{contexts[symbol].levelInput.gaps.push('LEVEL_PROVIDER_FETCH_FAILED');}}
   if(source){const asOf=new Date().toISOString();contexts[symbol].levelInput=normalize({symbol,tradeDate,previousDate,source,bars:groups[symbol],quote:quotes[symbol],now:asOf});}
  }
 }));
 return contexts;
}
async function previousTradingDate({tradeDate,runtimeRoot}){
 const {isTwseTradingDay}=require('../../scripts/twse-trading-day');
 for(let i=1;i<=20;i++){
  const now=new Date(Date.parse(tradeDate+'T12:00:00+08:00')-i*86400000),r=await isTwseTradingDay(now,{stateDir:path.join(runtimeRoot,'state')});
  if(r.error||r.reason==='weekday_fallback')throw Error('PREVIOUS_TRADING_CALENDAR_UNPROVEN');
  if(r.isTradingDay)return r.date;
 }
 throw Error('PREVIOUS_TRADING_DATE_MISSING');
}
module.exports={normalize,load,hydrate,previousTradingDate};
