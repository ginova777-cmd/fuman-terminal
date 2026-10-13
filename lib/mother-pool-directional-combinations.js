'use strict';
const crypto=require('node:crypto');
const RETIRED=new Set(['B14','B20']);
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
// MP-UNIFIED-INTEGRATION-BASELINE-20261013-01: neutral B12 cannot meet the two-directional-event threshold.
function combine(events,{asOf,windowSeconds=180}={}){
 const now=Date.parse(asOf);if(!Number.isFinite(now)||![0,60,180].includes(windowSeconds))throw Error('COMBINATION_WINDOW_OR_CLOCK');
 const counts=new Map();for(const e of events||[])counts.set(e.event_id,(counts.get(e.event_id)||0)+1);
 const valid=(events||[]).filter(e=>!RETIRED.has(e.module_id)&&counts.get(e.event_id)===1&&e.event_id&&e.type&&e.source_contract&&e.source_contract_ok===true&&['long','short'].includes(e.direction)&&/^\d{4}$/.test(e.symbol||'')&&e.canonical_run_id&&Number.isFinite(Date.parse(e.event_timestamp))&&Date.parse(e.event_timestamp)<=now&&new Date(Date.parse(e.event_timestamp)+28800000).toISOString().slice(0,10)===e.trade_date).sort((a,b)=>Date.parse(a.event_timestamp)-Date.parse(b.event_timestamp)||a.event_id.localeCompare(b.event_id));
 const out=[];
 for(let i=0;i<valid.length;i++)for(let j=i+1;j<valid.length;j++){
  const a=valid[i],b=valid[j],sameMinute=Math.floor(Date.parse(a.event_timestamp)/60000)===Math.floor(Date.parse(b.event_timestamp)/60000),delta=(Date.parse(b.event_timestamp)-Date.parse(a.event_timestamp))/1000;
  if(a.symbol!==b.symbol||a.trade_date!==b.trade_date||a.canonical_run_id!==b.canonical_run_id||a.type===b.type||(a.underlying_event_id||a.event_id)===(b.underlying_event_id||b.event_id)||!(windowSeconds===0?sameMinute:delta<=windowSeconds)||now-Date.parse(b.event_timestamp)>180000)continue;
  const directions=[...new Set([a.direction,b.direction].filter(x=>x!=='neutral'))];if(!directions.length)continue;
  const nearby=valid.filter(x=>x.symbol===a.symbol&&x.trade_date===a.trade_date&&x.canonical_run_id===a.canonical_run_id&&(windowSeconds===0?Math.floor(Date.parse(x.event_timestamp)/60000)===Math.floor(Date.parse(b.event_timestamp)/60000):Math.abs(Date.parse(x.event_timestamp)-Date.parse(b.event_timestamp))<=windowSeconds*1000));
  const conflicting=new Set(nearby.map(x=>x.direction).filter(x=>x!=='neutral')).size>1;
  const direction=conflicting?null:directions[0],status=conflicting?'DIRECTION_CONFLICT':'ELIGIBLE';
  out.push({type:'EVENT_COMBINATION',symbol:a.symbol,trade_date:a.trade_date,canonical_run_id:a.canonical_run_id,direction,status,event_id:hash([a.trade_date,a.symbol,direction,a.event_id,b.event_id]),event_timestamp:b.event_timestamp,event_price:b.event_price??null,event_combination:[a.type,b.type],event_sequence:[a,b].map(e=>({event_id:e.event_id,event_timestamp:e.event_timestamp,type:e.type})),same_bar_event:sameMinute,matched_windows:[...(sameMinute?[0]:[]),...(delta<=60?[60]:[]),180],eligible_for_notifier:!conflicting,formal_candidate_allowed:false,publish_allowed:false});
 }
 return out;
}
module.exports={combine};
