"use strict";
const median=xs=>{const a=xs.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
function a15(r){const raw=[r.prev_high,r.prev_low,r.prev_close];const present=raw.every(v=>v!==null&&v!==undefined&&v!=="");const h=present?Number(r.prev_high):NaN,l=present?Number(r.prev_low):NaN,c=present?Number(r.prev_close):NaN;return {...r,prev_range:Number.isFinite(h)&&Number.isFinite(l)?h-l:null,prev_range_pct:h>0&&c>0?(h-l)/c*100:null,prev_vwap:r.prev_vwap??null,data_gap:!(present&&[h,l,c].every(Number.isFinite))};}
function a16(){throw Error('A16_LEGACY_VALUES_VERIFIER_RETIRED_USE_MOTHER_POOL_A16');}
function a17(samples, context={}) {
 const expected=["08:45","08:50","08:55","08:59"];
 const symbols=[...new Set((context.symbols||[]).map(String).filter(Boolean))];
 const date=context.trade_date, asOf=Date.parse(context.as_of);
 const contextOk=/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&Number.isFinite(asOf)&&symbols.length>0;
 const arr=Array.isArray(samples)?samples:[], valid=[], rejected=[];
 for(const x of arr){
  const event=Date.parse(x?.trial_event_at);
  const local=Number.isFinite(event)?new Date(event+8*3600000).toISOString():'';
  const ok=contextOk&&symbols.includes(String(x?.symbol))&&x?.trade_date===date&&
   x.is_trial===true&&Number.isFinite(Number(x.trial_price))&&Number(x.trial_price)>0&&
   expected.includes(x.capture_slot)&&local.slice(0,10)===date&&local.slice(11,16)===x.capture_slot&&event<=asOf;
  if(ok)valid.push(x);else rejected.push({symbol:x?.symbol||null,capture_slot:x?.capture_slot||null,reason:'A17_INVALID_TRIAL_IDENTITY_OR_EVENT'});
 }
 const missing=symbols.map(symbol=>({symbol,slots:expected.filter(slot=>!valid.some(x=>String(x.symbol)===symbol&&x.capture_slot===slot))})).filter(x=>x.slots.length);
 const completeSymbols=symbols.filter(symbol=>!missing.some(x=>x.symbol===symbol));
 const complete=contextOk&&missing.length===0&&rejected.length===0;
 return {trade_date:date||null,slots:[...new Set(valid.map(x=>x.capture_slot))],prices:valid.map(x=>Number(x.trial_price)),observed_count:valid.length,
 requested_symbols:symbols.length,complete_symbols:completeSymbols,missing,rejected,complete,data_gap:!complete};
}
function a18(input){
 const groups=input&&typeof input==='object'&&!Array.isArray(input)?input:{a15:Array.isArray(input)?input:[]};
 const failed=[];
 const a15=Array.isArray(groups.a15)?groups.a15:[];
 if(!a15.length) failed.push('A15_NO_ROWS');
 for(const r of a15) if(r.status!=='READY' || r.data_gap===true) failed.push(r.reason||'A15_DATA_GAP');
 const a16=Array.isArray(groups.a16)?groups.a16:[];
 if(!a16.length) failed.push('A16_NO_ROWS');
 for(const r of a16) if(r.status!=='READY'||r.db_readback_ok!==true||r.source_ready!==true) failed.push(r.reason||`A16_${r.status||'DATA_GAP'}`);
 const a17=groups.a17||{};
 if(a17.data_gap===true||a17.complete!==true) failed.push('A17_TRIAL_DATA_GAP');
 return {checked:{a15:a15.length,a16:a16.length,a17_observed:Number(a17.observed_count||0)},ready:failed.length===0,failed_checks:[...new Set(failed)],first_blocker:failed[0]||null};
}
function a19(parts={}) {
 const a15Rows=Array.isArray(parts.a15)?parts.a15:[];
 const quality=a18({a15:a15Rows.map(r=>({...r,status:r.data_gap===false?'READY':'DATA_GAP'})),a16:parts.a16,a17:parts.a17});
 const failed=[...quality.failed_checks];
 if(!parts.a18 || parts.a18.ready!==true || !Array.isArray(parts.a18.failed_checks)) failed.push('A18_VERIFICATION_MISSING_OR_BLOCKED');
 else failed.push(...parts.a18.failed_checks);
 for(const r of (Array.isArray(parts.a16)?parts.a16:[])) if(r.contract!=='mother_pool_a16_writer_reference_v1') failed.push('A16_UNVERIFIED_REFERENCE');
 const unique=[...new Set(failed)];
 return {contract:"preopen_a15_a19_runner_verifier_receipt_v1",status:unique.length?"blocked":"complete",complete:unique.length===0,
 failed_checks:unique,first_blocker:unique[0]||null,formal_candidate_allowed:false,publish_allowed:false};
}
module.exports={median,a15,a16,a17,a18,a19};
