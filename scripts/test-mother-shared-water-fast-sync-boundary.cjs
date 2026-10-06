'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('./sync-daytrade-websocket-supabase-fast.js'),'utf8');
async function exercise({apply=true,failWrite=false,captureFails=false,quotesOnly=false,guard=true}={}){
 const events=[],time='2026-10-06T01:00:01.000Z';
 class Clock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return Date.parse(time);}}
 const fakeFs={readFileSync(file){if(quotesOnly&&file.includes('candle'))throw Error('Quote-only read candle cache');if(file.endsWith('fugle-daytrade-ws-quotes-v2.json')){events.push('read-quotes');return JSON.stringify({quotes:[{code:'1216',market:'TSE',quoteSeenAt:time,receivedAt:time,lastTradeTime:time,close:70,tradeVolume:1}]});}if(file.endsWith('fugle-daytrade-ws-candles-v2.json'))return '{"candles":[]}';return '';},mkdirSync(){},writeFileSync(){events.push('save-state');},renameSync(){}};
 const mocks={fs:fakeFs,path,'./twse-trading-day':{isTwseTradingDay:async()=>({isTradingDay:true})},'../lib/daytrade-quote-liquidity-contract':{normalizeQuoteLiquidity:x=>x},'../lib/daytrade-fast-candle-row':{mapNaturalCandle:x=>x},'../lib/daytrade-candle-delta':{selectDelta:()=>({pending:[],checkpoint:{},unchanged:0,not_due:0})},'../lib/daytrade-fast-write-plan.cjs':{plan:()=>({rows:[],deferred:0,mode:'fixture'})}};
 const requireMock=name=>{if(quotesOnly&&name.includes('candle'))throw Error('Quote-only imported candle processing');if(!(name in mocks))throw Error('Unexpected import '+name);return mocks[name];};requireMock.main={};const module={exports:{}};
 const context={require:requireMock,module,process:{argv:apply?['node','fixture','--apply']:['node','fixture'],env:{SUPABASE_SERVICE_ROLE_KEY:'isolated-not-a-real-key'}},console:{log(){}},Date:Clock,Intl,AbortSignal,fetch:async()=>{events.push('write-quotes');return {ok:!failWrite,status:503,text:async()=> 'isolated failure'};}};
 vm.runInNewContext(source,context,{filename:'isolated-fast-sync.js'});
 const result=await module.exports.runFastSync({quotesOnly,canPublish:async()=>guard,beforeQuoteRead:async()=>{events.push('capture-before');return captureFails?{failure:true}:{captured:true};},afterQuoteWrite:async value=>{events.push('verify-after');assert.equal(value.write_completed_at,time);assert.equal(value.quotes_written,1);return {water_gate_pass:false,status:value.context.failure?'BLOCKED':'COMMITTED'};}});
 return {events,result};
}
(async()=>{
 let r=await exercise();assert.deepEqual(r.events,['capture-before','read-quotes','write-quotes','verify-after','save-state']);assert.equal(r.result.shared_water_acceptance.status,'COMMITTED');
 r=await exercise({apply:false});assert.deepEqual(r.events,['read-quotes']);assert.equal(r.result.shared_water_acceptance,undefined);
 await assert.rejects(()=>exercise({failWrite:true}),/HTTP_503/);
 r=await exercise({captureFails:true});assert.equal(r.result.quotes_written,1);assert.equal(r.result.shared_water_acceptance.status,'BLOCKED');assert(r.events.includes('save-state'));
 r=await exercise({quotesOnly:true});assert.deepEqual(r.events,['capture-before','read-quotes','write-quotes','verify-after']);assert.equal(r.result.candles_processed,false);assert.equal(r.result.candle_backfill_complete,false);
 await assert.rejects(()=>exercise({quotesOnly:true,guard:false}),/GUARD_REQUIRED/);
 console.log(JSON.stringify({ok:true,cases:6,mode:'actual_fast_sync_in_isolated_vm',http_requests:0,deployed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
