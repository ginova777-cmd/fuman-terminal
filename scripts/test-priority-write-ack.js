'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const text=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');
const code=text.slice(text.indexOf('async function supabaseUpsert('),text.indexOf('async function supabaseDelete('));
const row={symbol:'2330',updated_at:'2026-09-29T02:00:00Z',payload:{trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',value:10}};
async function run(alter=x=>x,mode='timeout'){
 let writes=0,reads=0;const box={require,JSON,Buffer,DRY_RUN:false,requireSupabaseKey:()=> 'isolated',SUPABASE_WRITE_TIMEOUT_MS:100,SUPABASE_URL:'https://isolated.invalid',headers:()=>({}),AbortSignal,URLSearchParams,setTimeout,console:{log:()=>{},error:()=>{}},
  fetch:async()=>{writes++;if(mode==='http')return {ok:false,status:503,text:async()=> 'unavailable'};throw Object.assign(Error('timeout'),{name:'TimeoutError'});},
  supabaseGetPaged:async(resource,query,options)=>{reads++;const q=new URLSearchParams(query);assert.equal(q.get('payload->>writer_run_id'),'eq.w');assert.equal(options.requireExactCount,true);return alter([structuredClone(row)]);}};
 vm.runInNewContext(code,box);
 try{return {result:await box.supabaseUpsert('fugle_daytrade_priority_pool',[row],'symbol',{retries:1}),writes,reads};}catch(error){return {error,writes,reads};}
}
(async()=>{
 let r=await run();assert.equal(r.result.written,1);assert.equal(r.writes,1);assert.equal(r.reads,1);
 for(const alter of [()=>[],x=>[...x,...x],x=>{x[0].payload.generation_id='other';return x;},x=>{x[0].payload.value=11;return x;}]){r=await run(alter);assert(r.error);assert.equal(r.writes,1);assert.equal(r.reads,1);}
 r=await run(x=>x,'http');assert(r.error);assert.equal(r.writes,1);assert.equal(r.reads,0);
 r=await run(x=>{x[0].updated_at='2026-09-29T02:00:00+00:00';return x;});assert.equal(r.result.written,1);
 let writes=0,reads=0,last;
 const box={require,JSON,Buffer,DRY_RUN:false,requireSupabaseKey:()=> 'isolated',SUPABASE_WRITE_TIMEOUT_MS:100,SUPABASE_URL:'https://isolated.invalid',headers:()=>({}),AbortSignal,URLSearchParams,setTimeout,console:{log:()=>{},error:()=>{}},
  fetch:async(_url,options)=>{writes++;last=JSON.parse(options.body);if(writes===1)return {ok:true};throw Object.assign(Error('timeout'),{name:'TimeoutError'});},
  supabaseGetPaged:async(_resource,_query,options)=>{reads++;assert.equal(options.maxRows,500);return writes===2?last:[];}};
 vm.runInNewContext(code,box);
 const batch=['2330','2317','1101'].map(symbol=>({...row,symbol}));
 await assert.rejects(box.supabaseUpsert('fugle_daytrade_priority_pool',batch,'symbol',{batchSize:1,retries:1}),/PRIORITY_ACK_SET_MISMATCH/);
 assert.equal(writes,3);assert.equal(reads,2);
 const before=writes;
 await assert.rejects(box.supabaseUpsert('fugle_daytrade_priority_pool',batch.map(r=>({...r,payload:{...r.payload,value:999}})),'symbol'),/PRIORITY_ROUND_WRITE_UNCONFIRMED/);
 assert.equal(writes,before);assert.equal(reads,2);
 box.fetch=async()=>{writes++;return {ok:true,status:200};};
 const next=batch.map(r=>({...r,payload:{...r.payload,writer_run_id:'next-writer',generation_id:'next-generation'}}));
 assert.equal((await box.supabaseUpsert('fugle_daytrade_priority_pool',next,'symbol')).written,3);
 assert.equal(writes,before+1);
 // A successfully acknowledged phase may still publish a later rebuilt phase.
 assert.equal((await box.supabaseUpsert('fugle_daytrade_priority_pool',next,'symbol')).written,3);
 assert.equal(writes,before+2);
 await assert.rejects(box.supabaseUpsert('fugle_daytrade_priority_pool',[next[0],batch[1]],'symbol'),/PRIORITY_ROUND_IDENTITY_INVALID/);
 assert.equal(writes,before+2);
 let release;box.fetch=async()=>{writes++;await new Promise(resolve=>{release=resolve;});return {ok:true,status:200};};
 const pending=box.supabaseUpsert('fugle_daytrade_priority_pool',next,'symbol');
 await assert.rejects(box.supabaseUpsert('fugle_daytrade_priority_pool',next,'symbol'),/PRIORITY_ROUND_WRITE_INFLIGHT/);
 release();await pending;assert.equal(writes,before+3);
 console.log('PASS actual Writer priority timeout: one POST, exact same-batch GET acknowledgement; partial/duplicate/new generation/content mismatch reject without replay; HTTP failure not blindly retried. Isolated only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
