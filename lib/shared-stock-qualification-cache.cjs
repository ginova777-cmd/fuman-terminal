'use strict';
const {mapFugleStockQualification:map}=require('./fugle-stock-qualification.cjs');
const CONTRACT='shared-stock-qualification-cache-v1';
const iso=ms=>new Date(ms).toISOString();
const after=(value,now)=>Number.isFinite(Date.parse(value||''))&&Date.parse(value)>now;
// One caller owns and persists this state. Each invocation performs at most one
// request, never sleeps or retries internally, and never opens a market stream.
async function refreshQualificationStep({state,symbols,tradeDate,fetchTicker,clock=Date.now,nowMs=clock()}){
 if(!Number.isFinite(nowMs)||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate||'')||
   !Number.isFinite(Date.parse(tradeDate+'T00:00:00Z'))||new Date(tradeDate+'T00:00:00Z').toISOString().slice(0,10)!==tradeDate)throw Error('INVALID_SCOPE');
 const requested=[...new Set(symbols.map(String))];
 if(requested.length>3000||requested.some(s=>!/^\d{4}$/.test(s)))throw Error('INVALID_UNIVERSE');
 const s=state?.contract===CONTRACT?JSON.parse(JSON.stringify(state)):{contract:CONTRACT,records:{},failures:0};
 s.records=s.records&&typeof s.records==='object'&&!Array.isArray(s.records)?s.records:{};
 s.failures=Number.isSafeInteger(s.failures)&&s.failures>=0?s.failures:0;
 if(s.blocked_reason)return {state:s,status:'BLOCKED',request_count:0,reason:s.blocked_reason};
 if(after(s.next_request_at,nowMs))return {state:s,status:'BACKOFF',request_count:0};
 let symbol;
 for(const candidate of requested){
  const r=s.records[candidate];
  if(r?.evidence?.identity_valid===true&&r.evidence.trade_date===tradeDate){
   const verified=map({body:r.evidence.raw,expectedSymbol:candidate,tradeDate,receivedAt:r.evidence.received_at,nowMs});
   if(verified.identity_valid&&verified.raw_json_sha256===r.evidence.raw_json_sha256)continue;
  }
  if(r?.attempt_trade_date===tradeDate&&after(r.retry_at,nowMs))continue;
  symbol=candidate;break;
 }
 if(!symbol)return {state:s,status:'NO_DUE_REQUEST',request_count:0};
 // 30 calls/minute for this producer, independent of account tier. The caller
 // must also coordinate with the shared account budget before invoking it.
 s.next_request_at=iso(nowMs+2000);
 try{
  const response=await fetchTicker(symbol);
  const status=response?.status;
  if(!Number.isInteger(status)||status<200||status>=300){
   if(status===401||status===403)s.blocked_reason='FUGLE_AUTH_'+status;
   const error=new Error('FUGLE_HTTP_'+(status??'UNKNOWN'));
   error.retryAfterMs=Number.isFinite(response?.retryAfterMs)?Math.max(0,response.retryAfterMs):0;
   throw error;
  }
  const receivedAt=response.receivedAt;
  const finished=Math.max(nowMs,clock());
  const evidence=map({body:response.body,expectedSymbol:symbol,tradeDate,receivedAt,nowMs:finished});
  s.failures=0;
  s.last_error=null;s.last_failed_symbol=null;
  s.next_request_at=iso(finished+2000);
  if(!evidence.identity_valid){
   s.records[symbol]={...s.records[symbol],attempt_trade_date:tradeDate,last_attempt_at:iso(nowMs),
    retry_at:iso(finished+30*60000),last_error:evidence.identity_errors.join('|'),rejected_source_date:evidence.source_date};
   return {state:s,status:'SOURCE_IDENTITY_REJECTED',symbol,request_count:1};
  }
  s.records[symbol]={attempt_trade_date:tradeDate,last_attempt_at:iso(nowMs),evidence,retry_at:null,last_error:null};
  return {state:s,status:'CACHED',symbol,request_count:1};
 }catch(error){
  s.failures=Math.min(s.failures+1,100);
  const backoff=Math.min(5,2**Math.min(s.failures-1,3))*60000;
  s.next_request_at=iso(Math.max(nowMs,clock())+Math.max(backoff,error.retryAfterMs||0));
  s.last_error=s.blocked_reason||'FUGLE_REQUEST_FAILED';
  s.last_failed_symbol=symbol;
  return {state:s,status:s.blocked_reason?'BLOCKED':'BACKOFF',symbol,request_count:1,reason:s.last_error};
 }
}
module.exports={refreshQualificationStep,CONTRACT};
