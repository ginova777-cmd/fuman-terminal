'use strict';
const crypto=require('node:crypto');
const {adapt}=require('./mother-pool-historical-minute-adapter');
function selectHistory(artifact,{symbol,tradeDate,asOf,minute}) {
 if(!artifact||artifact.contract!=='mother_pool_historical_minute_fetch_evidence_v1'||artifact.symbol!==symbol
  ||artifact.trade_date!==tradeDate||artifact.calendar_verified!==true||artifact.result?.status!=='HISTORY_FETCHED'
  ||!Array.isArray(artifact.requested_sessions)||artifact.requested_sessions.length!==20
  ||!artifact.calendar||!Number.isFinite(Date.parse(artifact.calendar.checked_at))||Date.parse(artifact.calendar.checked_at)>Date.parse(asOf)
  ||!/^[a-f0-9]{64}$/.test(artifact.calendar.sha256||''))throw Error('HISTORICAL_ARTIFACT_INVALID');
 if(!/^\d{2}:\d{2}$/.test(minute))throw Error('HISTORICAL_MINUTE_INVALID');
 const raw=artifact.result.raw;
 const hash=crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex');
 if(hash!==artifact.result.normalized?.raw_sha256)throw Error('HISTORICAL_RAW_HASH_MISMATCH');
 const normalized=adapt({response:raw,symbol,tradeDate,sessionDates:artifact.requested_sessions,fetchedAt:artifact.result.fetched_at,asOf});
 // Price returns require the exact previous minute; volume uses the target minute.
 const [hour,min]=minute.split(':').map(Number),target=hour*60+min;
 const rows=normalized.rows.filter(row=>{
  const local=new Date(Date.parse(row.timestamp)+28800000).toISOString();
  const n=Number(local.slice(11,13))*60+Number(local.slice(14,16));
  return n===target||n===target-1;
 });
 return {rows,provenance:{raw_sha256:hash,calendar_sha256:artifact.calendar.sha256,session_dates:artifact.requested_sessions,
  fetched_at:artifact.result.fetched_at,target_minute:minute},status:'HISTORICAL_INPUT_VALIDATED'};
}
module.exports={selectHistory};
