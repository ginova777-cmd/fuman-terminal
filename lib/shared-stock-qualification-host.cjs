'use strict';
const path=require('node:path');
const {openQualificationStore}=require('./shared-stock-qualification-store.cjs');
const {buildCalendarPublication}=require('./daytrade-calendar-publication.cjs');
function createQualificationHost({runtimeDir,apiKey,readSymbols,budgetAvailable,onStatus=()=>{},
 clock=Date.now,fetchImpl=fetch,openStore=openQualificationStore,calendar=buildCalendarPublication}){
 let store=null,busy=false,stopped=false,timer=null,calendarAt=0,calendarDate=null,calendarRow=null,lastEmit=0,lastStatus='',hostRetryAt=0;
 const emit=status=>{const now=clock(),key=status.status+':'+(status.reason||'');if(now-lastEmit>=60000||(status.status==='BLOCKED'&&key!==lastStatus)){lastEmit=now;lastStatus=key;try{onStatus({...status,complete:false,checked_at:new Date(now).toISOString()});}catch{/* Diagnostics must not terminate the market collector. */}}};
 async function fetchTicker(symbol){
  const response=await fetchImpl('https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/'+encodeURIComponent(symbol),{
   headers:{'X-API-KEY':apiKey},signal:AbortSignal.timeout(8000)});
  const retry=response.headers.get('retry-after');
  const retryAfterMs=retry&&/^\d+(\.\d+)?$/.test(retry)?Number(retry)*1000:Math.max(0,Date.parse(retry||'')-clock());
  if(!response.ok){await response.body?.cancel();return {status:response.status,retryAfterMs};}
  if(Number(response.headers.get('content-length')||0)>65536){await response.body?.cancel();throw Error('TICKER_BODY_BOUND');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>65536)throw Error('TICKER_BODY_BOUND');chunks.push(Buffer.from(next.value));}}
  catch(error){await reader.cancel();throw error;}
  return {status:response.status,body:JSON.parse(Buffer.concat(chunks).toString('utf8')),receivedAt:new Date(clock()).toISOString()};
 }
 async function runOnce(){
  if(stopped||busy)return {status:stopped?'STOPPED':'BUSY',request_count:0};
  if(clock()<hostRetryAt)return {status:'HOST_BACKOFF',request_count:0};
  busy=true;
  try{
   const now=clock(),local=new Date(now+28800000),date=local.toISOString().slice(0,10),minute=local.getUTCHours()*60+local.getUTCMinutes();
   if(minute<360||minute>810){if(store){await store.close();store=null;}return {status:'OUTSIDE_SOURCE_WINDOW',request_count:0};}
   if(calendarDate!==date||now-calendarAt>=300000){
    calendarDate=date;calendarAt=now;calendarRow=null;
    const rows=await calendar({now:new Date(now),stateDir:path.join(runtimeDir,'state'),days:1});
    if(rows.length!==1||rows[0].trade_date!==date||rows[0].payload?.calendar_contract!=='market-calendar-contract-v1'||typeof rows[0].is_open!=='boolean')throw Error('CALENDAR_UNVERIFIED');
    calendarRow=rows[0];
   }
   if(!calendarRow){emit({status:'BLOCKED',reason:'CALENDAR_UNVERIFIED'});return {status:'CALENDAR_UNVERIFIED',request_count:0};}
   if(!calendarRow.is_open)return {status:'MARKET_CLOSED',request_count:0};
   if(!budgetAvailable(now))return {status:'SHARED_PROVIDER_COOLDOWN',request_count:0};
   if(!apiKey){emit({status:'BLOCKED',reason:'FUGLE_KEY_MISSING'});return {status:'KEY_MISSING',request_count:0};}
   if(!store)store=await openStore(path.join(runtimeDir,'cache','reference','fugle-stock-qualification'));
   const symbols=[...new Set(readSymbols())];
   const result=await store.refresh({symbols,tradeDate:date,clock,fetchTicker});
   if(result.status==='NO_DUE_REQUEST')hostRetryAt=clock()+60000;
   emit({status:result.status,requested_count:symbols.length,request_count:result.request_count,
    cached_count:Object.values(result.state?.records||{}).filter(r=>r.evidence?.identity_valid===true&&r.evidence.trade_date===date).length,
    next_request_at:result.state?.next_request_at||null,reason:result.reason||null});
   return {status:result.status,request_count:result.request_count};
  }catch(error){if(store){try{await store.close();}catch{}store=null;}hostRetryAt=clock()+60000;emit({status:'BLOCKED',reason:error.code||'QUALIFICATION_HOST_ERROR'});return {status:'BLOCKED',request_count:0};}
  finally{busy=false;}
 }
 async function loop(){await runOnce();if(!stopped){timer=setTimeout(loop,2000);timer.unref();}}
 return {runOnce,start(){if(timer||stopped)return;timer=setTimeout(loop,0);timer.unref();},
  async stop(){stopped=true;if(timer)clearTimeout(timer);if(busy)throw Error('QUALIFICATION_REQUEST_ACTIVE');if(store){await store.close();store=null;}}};
}
module.exports={createQualificationHost};
