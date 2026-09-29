'use strict';
const {digest}=require('./premarket-plan-contract.cjs');
async function publish({payload,store,readback,now}){
 const stamp=Date.parse(now),captured=Date.parse(payload?.checked_at),local=Number.isFinite(stamp)?new Date(stamp+28800000).toISOString():'';
 if(payload?.contract!=='telegram_premarket_validation_v1'||payload.no_send!==true||payload.notifications_sent!==0||payload.mode!=='validation'||!/^premarket-validation-[a-f0-9-]{36}$/.test(payload.run_id||'')||!Array.isArray(payload.rows)||digest(payload.rows)!==payload.rows_sha256)throw Error('TRIAL_VIEW_CONTRACT_INVALID');
 if(!Number.isFinite(captured)||captured>stamp||stamp-captured>120000||payload.trade_date!==local.slice(0,10)||local.slice(11,16)<'08:45'||local.slice(11,16)>'08:59')throw Error('TRIAL_VIEW_OUTSIDE_NATURAL_WINDOW');
 if(!payload.rows.some(r=>r.trial_price_levels?.trial_derived_complete===true))return {status:'waiting_trial',published:false,previous_good_preserved:true};
 const latestKey='telegram_premarket_validation_latest',old=await readback(latestKey);
 if(old&&Date.parse(old.checked_at)>captured)throw Error('TRIAL_VIEW_NEWER_LATEST_EXISTS');
 const key='telegram_'+payload.run_id;await store(key,payload);if(digest(await readback(key))!==digest(payload))throw Error('TRIAL_VIEW_PINNED_READBACK_FAILED');
 await store(latestKey,payload);if(digest(await readback(latestKey))!==digest(payload))throw Error('TRIAL_VIEW_LATEST_READBACK_FAILED');
 return {status:'published',published:true,run_id:payload.run_id,rows_sha256:payload.rows_sha256,notifications_sent:0,formal_complete:false};
}
module.exports={publish};
