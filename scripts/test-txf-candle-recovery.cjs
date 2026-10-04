'use strict';
const assert=require('node:assert/strict');
const {createRecovery}=require('../lib/txf-candle-recovery.cjs');
(async()=>{
 let clock=Date.parse('2026-10-02T06:00:00Z'),state=null,calls=0,ingests=0,flushes=0,fail=true;
 const raw={date:'2026-10-02T08:45:00+08:00',open:20000,high:20001,low:19999,close:20000,volume:5};
 let body={symbol:'TXFJ6',date:'2026-10-02',type:'FUTURE',exchange:'TAIFEX',timeframe:'1',data:[raw]};
 const options={archive:{ingest(){ingests++;return {accepted:true};},flush(){flushes++;return {files_written:1};}},now:()=>clock,readState:()=>state,writeState:r=>{state=r;},fetchImpl:async()=>{calls++;return {ok:!fail,status:429,json:async()=>body};}};
 const args={symbol:'TXFJ6',tradeDate:'2026-10-02',reason:'STARTUP',apiKey:'test-only'};
 let recovery=createRecovery(options);
 for(const delay of [60000,120000,240000,300000]){
  const result=await recovery(args);assert.equal(result.status,'failed');assert.equal(Date.parse(result.next_retry_at)-clock,delay);
  const before=calls;recovery=createRecovery(options);assert.equal((await recovery(args)).status,'backoff');assert.equal(calls,before);clock+=delay;
 }
 fail=false;assert.equal((await recovery({...args,reason:'RECONNECT'})).status,'saved');assert.equal(state.failures,0);assert.equal(ingests,1);assert.equal(flushes,1);
 body={...body,data:[raw,{...raw,date:'2026-10-03T08:46:00+08:00'}]};
 assert.equal((await recovery(args)).status,'failed');assert.equal(ingests,1,'invalid batch must not partially ingest');
 const before=calls;assert.equal((await recovery({...args,session:'AFTERHOURS'})).status,'blocked');assert.equal(calls,before);
 await assert.rejects(()=>recovery({...args,reason:'TIMER'}),/TRIGGER_INVALID/);
 console.log('PASS: bounded REST recovery, persistent 1/2/4/5 minute backoff, reset, atomic batch validation, night guard');
})().catch(e=>{console.error(e);process.exitCode=1;});
