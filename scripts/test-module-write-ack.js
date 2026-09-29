'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {hash}=require('../lib/mother-pool-module-write-set');
const plan={created_at:'2026-09-29T01:00:00Z',requested_symbols:['2330'],rows:[{symbol:'2330',value:7}]};
const document={contract:'mother_pool_module_write_set_v1',module_id:'A01',module_contract:'test',trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1,plan,plan_hash:hash(plan)};
const round={module_id:'A01',trade_date:document.trade_date,writer_run_id:'w',document,committed_at:'2026-09-29T01:00:01Z'};
const row={module_id:'A01',trade_date:document.trade_date,writer_run_id:'w',symbol:'2330',evidence:plan.rows[0]};
const src=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');
const start=src.indexOf('persist:async body=>{',src.indexOf('const evidenceId='));
const end=src.indexOf('\n            },',start);
const code='callback=async body=>{'+src.slice(start+'persist:async body=>{'.length,end)+'\n}';
async function run(alter=()=>{},mode='timeout'){
 let writes=0,reads=0;const rounds=JSON.parse(JSON.stringify([round])),rows=JSON.parse(JSON.stringify([row]));alter(rounds,rows);
 const ctx={require,JSON,URLSearchParams,AbortSignal,DRY_RUN:false,SUPABASE_URL:'https://isolated.invalid',SUPABASE_WRITE_TIMEOUT_MS:10,headers:()=>({}),requireSupabaseKey:()=> 'isolated',
  fetch:async()=>{writes++;if(mode==='http')return {ok:false,status:503,text:async()=> 'failed'};throw Object.assign(Error('timeout'),{name:'TimeoutError'});},
  supabaseGetPaged:async(resource,query,options)=>{reads++;const q=new URLSearchParams(query);assert.equal(q.get('writer_run_id'),'eq.w');assert.equal(q.get('trade_date'),'eq.2026-09-29');assert.equal(options.pageSize,500);assert.equal(options.requireExactCount,true);return resource.endsWith('round_v2')?rounds:rows;}};
 vm.runInNewContext(code,ctx);
 try{return {ack:await ctx.callback({p_document:JSON.stringify(document),p_plan:JSON.stringify(plan)}),writes,reads};}catch(error){return {error,writes,reads};}
}
(async()=>{
 let result=await run();assert.equal(result.ack.committed,true);assert.equal(result.writes,1);assert.equal(result.reads,2);
 for(const change of [(r)=>r.splice(0),(r)=>r.push(r[0]),(r)=>{r[0].document.generation_id='new';},(_r,x)=>x.splice(0),(_r,x)=>x.push(x[0]),(_r,x)=>{x[0].evidence.value=8;},(_r,x)=>{x[0].writer_run_id='new';},r=>{r[0].committed_at='invalid';}]){
  result=await run(change);assert(result.error);assert.equal(result.writes,1);assert.equal(result.reads,2);
 }
 result=await run(()=>{},'http');assert(result.error);assert.equal(result.writes,1);assert.equal(result.reads,0);
 console.log('PASS actual Writer module RPC timeout exact readback; missing/duplicate/mismatched rows, generation and commit time fail; one POST only; HTTP503 never replayed. Isolated no network.');
})().catch(e=>{console.error(e);process.exitCode=1;});
