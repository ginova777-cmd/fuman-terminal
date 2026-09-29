'use strict';
const {isDeepStrictEqual}=require('node:util');
const {hash}=require('./mother-pool-module-write-set');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const digest=x=>hash(stable(x));
const slots=['08:45','08:50','08:55','08:59'];
const contract='preopen_a17_trial_trajectory_v1';
function evaluate(symbol,date,raw,readback,asOf){
 const failures=[],now=Date.parse(asOf),readAt=Date.parse(readback?.observed_at);
 if(!Number.isFinite(now)||new Date(now+28800000).toISOString().slice(0,10)!==date)failures.push('AS_OF_INVALID');
 if(readback?.status!=='READ'||readback?.source!=='fugle_preopen_snapshot_history'||readback?.trade_date!==date||!Number.isFinite(readAt)||readAt>now)failures.push('TRIAL_READBACK_INVALID');
 const seen=new Set(),bySlot=new Map();
 if(!Array.isArray(raw))failures.push('TRIAL_ROWS_MISSING');
 for(const row of Array.isArray(raw)?raw:[]){
  if(!row||typeof row!=='object'||Array.isArray(row)){failures.push('TRIAL_SOURCE_INVALID');continue;}
  if(['synthetic','is_synthetic','replay','look_ahead'].some(k=>row[k]===true||row.payload?.[k]===true)){failures.push('TRIAL_NOT_NATURAL');continue;}
  const event=Date.parse(row.payload?.trial_event_at),local=Number.isFinite(event)?new Date(event+28800000).toISOString():'',slot=local.slice(11,16);
  if(row.symbol!==symbol||row.trade_date!==date||local.slice(0,10)!==date||!slots.includes(slot)||!Number.isFinite(event)||event>readAt||event>now||Date.parse(row.observed_at)!==event||row.is_trial!==true||typeof row.trial_price!=='number'||!Number.isFinite(row.trial_price)||row.trial_price<=0||row.payload?.source!=='fugle_daytrade_source_writer:preopen_websocket'||row.payload?.writer_contract!=='preopen_snapshot_history_v2'||row.payload?.trial_event_time_source!=='provider_trial_event'){
   failures.push('TRIAL_SOURCE_INVALID');continue;
  }
  if(seen.has(event)){failures.push('DUPLICATE_TRIAL_EVENT');continue;}seen.add(event);
  if(!bySlot.has(slot)||event>bySlot.get(slot).event_ms)bySlot.set(slot,{slot,event_ms:event,event_at:row.payload.trial_event_at,price:row.trial_price});
 }
 const missing=slots.filter(slot=>!bySlot.has(slot));if(missing.length)failures.push('TRIAL_SLOTS_MISSING');
 const trajectory=slots.filter(slot=>bySlot.has(slot)).map(slot=>bySlot.get(slot));
 return {status:failures.length?'DATA_GAP':'READY',data_gap_reason:failures.length?[...new Set(failures)].join('|'):null,missing_slots:missing,trajectory,price_changes:trajectory.slice(1).map((x,i)=>({from:trajectory[i].slot,to:x.slot,change:x.price-trajectory[i].price})),formal_candidate_allowed:false,publish_allowed:false};
}
function collect({identity,symbols,history,asOf}){
 const raw=Array.isArray(history?.rows)?history.rows:[],readback=history?.readback||null;
 return {...identity,module_id:'A17',created_at:asOf,requested_symbols:[...symbols],rows:symbols.map(symbol=>{
  const selected=raw.filter(r=>r?.symbol===symbol||!r||typeof r!=='object'||Array.isArray(r));
  return {symbol,...evaluate(symbol,identity.trade_date,selected,readback,asOf),raw_trials:selected,source_readback:readback,
   source:'fugle_preopen_snapshot_history',source_contract:contract,source_updated_at:readback?.observed_at||asOf,event_time:asOf,
   source_hash:digest(selected),is_synthetic:false,replay:false,look_ahead:false};
 })};
}
function verify(row,round){try{
 const expected=evaluate(row.symbol,round.trade_date,row.raw_trials,row.source_readback,round.observed_at);
 return expected.status==='READY'&&row.is_synthetic===false&&row.replay===false&&row.look_ahead===false&&row.source==='fugle_preopen_snapshot_history'&&row.source_contract===contract&&row.source_updated_at===row.source_readback.observed_at&&row.event_time===round.observed_at&&row.source_hash===digest(row.raw_trials)&&Object.entries(expected).every(([k,v])=>isDeepStrictEqual(row[k],v));
}catch{return false;}}
module.exports={collect,verify,evaluate};
