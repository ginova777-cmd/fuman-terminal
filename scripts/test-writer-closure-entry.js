'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),os=require('node:os');
const text=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8'),start=text.indexOf('    if(persistModuleInput && sideMinutes>=539'),end=text.indexOf('    result.payload.module_readback_capture=',start);
assert(start>0&&end>start);
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'writer-closure-entry-')),dir=path.join(runtime,'data','scan-receipts','modules');fs.mkdirSync(dir,{recursive:true});
(async()=>{try{
 const calls=[],captures=[],identity={trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1};
 const ctx={fs,path,process,__dirname,result:{payload:{writer_run_id:'w',generation_id:'g'}},sideMinutes:539,sideSnapshot:{canonical_run_id:'c',mother_pool_run_id:'m',generation:'s',snapshot_sequence:1,symbols:['2330']},taipeiDate:()=>identity.trade_date,runtimePath:(...p)=>path.join(runtime,...p),captures,captureArgs:['capture.js','--modules=A01','--write-set-index=old.json'],SUPABASE_SERVICE_KEY:'isolated-service',SUPABASE_READ_KEY:'isolated-anon',require,
 persistModuleInput:async input=>{calls.push('persist:'+input.module_id);assert.equal(input.rows[0].status,'DATA_GAP');return {plan:input,module_id:input.module_id};},
 spawnSync:(exe,args,options)=>{const id=args.find(a=>a.startsWith('--modules=')).slice(10);calls.push('capture:'+id);const idx=JSON.parse(fs.readFileSync(args.find(a=>a.startsWith('--write-set-index=')).slice(18)));assert.deepEqual(Object.keys(idx.modules),[id]);assert.equal(options.env.SUPABASE_ANON_KEY,'isolated-anon');const file=path.join(dir,id+'.json');fs.writeFileSync(file,JSON.stringify({...identity,module_id:id,captured_at:new Date().toISOString()}));return {status:1,stdout:JSON.stringify({results:[{module_id:id,file}]})};}};
 await vm.runInNewContext('(async()=>{'+text.slice(start,end)+'})()',ctx);
 assert.deepEqual(calls,['persist:A14','capture:A14','persist:A19','capture:A19']);assert.equal(captures.length,2);assert(captures.every(c=>c.status===1));
 console.log('PASS actual Writer closure entry preserves blocked results, independent indexes and DB/anon credential separation');
}finally{fs.rmSync(runtime,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
