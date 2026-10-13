'use strict';
// Pure isolated contract candidate; no transport, state writes or formal enable.
const hash=x=>require('node:crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');
function decide({events,now,qualityGate,notifierEligible,freshnessPassed,previous=null,deliveredOccurrenceIds=[],unresolvedDelivery=false}){
 const reject=reason=>({allowed:false,reason,publish_allowed:false});const ms=Date.parse(now);
 if(!Number.isFinite(ms)||!Array.isArray(events)||events.length<2)return reject('INVALID_EVENTS_OR_CLOCK');
 if(events.some(e=>['B12','B14','B20'].includes(e.module_id)||/OPENING_RANGE/i.test(e.type||'')))return reject('SOURCE_NOT_NOTIFICATION_APPROVED');
 const a=events[0];
 if(!['long','short'].includes(a.direction)||events.some(e=>!e.event_id||!e.module_id||!e.type||e.source_contract_ok!==true||e.direction!==a.direction||e.symbol!==a.symbol||e.trade_date!==a.trade_date||e.canonical_run_id!==a.canonical_run_id||!Number.isFinite(Date.parse(e.event_timestamp))||Date.parse(e.event_timestamp)>ms||new Date(Date.parse(e.event_timestamp)+28800000).toISOString().slice(0,10)!==a.trade_date)||!/^\d{4}$/.test(a.symbol||'')||!a.canonical_run_id)return reject('INVALID_EVENT_PROOF');
 if(new Set(events.map(e=>e.module_id)).size<2||new Set(events.map(e=>e.event_id)).size!==events.length||new Set(events.map(e=>e.underlying_event_id||e.event_id)).size!==events.length)return reject('NOT_DISTINCT_SOURCES');
 const times=events.map(e=>Date.parse(e.event_timestamp));if(Math.max(...times)-Math.min(...times)>180000)return reject('OUTSIDE_WINDOW');
 if(qualityGate!==true||notifierEligible!==true||freshnessPassed!==true)return reject('GATE_OR_NOTIFIER_REJECTED');
 const eventIds=events.map(e=>e.event_id).sort();
 // Draft normalization: type-family key, distinct occurrence key. Owner review required.
 const normalized_combination_id=hash(events.map(e=>[e.module_id,e.type]).sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y))));
 const key=hash([a.trade_date,a.symbol,a.direction,normalized_combination_id]);const occurrence_id=hash([key,eventIds]);
 const ids={key,normalized_combination_id,occurrence_id,event_ids:eventIds,publish_allowed:false};
 if(unresolvedDelivery)return {...ids,...reject('DELIVERY_OUTCOME_UNKNOWN')};
 if(deliveredOccurrenceIds.includes(occurrence_id))return {...ids,...reject('OLD_OCCURRENCE')};
 if(previous){
  if(previous.key!==key||previous.status!=='delivered'||!Number.isFinite(Date.parse(previous.sent_at))||!Array.isArray(previous.event_ids))return {...ids,...reject('INVALID_PREVIOUS_RECEIPT')};
  const elapsed=ms-Date.parse(previous.sent_at);if(elapsed<0)return {...ids,...reject('CLOCK_REGRESSION')};
  if(elapsed<180000)return {...ids,...reject('COOLDOWN_180S')};
  if(!events.some(e=>!previous.event_ids.includes(e.event_id)&&Date.parse(e.event_timestamp)>Date.parse(previous.sent_at)))return {...ids,...reject('NO_NEW_EVENT')};
 }
 return {...ids,allowed:true,reason:'ISOLATED_ELIGIBLE',cooldown_seconds:180};
}
module.exports={decide};
