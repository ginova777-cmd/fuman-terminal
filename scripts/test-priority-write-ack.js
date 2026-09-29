'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const text=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');
const code=text.slice(text.indexOf('async function supabaseUpsert('),text.indexOf('async function supabaseDelete('));
const row={symbol:'2330',updated_at:'2026-09-29T02:00:00Z',payload:{trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',value:10}};
async function run(alter=x=>x,mode='timeout'){
 let writes=0,reads=0;const box={require,JSON,DRY_RUN:false,requireSupabaseKey:()=> 'isolated',SUPABASE_WRITE_TIMEOUT_MS:100,SUPABASE_URL:'https://isolated.invalid',headers:()=>({}),AbortSignal,URLSearchParams,setTimeout,console:{log:()=>{}},
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
 console.log('PASS actual Writer priority timeout: one POST, exact same-batch GET acknowledgement; partial/duplicate/new generation/content mismatch reject without replay; HTTP failure not blindly retried. Isolated only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
