'use strict';
const assert=require('assert/strict'),{refresh}=require('../lib/daytrade-final-water-refresh.cjs'),{verify}=require('./verify-writer-backfill-pending.cjs');
(async()=>{
 let calls=0,liveCalls=0;
 const live={quotes_acknowledged:true,stock_candles_verified:true,quotes_written:230,stock_candles_written:228};
 const partial={ok:true,mode:'apply',trade_date:'2026-10-20',quotes_written:230,candles_written:2000,candle_rows:90000,candle_pending_after:88000,candle_deferred:88000,final_content_readback_verified:false};
 const options={apply:true,dryRun:false,tradeDate:partial.trade_date,historyControl:{cooldown:false},run:async()=>{calls++;return partial;},refreshLive:async()=>{liveCalls++;return live;}};
 const p=await refresh(options);assert.equal(p.status,'BACKFILL_PENDING');assert.equal(p.complete,false);assert.equal(p.publication_acknowledged,false);assert.equal(calls,1);assert.equal(liveCalls,2);assert.equal(p.pending,88000);
 const timeout=()=>{const e=new Error('test');e.name='TimeoutError';e.writerOperation={step:'stock_candle_content_readback',request_id:'isolated'};return e;};
 let attempts=0;const deferred=await refresh({...options,run:async()=>{attempts++;throw timeout();}});assert.equal(deferred.reason,'HISTORY_READBACK_TIMEOUT');assert.equal(attempts,1);
 let checks=0;await assert.rejects(refresh({...options,run:async()=>{throw timeout();},refreshLive:async()=>{if(++checks===1)return live;throw Error('LIVE_HTTP_503');}}),/LIVE_HTTP_503/);
 const wrong=timeout();wrong.writerOperation.step='stock_candle_write';await assert.rejects(refresh({...options,run:async()=>{throw wrong;}}),/test/);
 await assert.rejects(refresh({...options,run:async()=>{throw Error('HTTP_503');}}),/HTTP_503/);
 await assert.rejects(refresh({...options,run:async()=>({...partial,ok:false})}),/NOT_ACKNOWLEDGED/);
 let historyCalls=0;const cooldown=await refresh({...options,historyControl:{cooldown:true},run:async()=>{historyCalls++;}});assert.equal(cooldown.reason,'HISTORY_COOLDOWN');assert.equal(historyCalls,0);
 const now=Date.now(),record={contract:'writer-backfill-pending-v1',run_id:'same-round',checked_at:new Date(now).toISOString(),...p};assert(verify(record,'same-round',now));assert(!verify(record,'old-round',now));assert(!verify({...record,complete:true},'same-round',now));assert(!verify({...record,live_refresh:{quotes_acknowledged:true}},'same-round',now));assert(!verify(record,'same-round',now+120001));
 console.log('PASS bounded one history batch; timeout isolation requires successful live write/readback; global errors propagate; no history retry; pending cannot claim complete; same-round verifier');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
