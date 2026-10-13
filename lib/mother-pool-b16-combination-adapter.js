'use strict';
const names={TONGZI_P2_BREAK_UP:'突破桐子 P2',TONGZI_P2_BREAK_DOWN:'跌回桐子 P2',PRICE_SPIKE_UP:'瞬間拉抬',PRICE_SPIKE_DOWN:'瞬間急跌',VOLUME_SPIKE:'瞬間巨量',NEW_INTRADAY_HIGH:'創盤中新高',NEW_INTRADAY_LOW:'創盤中新低',VWAP_ABOVE_VWAP:'站上 VWAP',VWAP_BELOW_VWAP:'位於 VWAP 下方'};
// Does not own transport or invent cooldown settings. B16's policy is injected.
async function prepare({combinations,events,asOf,policy}){
 const now=Date.parse(asOf),intents=[],blocked=[];
 for(const c of combinations){
  const members=c.event_sequence.map(x=>events.find(e=>e.event_id===x.event_id));
  if(members.some(e=>e&&(['B12','B14','B20'].includes(e.module_id)||/OPENING_RANGE/i.test(e.type||'')))){blocked.push({event_id:c.event_id,reason:'SOURCE_NOT_NOTIFICATION_APPROVED'});continue;}
  if(new Set(members.map(e=>e?.module_id)).size<2){blocked.push({event_id:c.event_id,reason:'NOT_DISTINCT_SOURCES'});continue;}
  if(c.status==='DIRECTION_CONFLICT'){blocked.push({event_id:c.event_id,reason:'DIRECTION_CONFLICT'});continue;}
  if(!Number.isFinite(now)||c.eligible_for_notifier!==true||!['long','short'].includes(c.direction)||members.length<2||!members.some(e=>e?.direction===c.direction)||members.some(e=>!e||e.source_contract_ok!==true||(e.direction!==c.direction&&!(e.module_id==='B12'&&e.direction==='neutral'))||e.symbol!==c.symbol||e.trade_date!==c.trade_date||e.canonical_run_id!==c.canonical_run_id||Date.parse(e.event_timestamp)>now)||new Set(members.map(e=>e.type)).size<2||!Number.isFinite(c.event_price)||c.event_price<=0){blocked.push({event_id:c.event_id,reason:'COMBINATION_OR_PRICE_PROOF_INVALID'});continue;}
  if(typeof policy?.decide!=='function'){blocked.push({event_id:c.event_id,reason:'B16_EXISTING_POLICY_NOT_BOUND'});continue;}
  const decision=await policy.decide(c,asOf);if(decision?.allowed!==true){blocked.push({event_id:c.event_id,reason:decision?.reason||'B16_POLICY_REJECTED'});continue;}
  const time=new Date(Date.parse(c.event_timestamp)+28800000).toISOString().slice(11,16);
  if(new Set(members.map(e=>e.underlying_event_id||e.event_id)).size<2){blocked.push({event_id:c.event_id,reason:'SAME_UNDERLYING_EVENT'});continue;}
  const text=`(${c.direction==='long'?'多':'空'}) ${c.symbol}｜價格:${c.event_price.toFixed(2)}｜${time}\n`+members.map(e=>(names[e.type]||e.type)+(e.type==='VOLUME_SPIKE'&&Number.isFinite(e.ratio)?` ${e.ratio} 倍`:'')).join('＋')+'\n'+members.map(e=>`${names[e.type]||e.type}｜${e.event_timestamp}｜證據:${JSON.stringify(e.calculation_evidence||{source_contract:e.source_contract,event_id:e.event_id})}`).join('\n');
  intents.push({event_id:c.event_id,dedup_key:c.event_id,symbol:c.symbol,trade_date:c.trade_date,direction:c.direction,text,event_timestamp:c.event_timestamp,source_event_ids:members.map(e=>e.event_id),publish_allowed:false});
 }
 return {contract:'b16_directional_combination_handoff_v1',intents,blocked,notifications_enabled:false,notifications_sent:0};
}
module.exports={prepare};
