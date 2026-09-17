'use strict';
const assert=require('node:assert/strict');
const {fetchHistory}=require('../lib/fetch-mother-pool-historical-minutes');
(async()=>{
 const options={symbol:'2330',tradeDate:'2026-09-17',sessionDates:['2026-09-16'],apiKey:'isolated-secret',now:()=>Date.parse('2026-09-17T00:00:00Z')};
 const raw={symbol:'2330',timeframe:'1',exchange:'TWSE',market:'TSE',type:'EQUITY',data:[{date:'2026-09-16T09:00:00+08:00',open:100,high:101,low:99,close:100,volume:10}]};
 const good=await fetchHistory({...options,fetchImpl:async(url,request)=>{
  assert.equal(url.hostname,'api.fugle.tw');assert.equal(url.searchParams.get('to'),'2026-09-16');
  assert.equal(url.searchParams.get('timeframe'),'1');assert.equal(request.redirect,'error');
  return {ok:true,status:200,json:async()=>raw};
 }});
 assert.equal(good.status,'HISTORY_FETCHED');assert.equal(good.complete,false);
 assert.equal(good.normalized.rows[0].available_at,'2026-09-17T00:00:00.000Z');
 for(const status of [401,403,404,429,500]){
  let calls=0;const result=await fetchHistory({...options,fetchImpl:async()=>{calls++;return {ok:false,status};}});
  assert.equal(result.status,'DATA_GAP');assert.equal(calls,1);assert.equal(JSON.stringify(result).includes(options.apiKey),false);
 }
 const failed=await fetchHistory({...options,fetchImpl:async()=>{throw Error(options.apiKey);}});
 assert.equal(JSON.stringify(failed).includes(options.apiKey),false);
 await assert.rejects(()=>fetchHistory({...options,sessionDates:['2026-09-17']}),/REQUEST_INVALID/);
 console.log('PASS bounded historical source: prior dates, native adapter, actual availability, no secret leakage or retry storm');
})().catch(e=>{console.error(e);process.exitCode=1;});
