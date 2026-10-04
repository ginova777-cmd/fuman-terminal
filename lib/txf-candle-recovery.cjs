'use strict';
const {validateRest}=require('./txf-candle-evidence.cjs');

// The caller invokes this only on startup or reconnect. Never runs a polling loop.
function createRecovery({archive,fetchImpl=fetch,now=()=>Date.now(),readState,writeState,timeoutMs=10000}) {
 let inFlight=false;
 return async function recover({symbol,tradeDate,session='REGULAR',apiKey,reason}) {
  if(!['STARTUP','RECONNECT'].includes(reason))throw Error('TXF_RECOVERY_TRIGGER_INVALID');
  if(session!=='REGULAR')return {status:'blocked',error:'TXF_NIGHT_CALENDAR_REQUIRED'};
  if(!/^TXF[A-L]\d$/.test(symbol||'')||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate||''))throw Error('TXF_RECOVERY_IDENTITY_INVALID');
  if(inFlight)return {status:'in_flight'};
  const key=`${tradeDate}|${session}|${symbol}`;
  const previous=readState()||{};
  // A provider failure is shared across contracts/dates: switching identity must not bypass cooldown.
  if(Date.parse(previous.next_retry_at||'')>now())return {status:'backoff',next_retry_at:previous.next_retry_at};
  inFlight=true;
  let timer;
  try {
   const controller=new AbortController();
   timer=setTimeout(()=>controller.abort(),timeoutMs);
   const response=await fetchImpl(`https://api.fugle.tw/marketdata/v1.0/futopt/intraday/candles/${symbol}?timeframe=1`,{
    headers:{'X-API-KEY':apiKey},signal:controller.signal
   });
   if(!response.ok)throw Error(`TXF_RECOVERY_HTTP_${response.status}`);
   const body=await response.json();
   const receivedAt=new Date(now()).toISOString();
   const context={symbol,tradeDate,session,receivedAt,nowMs:now()};
   // Validate the entire batch before accepting any row.
   const rows=validateRest(body,context);
   let accepted=0,conflicts=0;
   for(const row of rows){
    const result=archive.ingest(row.raw_evidence,{...context,source:'Fugle:REST:intraday/candles'});
    if(result.accepted)accepted++;
    if(result.conflict)conflicts++;
   }
   const publication=archive.flush({force:true});
   const receipt={key,reason,status:conflicts?'conflict':'saved',received_at:receivedAt,provider_count:rows.length,accepted_count:accepted,conflict_count:conflicts,publication,failures:0,next_retry_at:null};
   writeState(receipt);return receipt;
  } catch(error) {
   const failures=Math.min(100,(Number.isSafeInteger(previous.failures)?previous.failures:0)+1);
   const delayMs=[60000,120000,240000,300000][Math.min(failures-1,3)];
   // Do not persist arbitrary network errors which may contain request credentials.
   const code=/^TXF_[A-Z0-9_]+$/.test(error.message||'')?error.message:'TXF_RECOVERY_REQUEST_OR_ARCHIVE_FAILED';
   const receipt={key,reason,status:'failed',error:code,failures,checked_at:new Date(now()).toISOString(),next_retry_at:new Date(now()+delayMs).toISOString()};
   writeState(receipt);return receipt;
  } finally {clearTimeout(timer);inFlight=false;}
 };
}
module.exports={createRecovery};
