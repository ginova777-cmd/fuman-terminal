"use strict";
const median=xs=>{const a=xs.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
function a15(r){const raw=[r.prev_high,r.prev_low,r.prev_close];const present=raw.every(v=>v!==null&&v!==undefined&&v!=="");const h=present?Number(r.prev_high):NaN,l=present?Number(r.prev_low):NaN,c=present?Number(r.prev_close):NaN;return {...r,prev_range:Number.isFinite(h)&&Number.isFinite(l)?h-l:null,prev_range_pct:h>0&&c>0?(h-l)/c*100:null,prev_vwap:r.prev_vwap??null,data_gap:!(present&&[h,l,c].every(Number.isFinite))};}
function a16(){throw Error('A16_LEGACY_VALUES_VERIFIER_RETIRED_USE_MOTHER_POOL_A16');}
function a17(samples){const expected=["08:45","08:50","08:55","08:59"],arr=Array.isArray(samples)?samples:[],valid=arr.filter(x=>x&&x.is_trial===true&&Number(x.trial_price)>0&&expected.includes(String(x.capture_slot)));const bySymbol=new Map();for(const x of valid){const k=String(x.symbol||"");if(!k)continue;if(!bySymbol.has(k))bySymbol.set(k,[]);bySymbol.get(k).push(x);}const completeSymbols=[...bySymbol.entries()].filter(([,xs])=>expected.every(s=>xs.some(x=>x.capture_slot===s))).map(([s])=>s);return {slots:[...new Set(valid.map(x=>x.capture_slot))],prices:valid.map(x=>Number(x.trial_price)),observed_count:valid.length,complete:completeSymbols.length>0,complete_symbols:completeSymbols,data_gap:completeSymbols.length===0};}
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
function a19(parts){const a16Missing=!Array.isArray(parts.a16)||parts.a16.length===0;const failed=[...(parts.a15?.data_gap?["A15_DATA_GAP"]:[]),...(a16Missing?["A16_MISSING"]:(parts.a16||[]).filter(x=>x.status!=="READY"||x.contract!=="mother_pool_a16_writer_reference_v1"||x.db_readback_ok!==true||x.source_ready!==true).map(x=>`A16_${x.status==='READY'?'UNVERIFIED_REFERENCE':x.status}`)),...(parts.a17?.data_gap?["A17_DATA_GAP"]:[]),...(parts.a18?.failed_checks||[])];return {contract:"preopen_a15_a19_runner_verifier_receipt_v1",status:failed.length?"blocked":"complete",complete:failed.length===0,failed_checks:[...new Set(failed)],first_blocker:failed[0]||null,formal_candidate_allowed:false,publish_allowed:false};}
module.exports={median,a15,a16,a17,a18,a19};
