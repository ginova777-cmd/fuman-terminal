'use strict';
const fs=require('fs'),path=require('path');
const {calendarFromCache}=require('../lib/telegram-detectors/premarket-runtime-inputs.cjs');
const {adaptDaily}=require('../lib/telegram-detectors/premarket-daily-source.cjs');
function session({runtimeRoot,now}){
 const stamp=Date.parse(now);if(!Number.isFinite(stamp))throw Error('INVALID_CLOCK');
 const date=new Date(stamp+28800000).toISOString().slice(0,10);
 const calendars=[Number(date.slice(0,4))-1,Number(date.slice(0,4)),Number(date.slice(0,4))+1].map(y=>calendarFromCache({runtimeRoot,tradeDate:y+'-06-01'}));
 const current=calendars[1];if(!current.verified)throw Error('CALENDAR_UNVERIFIED');
 const dates=[...new Set(calendars.filter(c=>c.verified).flatMap(c=>c.trading_dates))].sort();
 const baseDate=dates.filter(d=>d<date).at(-1),tradeDate=dates.find(d=>d>=date);if(!baseDate||!tradeDate)throw Error('TRADING_SESSION_NOT_PROVEN');
 return {query_date:date,base_date:baseDate,trade_date:tradeDate,market_open_today:dates.includes(date),calendar_source:current.source};
}
function scan({runtimeRoot='C:/fuman-runtime',now=new Date().toISOString()}){
 const context=session({runtimeRoot,now}),base=context.base_date,trade=context.trade_date;
 const dir=path.join(runtimeRoot,'cache/fugle/historical');
 const technicalDir=path.join(runtimeRoot,'data/institution-technical-source');
 const candidates=fs.existsSync(technicalDir)?fs.readdirSync(technicalDir).filter(f=>f.startsWith('institution-'+base.replaceAll('-','')+'-')&&f.endsWith('.json')).sort():[];
 let flowFile=null,flows=new Map();if(candidates.length){flowFile=path.join(technicalDir,candidates.at(-1));const p=JSON.parse(fs.readFileSync(flowFile));if(p.tradeDate===base)flows=new Map((p.candidates||[]).map(r=>[r.code,r]));}
 const rows=[],gaps=[];
 for(const file of fs.readdirSync(dir).filter(f=>/^\d{4}\.json$/.test(f)).sort()){
  const symbol=file.slice(0,4),sourceFile=path.join(dir,file);let p;try{p=JSON.parse(fs.readFileSync(sourceFile));}catch{gaps.push({symbol,reason:'PRICE_FILE_INVALID'});continue;}
  let normalized;try{normalized=require('../lib/telegram-detectors/institution-buy-surge.cjs').deduplicate((p.rows||[]).filter(r=>r.date<=base));}catch(e){gaps.push({symbol,reason:e.message});continue;}const prices=normalized.rows;if(!prices.some(r=>r.date===base)){gaps.push({symbol,reason:'BASE_DAY_PRICE_MISSING'});continue;}
  const f=flows.get(symbol);
  const source={symbol,trade_date:trade,signal_date:base,fetched_at:now,price_rows:prices.map(r=>({stock_id:symbol,date:r.date,open:r.open,max:r.high,min:r.low,close:r.close,Trading_Volume:Number.isFinite(r.volume_shares)?r.volume_shares:Number.isFinite(r.volume_lots)?r.volume_lots*1000:r.volumeUnit==='lots'?r.volume*1000:r.volume})),branch_rows:[],institutional_rows:[]};
  const d=adaptDaily({source,symbol,baseDate:base,tradeDate:trade,asOf:now}),c=d.short_rank_input?.current,prev=d.short_rank_input?.previous;
  if(!c||!prev){gaps.push({symbol,reason:d.reason||'INDICATORS_MISSING'});continue;}
  const sign=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?Math.sign(a-b):null;
  const kd=[sign(c.kd.k,prev.kd.k),sign(c.kd.d,prev.kd.d)],rsi=[sign(c.rsi.short,prev.rsi.short),sign(c.rsi.long,prev.rsi.long)],macd=sign(c.macd.histogram,prev.macd.histogram);
  const longChecks={kd_up:kd.every(x=>x===1),rsi_up:rsi.every(x=>x===1),macd_up:macd===1};
  const shortChecks={kd_down:kd.every(x=>x===-1),rsi_down:rsi.every(x=>x===-1),macd_down:macd===-1};
  const up=Object.values(longChecks).filter(Boolean).length,down=Object.values(shortChecks).filter(Boolean).length;
  rows.push({stock_id:symbol,name:f?.name||'',base_date:base,previous:d.previous_ohlc,source_file:sourceFile,identical_duplicates_removed:normalized.removed,volume_risk:require('../lib/telegram-detectors/institution-buy-surge.cjs').volumeRisk(prices,base),institution_source:f?flowFile:null,institutions:f?{foreign:f.foreign,trust:f.trust,dealer_total:f.dealer}:null,cost:null,cost_status:'BASE_DAY_BRANCH_SOURCE_MISSING',long_conditions:longChecks,short_conditions:shortChecks,long_condition_count:up,short_condition_count:down,daily_direction:up>=2?'long':down>=2?'short':'mixed',scenario_status:'DAILY_PREFILTER_ONLY_PENDING_BRANCH_AND_OPENING',formal_eligible:false});
 }
 return {contract:'telegram_previous_session_scan_v1',...context,checked_at:now,scope:'available_historical_price_cache',full_market_verified:false,examined:rows.length+gaps.length,evaluated:rows.length,rows,gaps,source_notes:['Institution source covers candidates only, missing stocks remain unknown','No prior-date broker cost substituted','Daily direction is a prefilter, not a complete scenario or order permission'],notifications_sent:0,orders_sent:0};
}
function main(){const arg=k=>process.argv.slice(2).find(x=>x.startsWith('--'+k+'='))?.slice(k.length+3);if(!arg('output'))throw Error('OUTPUT_REQUIRED');const p=scan({runtimeRoot:arg('runtime-root')||'C:/fuman-runtime',now:arg('as-of')||new Date().toISOString()});fs.mkdirSync(path.dirname(path.resolve(arg('output'))),{recursive:true});fs.writeFileSync(arg('output'),JSON.stringify(p,null,2));console.log(JSON.stringify({base_date:p.base_date,trade_date:p.trade_date,evaluated:p.evaluated,examined:p.examined,full_market_verified:false}));}
if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
module.exports={session,scan};

