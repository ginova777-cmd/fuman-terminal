'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const text=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');
const extract=(start,end)=>{const i=text.indexOf(start),j=text.indexOf(end,i);assert(i>0&&j>i);return text.slice(i,j);};
const functions=[extract('async function supabaseGetPaged(', '\nasync function supabaseRpc('),extract('function strategyPriorityRunValidation(', '\nasync function readStrategyPriorityBridgeSource('),extract('async function readStrategyPriorityBridgeSource(', '\nfunction buildFormalStrategyChipArtifact(')].join('\n');
async function execute({count=1601,alter=x=>x,rangeError=false,missingCount=false}={}){
 const rows=Array.from({length:count},(_,i)=>({code:String(1000+i),run_id:'source-run',scan_date:'2026-09-17',rank:i+1,complete:true,quality_status:'complete'}));
 alter(rows);
 const pages=[];
 const run={run_id:'source-run',scan_date:'2026-09-17',status:'complete',complete:true,quality_status:'complete',finished_at:'2026-09-17T09:00:00Z',...(missingCount?{}:{result_count:count})};
 const context={require,process:{env:{}},SUPABASE_URL:'http://isolated.invalid',SUPABASE_READ_TIMEOUT_MS:1000,AbortSignal,
  requireSupabaseKey:()=> 'isolated',headers:()=>({}),supabaseGet:async()=>[run],
  supabaseFetch:async(url,options)=>{assert(url.includes('run_id=eq.source-run'));assert(!url.includes('limit='));assert(url.includes('code.asc'));assert.equal(options.headers.Prefer,'count=exact');const [offset,last]=options.headers.Range.split('-').map(Number);pages.push(offset);const page=rows.slice(offset,last+1);const contentRange=page.length?`${rangeError?offset+1:offset}-${offset+page.length-1}/${rows.length}`:`*/${rows.length}`;return {ok:true,status:200,text:async()=>JSON.stringify(page),headers:{get:()=>contentRange}};},
  resolveStrategyHandoff:async()=>({ok:true}),taipeiDate:()=> '2026-09-18',statePath:()=> 'isolated',
  compactDateKey:x=>String(x||'').replace(/\D/g,'').slice(0,8),objectPayload:x=>x&&typeof x==='object'?x:{},normalizeCode:x=>String(x||'')};
 vm.createContext(context);vm.runInContext(functions,context);
 const result=await context.readStrategyPriorityBridgeSource({key:'strategy4',latestResource:'runs',latestQuery:'select=*',resultsResource:'results',resultSelect:'*',codeMode:'stock'});
 return {result:JSON.parse(JSON.stringify(result)),pages};
}
(async()=>{let checks=0;
 const test=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
 await test('actual Writer and exact paged reader retain 1601 results',async()=>{const {result,pages}=await execute();assert.equal(result.status,'ready');assert.equal(result.symbols.length,1601);assert.deepEqual(pages,[0,1000]);assert.equal(result.sourceRows.length,1601);assert.equal(result.pages.length,2);assert.equal(result.reconciliation.expected_count,1601);});
 await test('zero complete run is a valid empty union',async()=>{const {result}=await execute({count:0});assert.equal(result.status,'ready');assert.deepEqual(result.symbols,[]);});
 await test('run count mismatch rejects truncated DB',async()=>{const {result}=await execute({alter:r=>r.pop()});assert.equal(result.status,'blocked');assert.equal(result.reason,'SOURCE_RESULT_COUNT_MISMATCH');assert.deepEqual(result.symbols,[]);});
 await test('missing authoritative count rejects source',async()=>{const {result}=await execute({missingCount:true});assert.equal(result.reason,'SOURCE_RESULT_COUNT_UNPROVEN');});
 for(const [field,value,reason] of [['run_id','other','SOURCE_ROW_RUN_MISMATCH'],['scan_date','2026-09-16','SOURCE_ROW_DATE_MISMATCH'],['code','bad','SOURCE_ROW_SYMBOL_INVALID'],['complete',false,'SOURCE_ROW_NOT_VALID']])await test(field+' mismatch rejects source',async()=>{const {result}=await execute({count:2,alter:r=>r[0][field]=value});assert.equal(result.reason,reason);assert.deepEqual(result.symbols,[]);});
 await test('malformed Content-Range rejected by actual reader',async()=>assert.rejects(execute({rangeError:true}),/paged_range_mismatch/));
 console.log(JSON.stringify({checks,scope:'isolated_actual_Writer_and_paged_reader',production_complete:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
