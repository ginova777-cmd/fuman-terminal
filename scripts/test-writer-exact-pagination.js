'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const start=code.indexOf('async function supabaseGetPaged(');
const end=code.indexOf('async function supabaseRpc(',start);
async function run(pages){
 let calls=0;
 const ctx={requireSupabaseKey:()=> 'fixture',SUPABASE_URL:'https://fixture.invalid',headers:()=>({}),AbortSignal,SUPABASE_READ_TIMEOUT_MS:1000,
  supabaseFetch:async(url,options)=>{
   assert.equal(options.headers.Prefer,'count=exact');
   const page=pages[calls++];assert.ok(page,'unexpected extra request');
   return {ok:true,status:200,text:async()=>JSON.stringify(page.rows),headers:{get:()=>page.range}};
  }};
 const fn=vm.runInNewContext(code.slice(start,end)+'\nsupabaseGetPaged;',ctx);
 return fn('fixture','select=*',{pageSize:2,requireExactCount:true});
}
(async()=>{
 assert.equal((await run([{rows:[1,2],range:'0-1/3'},{rows:[3],range:'2-2/3'}])).length,3);
 assert.equal((await run([{rows:[],range:'*/0'}])).length,0);
 for(const pages of [
  [{rows:[1],range:'0-0/3'}],
  [{rows:[1,2],range:'0-1/*'}],
  [{rows:{bad:true},range:'*/0'}],
  [{rows:[1,2],range:'0-1/3'},{rows:[3],range:'2-2/4'}],
  [{rows:[1,2],range:'1-2/3'}],
 ]) await assert.rejects(()=>run(pages),/paged_/);
 console.log('PASS actual paged reader: exact total, empty, truncated page, unknown total, malformed body, count drift, range mismatch');
})().catch(e=>{console.error(e);process.exitCode=1;});
