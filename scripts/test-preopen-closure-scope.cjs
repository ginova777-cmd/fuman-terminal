'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {run}=require('../lib/run-preopen-closure-stages');
const identity={trade_date:'2026-10-15',canonical_run_id:'test-c',writer_run_id:'test-w',generation_id:'test-g',mother_pool_run_id:'test-m',snapshot_generation:'test-s',snapshot_sequence:1};
(async()=>{
 let passed=0;
 async function check(selected,at,expected){const writes=[];await run({identity,symbols:['2330'],captures:[],selectedModules:selected,runtime:path.resolve('nonexistent-test-runtime'),now:()=>at,persist:async input=>{assert(selected.includes(input.module_id));assert(input.rows.every(r=>r.status!=='READY'));writes.push(input.module_id);return input;},capture:async id=>({module_id:id,status:1,stdout:'{}'})});assert.deepEqual(writes,expected);passed++;}
 await check(['A14'],'2026-10-15T00:59:00Z',['A14']);
 await check(['A19'],'2026-10-15T00:59:00Z',['A19']);
 await check(['A19','A14'],'2026-10-15T00:59:00Z',['A14','A19']);
 await check([],'2026-10-15T00:59:00Z',[]);
 await check(['A14','A19'],'2026-10-15T00:49:00Z',[]);
 await check(['A14','A19'],'2026-10-15T00:50:00Z',['A14']);
 for(const scope of [['A01'],['A14','A14'],null]){await assert.rejects(run({selectedModules:scope}),/PREOPEN_CLOSURE_SCOPE_INVALID/);passed++;}
 const writer=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');assert(writer.includes("selectedModules:moduleWorkIds().filter(id=>['A14','A19'].includes(id))"));passed++;
 console.log(JSON.stringify({status:'ISOLATED_CLOSURE_SCOPE_PASS',passed,scope:'Real closure collector with missing parents stays non-READY; mock persistence only; no formal acceptance'}));
})().catch(e=>{console.error(e);process.exitCode=1});
