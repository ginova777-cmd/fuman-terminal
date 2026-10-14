'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),text=fs.readFileSync(path.join(root,'scripts/run-daytrade-source-writer.js'),'utf8');
const start=text.indexOf("    if(moduleWorkIds().some(id=>['A14','A19'].includes(id)) && persistModuleInput"),end=text.indexOf('    result.payload.module_readback_capture=',start);
assert(start>0&&end>start);const block=text.slice(start,end);
(async()=>{let passed=0;for(const selected of [['A14'],['A19'],['A14','A19'],['A01']]){
 const writes=[],captures=[];const identity={trade_date:'2026-10-15',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1};
 const context={moduleWorkIds:()=>selected,persistModuleInput:async input=>{assert(selected.includes(input.module_id));assert(input.rows.every(r=>r.status==='DATA_GAP'));writes.push(input.module_id);return input;},sideMinutes:539,sideSnapshot:{...identity,generation:'s',symbols:['2330']},taipeiDate:()=>identity.trade_date,result:{payload:{...identity,module_input_checkpoint:null}},captures,runtimePath:()=>path.join(root,'test-unused-runtime'),captureArgs:['--modules=A14,A19','--write-set-index=unused'],path,process:{execPath:process.execPath,env:{}},SUPABASE_SERVICE_KEY:'test-only',SUPABASE_READ_KEY:'test-anon',spawnSync:()=>({status:1,stdout:'{}'}),require:name=>{
 if(name==='../lib/run-preopen-closure-stages')return {run:args=>require('../lib/run-preopen-closure-stages').run({...args,now:()=> '2026-10-15T00:59:00Z'})};
 if(name==='../lib/daytrade-shared-evidence.cjs')return {write:()=>{}};
 return require(name);
 }};
 await vm.runInNewContext('(async()=>{'+block+'})()',context);assert.deepEqual(writes,selected.filter(id=>['A14','A19'].includes(id)));passed++;
 }console.log(JSON.stringify({status:'WRITER_CLOSURE_CALLSITE_ISOLATED_PASS',passed,scope:'Actual Writer block, real closure collector, simulated persistence/readback; not full Writer E2E'}));
})().catch(e=>{console.error(e);process.exitCode=1});
