"use strict";
const fs=require('fs'),path=require('path');
const {indicatorTrend,CONTRACT:INDICATOR_CONTRACT,MIN_BARS}=require('./technical-indicators');
const CONTRACT='institution-candidate90-daily-up-hourly60-bonus-v1',MIN_COVERAGE=.9;
const DAILY_TABLE='strategy4_daily_ohlcv_view';
const secret=name=>fs.readFileSync(path.join(process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime','secrets',name),'utf8').trim();
const ago=(date,days)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10)};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function readTechnicalSources(candidates,tradeDate,options={}){
 const url=secret('supabase-url.txt'),key=secret('supabase-service-role-key.txt');
 const dailyTable=options.dailyTable||DAILY_TABLE;
 let fugleKey='';try{fugleKey=secret('fugle-api-key.txt')}catch(e){if(!options.optionalHourly)throw e}
 const sources={};for(const r of candidates)sources[r.code]={daily:[],hourly60:[],errors:[],fetchedAt:new Date().toISOString()};
 const codes=candidates.map(r=>r.code);
 for(let i=0;i<codes.length;i+=20){const batch=codes.slice(i,i+20);try{for(let offset=0;;offset+=1000){const u=new URL(url+'/rest/v1/'+dailyTable);for(const[k,v]of Object.entries({select:'symbol,trade_date,open,high,low,close',symbol:'in.('+batch.join(',')+')',and:'(trade_date.gte.'+ago(tradeDate,60)+',trade_date.lte.'+tradeDate+')',order:'symbol.asc,trade_date.asc',limit:'1000',offset:String(offset)}))u.searchParams.set(k,v);const r=await fetch(u,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('daily_source_HTTP_'+r.status);const rows=await r.json();for(const row of rows)if(sources[row.symbol])sources[row.symbol].daily.push({...row,date:row.trade_date});if(rows.length<1000)break;}}catch(e){for(const code of batch)sources[code].errors.push(options.optionalHourly?'daily_fetch:'+e.message:e.message)}}
 let nextRequest=0,completed=0;
 for(const code of codes){const s=sources[code];if(s.daily.length<MIN_BARS||s.daily.at(-1)?.trade_date!==tradeDate){s.errors.push('daily_history_missing_or_stale');continue}
  if(!fugleKey){s.errors.push('hourly60_key_unavailable');continue}
  for(let attempt=0;attempt<3;attempt++){await sleep(Math.max(0,nextRequest-Date.now()));nextRequest=Date.now()+1100;
   try{const u=new URL('https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/'+encodeURIComponent(code));for(const[k,v]of Object.entries({from:ago(tradeDate,14),to:tradeDate,timeframe:'60',sort:'asc'}))u.searchParams.set(k,v);const r=await fetch(u,{headers:{'X-API-KEY':fugleKey},signal:AbortSignal.timeout(30000)});if(r.status===429){nextRequest=Date.now()+Math.max(60000,Number(r.headers.get('retry-after')||60)*1000);throw Error('hourly60_rate_limit')};if(!r.ok)throw Error('hourly60_HTTP_'+r.status);const p=await r.json();if(String(p.symbol)!==code||String(p.timeframe)!=='60'||!Array.isArray(p.data))throw Error('hourly60_source_identity_mismatch');s.hourly60=p.data;s.fetchedAt=new Date().toISOString();break;}catch(e){if(attempt===2||/HTTP_40[034]/.test(e.message)){s.errors.push(e.message);break;}nextRequest=Math.max(nextRequest,Date.now()+3000*(attempt+1));}}
  completed++;if(completed%25===0)console.log('institution technical source read '+completed+'/'+codes.length);
 }
 return sources;
}
function timeframeEvidence(rows,tradeDate,hourly=false){const ordered=[...(rows||[])].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));const last=ordered.at(-1);if(!last||String(last.date).slice(0,10)!==tradeDate)return{available:false,reason:'source_date_not_today'};
 if(hourly&&(Date.parse(last.date)!==Date.parse(tradeDate+'T13:00:00+08:00')||Date.now()<Date.parse(tradeDate+'T13:30:00+08:00')))return{available:false,reason:'last_session_60m_not_complete'};
 const previous=ordered.at(-2);
 if(hourly&&(!previous||Date.parse(previous.date)!==Date.parse(tradeDate+'T12:00:00+08:00')))return{available:false,reason:'previous_session_60m_missing'};
 if(new Set(ordered.map(b=>Date.parse(b.date))).size!==ordered.length)return{available:false,reason:'duplicate_bar_time'};
 const trend=indicatorTrend(ordered);return{...trend,previousBarTime:previous?.date,source:hourly?'fugle:historical/candles:60':'supabase:'+DAILY_TABLE,lastBarTime:last.date,completedAt:hourly?tradeDate+'T13:30:00+08:00':tradeDate+'T13:30:00+08:00'};
}
function evaluateCandidates(candidates,sources,tradeDate,extraIssues={}){const selected=[],missing=[],notBullish=[],ready=[];for(const row of candidates){const s=sources[row.code]||{errors:['technical_source_missing']},daily=timeframeEvidence(s.daily,tradeDate),hourly60=timeframeEvidence(s.hourly60,tradeDate,true);const reasons=[...(extraIssues[row.code]||[])];for(const f of ['code','name','market','foreign','trust','dealer','total','foreignStreak','trustStreak','jointStreak'])if(row[f]===null||row[f]===undefined||String(row[f]).trim()==='')reasons.push('missing_'+f);if(!(row.close>0&&row.tradeVolume>0&&row.fiveDayAvgVolume>0))reasons.push('required_trading_fields_missing');if(!daily.available)reasons.push('daily_'+daily.reason);
 if(reasons.length){missing.push({code:row.code,reasons:[...new Set(reasons)]});continue;}ready.push(row.code);const technicalTrend={contract:CONTRACT,indicatorContract:INDICATOR_CONTRACT,daily,hourly60,hourly60Bonus:Boolean(hourly60.available&&hourly60.trendUp),pass:daily.trendUp};if(!technicalTrend.pass){notBullish.push(row.code);continue;}selected.push({...row,technicalTrend});}
 const candidateCount=candidates.length,readyCount=ready.length,coverage=candidateCount?readyCount/candidateCount:1;const selectionCoverage={contract:CONTRACT,indicatorContract:INDICATOR_CONTRACT,minCoverage:MIN_COVERAGE,candidateCount,dataReadyCount:readyCount,dataMissingCount:missing.length,dataCoverage:coverage,technicalRejectedCount:notBullish.length,resultCount:selected.length,candidateSymbols:candidates.map(r=>r.code),readySymbols:ready,incompleteSymbols:missing,notBullishSymbols:notBullish,ok:coverage>=MIN_COVERAGE};return{selected,selectionCoverage};}
module.exports={CONTRACT,MIN_COVERAGE,DAILY_TABLE,readTechnicalSources,timeframeEvidence,evaluateCandidates};
