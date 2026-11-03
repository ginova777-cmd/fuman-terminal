'use strict';
// Passive receipt boundary: no store, send, runner or notification dependency.
// This proves receipt equality, not Mother Pool module acceptance.
const crypto=require('node:crypto');
function stable(x){if(Array.isArray(x))return '['+x.map(stable).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';return JSON.stringify(x);}
const digest=x=>crypto.createHash('sha256').update(stable(x)).digest('hex');
function verify({record,db,tradeDate,runId,asOf}){
 const failed=[];const reject=x=>failed.push(x),r=record?.result,p=record?.sourceProof;
 if(!r||!p||!db)return {complete:false,failed_checks:['B16_RECEIPT_OR_READBACK_MISSING'],formal_acceptance:false};
 if(r.contract!=='telegram_three_independent_detectors_v1'||p.contract!=='three_detectors_natural_source_verifier_v1')reject('B16_RECEIPT_CONTRACT');
 if(r.run_id!==runId||p.run_id!==runId||db.run_id!==runId||r.trade_date!==tradeDate||p.trade_date!==tradeDate||db.trade_date!==tradeDate||!r.source_run_id||r.source_run_id!==p.source_run_id)reject('B16_RECEIPT_IDENTITY');
 const now=Date.parse(asOf),at=Date.parse(r.checked_at),pt=Date.parse(p.checked_at);
 if(!Number.isFinite(now)||!Number.isFinite(at)||!Number.isFinite(pt)||at>now||pt>at||new Date(at+28800000).toISOString().slice(0,10)!==tradeDate)reject('B16_RECEIPT_TIME');
 if(digest(db)!==digest(r))reject('B16_INDEPENDENT_READBACK_MISMATCH');
 if(!Array.isArray(r.events)||r.events_sha256!==digest(r.events)||p.events_sha256!==r.events_sha256||r.event_count!==r.events?.length)reject('B16_EVENTS_HASH');
 if(r.mode!=='live'||r.scope!=='natural_intraday_three_detectors'||r.live_point_in_time_proven!==true||p.live_point_in_time_proven!==true)reject('B16_NATURAL_SOURCE_REQUIRED');
 if(r.calculation_verified!==true||r.integration_complete!==true||r.db_readback_ok!==true||p.complete!==true||!Array.isArray(r.failed_checks)||r.failed_checks.length||!Array.isArray(p.failed_checks)||p.failed_checks.length)reject('B16_SOURCE_OR_STORAGE_INCOMPLETE');
 if(typeof r.notifications_enabled!=='boolean'||!Array.isArray(r.deliveries)||!Number.isSafeInteger(r.notifications_sent)||r.notifications_sent<0)reject('B16_DELIVERY_STATE_MISSING');
 if(r.notifications_enabled===false&&(r.notifications_sent!==0||r.deliveries?.length!==0||r.notification_status!=='paused_by_user'))reject('B16_PAUSED_DELIVERY_CONTRADICTION');
 return {complete:failed.length===0,status:failed.length?'BLOCKED':'RECEIPT_READBACK_VERIFIED',failed_checks:failed,receipt_sha256:digest(record),readback_sha256:digest(db),notification_status:r.notification_status,delivery_verified:false,formal_acceptance:false};
}
async function readback({record,readSnapshot,tradeDate,runId,asOf}){
 if(typeof readSnapshot!=='function')throw Error('B16_INDEPENDENT_READER_REQUIRED');
 if(typeof runId!=='string'||!/^telegram-natural-[a-zA-Z0-9-]+$/.test(runId))throw Error('B16_RUN_ID_INVALID');
 const key='telegram_three_detectors_'+runId;
 const db=await readSnapshot(key);
 return {...verify({record,db,tradeDate,runId,asOf}),snapshot_key:key};
}
module.exports={verify,readback,digest};
