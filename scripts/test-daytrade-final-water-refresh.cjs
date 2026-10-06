'use strict';
const assert=require('node:assert/strict'),{refresh}=require('../lib/daytrade-final-water-refresh.cjs');
(async()=>{
 let calls=0;const good={ok:true,mode:'apply',trade_date:'2026-10-06',quotes_written:410,candles_written:1000,candle_deferred:20};
 const opts={apply:true,dryRun:false,tradeDate:good.trade_date,run:async()=>{calls++;return good;}};
 const r=await refresh(opts);assert.equal(r.status,'WRITTEN_PENDING_VERIFICATION');assert.equal(r.complete,false);assert.equal(calls,1);
 await refresh({...opts,apply:false});await refresh({...opts,dryRun:true});assert.equal(calls,1);
 for(const bad of [null,{...good,ok:false},{...good,mode:'dry_run'},{...good,trade_date:'2026-10-05'},{...good,quotes_written:0},{...good,candles_written:-1}])await assert.rejects(refresh({...opts,run:async()=>bad}),/NOT_ACKNOWLEDGED/);
 let failedCalls=0;await assert.rejects(refresh({...opts,run:async()=>{failedCalls++;throw Error('HTTP_503');}}),/HTTP_503/);assert.equal(failedCalls,1);
 // Requiring the CLI for reuse must not launch a write or read.
 const fs=require('fs');const source=fs.readFileSync(require.resolve('./sync-daytrade-websocket-supabase-fast.js'),'utf8');
 assert(source.includes('if (require.main === module) main()'));
 assert.equal(typeof require('./sync-daytrade-websocket-supabase-fast.js').runFastSync,'function');
 console.log('PASS: acknowledged writes only, date/mode validation, read-only skip, errors propagate without retries, import has no execution');
})().catch(e=>{console.error(e);process.exitCode=1;});
