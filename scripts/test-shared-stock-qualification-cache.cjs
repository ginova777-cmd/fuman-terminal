'use strict';
const assert=require('node:assert/strict');
const {refreshQualificationStep:step}=require('../lib/shared-stock-qualification-cache.cjs');
let now=Date.parse('2026-10-02T00:00:00Z'),calls=0;
const input={tradeDate:'2026-10-02',symbols:['3163','2330'],clock:()=>now};
const body=symbol=>({symbol,date:input.tradeDate,market:'OTC',exchange:'TPEx',type:'EQUITY',securityType:'01',securityStatus:'NORMAL',canDayTrade:true,canBuyDayTrade:true,isAttention:false,isDisposition:false});
const good=async symbol=>{calls++;return {status:200,receivedAt:new Date(now).toISOString(),body:body(symbol)};};
(async()=>{
 let r=await step({...input,fetchTicker:good});assert.equal(r.status,'CACHED');assert.equal(calls,1);
 const saved=JSON.stringify(r.state);
 let paced=await step({...input,state:r.state,fetchTicker:good});assert.equal(paced.request_count,0);assert.equal(calls,1);assert.equal(JSON.stringify(r.state),saved);
 now+=2000;r=await step({...input,state:JSON.parse(saved),fetchTicker:good});assert.equal(r.symbol,'2330');assert.equal(calls,2);
 now+=2000;let cached=await step({...input,state:r.state,fetchTicker:good});assert.equal(cached.request_count,0);assert.equal(calls,2);
 const corrupt=JSON.parse(JSON.stringify(r.state));corrupt.records['3163'].evidence.raw.canDayTrade=false;
 let repaired=await step({...input,state:corrupt,fetchTicker:good});assert.equal(repaired.symbol,'3163');assert.equal(calls,3);
 let failState;
 for(const minutes of [1,2,4,5,5]){
  const start=now;const failed=await step({...input,state:failState,fetchTicker:async()=>{calls++;throw Error('timeout');}});
  assert.equal(Date.parse(failed.state.next_request_at)-start,minutes*60000);
  const before=calls;const blocked=await step({...input,state:failed.state,fetchTicker:good});assert.equal(blocked.request_count,0);assert.equal(calls,before);
  now=Date.parse(failed.state.next_request_at);failState=JSON.parse(JSON.stringify(failed.state));
 }
 r=await step({...input,state:failState,fetchTicker:good});assert.equal(r.state.failures,0);assert.equal(r.state.last_error,null);
 now+=2000;
 const wrong=await step({...input,fetchTicker:async symbol=>({status:200,receivedAt:new Date(now).toISOString(),body:{...body(symbol),date:'2026-10-01'}})});
 assert.equal(wrong.status,'SOURCE_IDENTITY_REJECTED');assert.equal(wrong.state.records['3163'].evidence,undefined);
 now+=2000;const next=await step({...input,state:wrong.state,fetchTicker:good});assert.equal(next.symbol,'2330');
 const auth=await step({...input,fetchTicker:async()=>({status:403})});now+=86400000;
 assert.equal((await step({...input,state:auth.state,fetchTicker:good})).request_count,0);
 const retry=await step({...input,fetchTicker:async()=>({status:429,retryAfterMs:600000})});assert.equal(Date.parse(retry.state.next_request_at)-now,600000);
 const tomorrow={...input,tradeDate:'2026-10-03'};
 const cross=await step({...tomorrow,state:r.state,fetchTicker:async symbol=>({status:200,receivedAt:new Date(now).toISOString(),body:body(symbol)})});
 assert.equal(cross.status,'SOURCE_IDENTITY_REJECTED');assert.equal(cross.state.records['3163'].evidence.trade_date,'2026-10-02','old evidence retained under its original date');
 console.log('PASS: shared daily reuse, pacing, restart-persistent 1/2/4/5 backoff, reset, identity rejection, authentication stop, Retry-After and cross-date isolation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
