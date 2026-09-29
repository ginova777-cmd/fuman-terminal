'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const closure=require('../lib/mother-pool-preopen-closure'),{run}=require('../lib/run-preopen-closure-stages');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'preopen-closure-')),dir=path.join(runtime,'data','scan-receipts','modules');fs.mkdirSync(dir,{recursive:true});
const identity={trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1},asOf='2026-09-29T01:00:00Z';
(async()=>{try{
 assert.equal(closure.dependencies('A14').length,12);assert.equal(closure.dependencies('A19').length,17);assert(!closure.dependencies('A19').includes('A10'));
 const missing=closure.collect({moduleId:'A14',identity,symbols:['2330'],references:{},asOf,runtime});assert.equal(missing.rows[0].status,'DATA_GAP');
 const file=path.join(dir,'a01.json');fs.writeFileSync(file,JSON.stringify({...identity,module_id:'A01',captured_at:asOf,complete:true,db_readback_ok:true,anon_readback_ok:true}));
 const ref={file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
 assert.equal(closure.inspect({moduleId:'A14',identity,references:{A01:ref},asOf,runtime}).A01.reason,'PARENT_VERIFIER_FAILED');
 assert.equal(closure.inspect({moduleId:'A14',identity:{...identity,writer_run_id:'other'},references:{A01:ref},asOf,runtime}).A01.reason,'PARENT_IDENTITY_MISMATCH');
 fs.appendFileSync(file,' ');assert.equal(closure.inspect({moduleId:'A14',identity,references:{A01:ref},asOf,runtime}).A01.reason,'PARENT_HASH_MISMATCH');
 for(const [stamp,expected] of [['2026-09-28T22:00:00Z',[]],['2026-09-29T00:49:59Z',[]],['2026-09-29T00:50:00Z',['A14']],['2026-09-29T00:59:00Z',['A14','A19']]]){
  const written=[];const outcomes=await run({identity,symbols:['2330'],captures:[],runtime,now:()=>stamp,persist:async input=>{written.push(input.module_id);return input;},capture:async()=>({stdout:'{}'})});
  assert.deepEqual(written,expected);for(const r of outcomes.filter(r=>r.status==='NOT_DUE'))assert.equal(r.complete,false);
 }
 await assert.rejects(run({identity,symbols:['2330'],captures:[],runtime,now:()=> '2026-09-30T00:00:00Z',persist:async()=>{throw Error('unexpected write');}}),/CROSS_DAY/);
 const order=[];
 await run({identity,symbols:['2330'],captures:[],runtime,now:()=>asOf,persist:async input=>{order.push('persist:'+input.module_id);assert.equal(input.rows[0].status,'DATA_GAP');if(input.module_id==='A19')assert(input.source_evidence.references.A14);return input;},capture:async id=>{order.push('capture:'+id);const f=path.join(dir,id+'.json');fs.writeFileSync(f,JSON.stringify({...identity,module_id:id,captured_at:asOf}));return {status:1,stdout:JSON.stringify({results:[{module_id:id,file:f}]})};}});
 assert.deepEqual(order,['persist:A14','capture:A14','persist:A19','capture:A19']);
 console.log('PASS closure rejects flags-only, absent, mixed and altered parents; A14 readback precedes A19 and gaps remain gaps');
}finally{fs.rmSync(runtime,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
