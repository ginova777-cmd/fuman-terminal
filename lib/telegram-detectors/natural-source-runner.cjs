'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const volume=require('./volume-detector.cjs'),price=require('./price-detector.cjs'),outside=require('./outside-detector.cjs');
const {build}=require('./provider-minute-side.cjs');
const independent=require('./verify-natural-calculation.cjs');
const {digest}=require('./delivery-pipeline.cjs');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const jsonl=p=>fs.existsSync(p)?fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse):[];
function produce({runtimeRoot,now=new Date().toISOString(),previousOutside={}}){
 const ms=Date.parse(now),date=new Date(ms+28800000).toISOString().slice(0,10),run_id='telegram-natural-'+crypto.randomUUID(),failures=[],gaps=[],events=[];
 const cacheFile=path.join(runtimeRoot,'cache/intraday/fugle-daytrade-ws-candles-v2.json'),quoteFile=path.join(runtimeRoot,'cache/intraday/fugle-daytrade-ws-quotes-v2.json');
 const cacheRaw=fs.readFileSync(cacheFile),quoteRaw=fs.readFileSync(quoteFile),cache=JSON.parse(cacheRaw),quotes=JSON.parse(quoteRaw);
 const quoteMap=new Map((Array.isArray(quotes.quotes)?quotes.quotes:Object.values(quotes.quotes||{})).map(q=>[String(q.code||q.symbol),q]));
 const group=new Map();
 for(const b of cache.candles||[]){
  if(b.tradeDate!==date||!/^\d{4}$/.test(String(b.symbol||b.code))||!['TSE','OTC'].includes(b.market)||b.synthetic!==false||b.intradayOddLot===true||b.websocketRow!==true||b.restRepairRow===true||b.sourceChannel!=='candles')continue;
  const t=Date.parse(b.candleTime),minute=Number.isFinite(t)?new Date(t+28800000).toISOString().slice(11,16):'';
  if(!Number.isFinite(t)||t%60000||t+60000>ms||minute<'09:00'||minute>'13:30'||!Number.isFinite(Date.parse(b.candleSeenAt))||Date.parse(b.candleSeenAt)>ms)continue;
  const symbol=String(b.symbol||b.code),row={stock_id:symbol,trade_date:date,timestamp:b.candleTime,open:b.open,high:b.high,low:b.low,close:b.close,volume_raw:b.volume,volume_raw_unit:'LOTS',complete:true,is_synthetic:false,available_at:b.candleSeenAt,source:'Fugle.websocket.candles.TSE_OTC'};
  if(b.volumeStrategyUsable!==true)row.volume_raw=null;
  if(!group.has(symbol))group.set(symbol,[]);group.get(symbol).push(row);
 }
 const ready={volume:0,price:0,outside:0},details=[],outsideState={};
 for(const [symbol,current]of group){
  current.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const b=current.at(-1),t=Date.parse(b.timestamp),quote=quoteMap.get(symbol),eventAt=quote?.totalVolumeSourceEventAt,evt=Date.parse(eventAt),age=(ms-evt)/1000;
  // Market event time is never replaced by a writer heartbeat or cache updatedAt.
  if(!Number.isFinite(evt)||evt<t||evt>=t+60000||age<0||age>120){gaps.push({symbol,reason:'STALE_OR_MISSING_NATIVE_MARKET_EVENT'});continue;}
  let history=[];const hf=path.join(runtimeRoot,'data/telegram-detectors/history',symbol+'.json');
  if(fs.existsSync(hf)){const h=read(hf);history=(h.candles||[]).filter(x=>x.stock_id===symbol&&x.trade_date<date&&!volume.validate(x,ms).reasons.length);}
  const priceCurrent=current.filter(x=>['open','high','low','close'].every(k=>typeof x[k]==='number'&&Number.isFinite(x[k])&&x[k]>0)&&x.high>=Math.max(x.open,x.close)&&x.low<=Math.min(x.open,x.close)&&x.high>=x.low);
  const input={stock_id:symbol,trade_date:date,current:priceCurrent,history,as_of:now,previous_close:quote.prevClose||null};
  const volumeCurrent=current.filter(x=>!volume.validate(x,ms).reasons.length);
  let v=null,p=null;try{if(volumeCurrent.at(-1)?.timestamp===b.timestamp)v=volume.detect({...input,current:volumeCurrent}).rows.at(-1);if(priceCurrent.at(-1)?.timestamp===b.timestamp)p=price.detect(input).rows.at(-1);}catch(e){gaps.push({symbol,reason:'MINUTE_INPUT_INVALID'});continue;}
  let sideRows=[],o=null;
  try{
   const journal=jsonl(path.join(runtimeRoot,'data/provider-side-journal',date,symbol+'.jsonl'));
   const tradeRows=jsonl(path.join(runtimeRoot,'data/provider-trade-journal',date,symbol+'.jsonl')).filter(x=>x.stock_id===symbol&&x.trade_date===date&&x.is_synthetic===false&&x.volume_unit==='LOTS'&&Date.parse(x.received_at)<=ms);
   if(!journal.length||!tradeRows.length)throw Error('NATIVE_SIDE_OR_TRADE_JOURNAL_MISSING');
   const built=build({trade_date:date,stock_id:symbol,trades:tradeRows.map(x=>x.trade),journal,as_of:now,volume_unit:'LOTS'});
   sideRows=built.rows.filter(x=>Date.parse(x.timestamp)<=t);
   if(!sideRows.length||Date.parse(sideRows.at(-1).timestamp)!==t)throw Error('LATEST_SIDE_MINUTE_NOT_PROVEN');
   const last=sideRows.at(-1);if(b.volume_raw!=null&&last.total_1m!==b.volume_raw)throw Error('SIDE_CANDLE_VOLUME_MISMATCH');
   o=outside.evaluate({current:last,history:[],rolling:sideRows.slice(0,-1),processing_timestamp:now,previous_result:previousOutside[symbol]||null});
   if(o.data_gap)throw Error('SIDE_SOURCE_DATA_GAP');
  }catch(e){gaps.push({symbol,module:'outside',reason:e.message});o=null;}
  const checked=independent.verify({current:p?priceCurrent:current,volumeCurrent,history,volume:v,price:p,outsideCurrent:sideRows,outside:o});
  if(checked.length){failures.push(...checked.map(x=>symbol+':'+x));continue;}
  for(const [kind,row]of [['volume',v],['price',p],['outside',o]]){
   if(row&&!row.data_gap&&row.primary_baseline>0)ready[kind]++;
   else gaps.push({symbol,module:kind,reason:row?.reasons?.[0]||'PRIMARY_BASELINE_NOT_READY'});
  }
  for(const [row,type,yes]of [[v,'VOLUME_ANOMALY_EVENT',v?.volume_anomaly_event],[p,'PRICE_UP_ANOMALY_EVENT',p?.price_up_anomaly_event],[o,'RAW_OUTSIDE_STRENGTH_EVENT',o?.raw_event],[o,'DYNAMIC_OUTSIDE_STRENGTH_EVENT',o?.dynamic_event]])if(yes)events.push({...row,event_type:type,source_event_at:eventAt});
  if(o)outsideState[symbol]=o;
  details.push({symbol,timestamp:b.timestamp,source_event_at:eventAt,volume_ready:(v?.primary_baseline??0)>0,price_ready:(p?.primary_baseline??0)>0,outside_ready:(o?.primary_baseline??0)>0});
 }
 if(!group.size)failures.push('NO_TODAY_MINUTE_SOURCE');
 if(!details.length)failures.push('NO_FRESH_NATURAL_MINUTE');
 // Source gaps in one detector never suppress valid events from another detector.
 const pendingModules=Object.keys(ready).filter(k=>!ready[k]);
 const source_run_id='fugle-capture:'+crypto.createHash('sha256').update(cacheRaw).update(quoteRaw).digest('hex');
 const batch={run_id,source_run_id,trade_date:date,mode:'live',requested_count:group.size,evaluated_count:details.length,data_gaps:gaps};
 const proof={contract:'three_detectors_natural_source_verifier_v1',run_id,trade_date:date,source_run_id,events_sha256:digest(events),complete:!failures.length,live_point_in_time_proven:!failures.length,failed_checks:failures,ready_counts:ready,pending_modules:pendingModules,details,checked_at:now};
 return {batch,events,proof,outsideState};
}
module.exports={produce};
