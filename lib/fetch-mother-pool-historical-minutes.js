'use strict';
const {adapt}=require('./mother-pool-historical-minute-adapter');
// One bounded read; caller owns scheduling, calendar provenance and raw storage.
// Never substitute another date or retry authentication/rate-limit failures.
async function fetchHistory({symbol,tradeDate,sessionDates,apiKey,fetchImpl=fetch,now=Date.now,timeoutMs=10000}) {
 if(typeof symbol!=='string'||!/^\d{4}$/.test(symbol)||typeof apiKey!=='string'||!apiKey.trim()
  ||!Array.isArray(sessionDates)||!sessionDates.length||sessionDates.length>20
  ||new Set(sessionDates).size!==sessionDates.length||sessionDates.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>=tradeDate)
  ||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>30000)throw Error('HISTORY_REQUEST_INVALID');
 const dates=sessionDates.slice().sort();
 const url=new URL('https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/'+symbol);
 url.search=new URLSearchParams({from:dates[0],to:dates.at(-1),timeframe:'1',fields:'open,high,low,close,volume',sort:'asc'}).toString();
 const startedAt=new Date(now()).toISOString();
 let response;
 try {response=await fetchImpl(url,{headers:{'X-API-KEY':apiKey},signal:AbortSignal.timeout(timeoutMs),redirect:'error'});}
 catch {return {status:'DATA_GAP',reason:'HISTORY_TRANSPORT_FAILED',complete:false,started_at:startedAt};}
 if(!response.ok)return {status:'DATA_GAP',reason:response.status===404?'HISTORY_NOT_FOUND':response.status===429?'HISTORY_RATE_LIMITED':'HISTORY_HTTP_FAILED',http_status:response.status,complete:false,started_at:startedAt};
 let raw,fetchedAt;
 try {
  raw=await response.json();fetchedAt=new Date(now()).toISOString();
  const normalized=adapt({response:raw,symbol,tradeDate,sessionDates:dates,fetchedAt,asOf:fetchedAt});
  return {status:normalized.rows.length?'HISTORY_FETCHED':'DATA_GAP',reason:normalized.rows.length?null:'HISTORY_EMPTY',
   http_status:response.status,started_at:startedAt,fetched_at:fetchedAt,raw,normalized,complete:false};
 }catch(error){return {status:'DATA_GAP',reason:'HISTORY_RESPONSE_INVALID',http_status:response.status,complete:false,started_at:startedAt,
  fetched_at:fetchedAt||null,raw:raw||null,validation_error:['HISTORY_ENVELOPE_INVALID','HISTORY_RESPONSE_INVALID','HISTORY_ROW_INVALID'].includes(error.message)?error.message:'RESPONSE_PARSE_OR_VALIDATION_FAILED'};}
}
module.exports={fetchHistory};
