"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');
const fn=source.slice(source.indexOf('async function supabaseGetPaged('),source.indexOf('\nasync function supabaseRpc('));
async function run(count,maxRows,corrupt=false){
 const ctx={SUPABASE_URL:'https://fixture.invalid',SUPABASE_READ_TIMEOUT_MS:1000,AbortSignal,requireSupabaseKey:()=>'',headers:()=>({}),supabaseFetch:async(url,options)=>{
  const [offset,last]=options.headers.Range.split('-').map(Number),size=Math.min(last+1,count)-offset;
  const rows=Array.from({length:Math.max(0,size)},(_,i)=>({row:offset+i}));
  return {ok:true,text:async()=>JSON.stringify(rows),headers:{get:()=>`${offset}-${offset+rows.length-1}/${corrupt&&offset?count+1:count}`}};
 }};
 vm.createContext(ctx);vm.runInContext(fn,ctx);return ctx.supabaseGetPaged('history','',{maxRows,requireExactCount:true});
}
test('15-session market history above 20000 rows is fully read with an explicit bounded budget',async()=>{
 const rows=await run(28501,60000);assert.equal(rows.length,28501);assert.equal(rows.at(-1).row,28500);
 assert.match(source,/maxRows:60000,requireExactCount:true/);
});
test('default budget and changing exact totals still fail closed',async()=>{
 await assert.rejects(run(28501,undefined),/paged_exact_count_exceeds_budget/);
 await assert.rejects(run(28501,60000,true),/paged_exact_count_changed/);
 await assert.rejects(run(60001,60000),/paged_exact_count_exceeds_budget/);
});
