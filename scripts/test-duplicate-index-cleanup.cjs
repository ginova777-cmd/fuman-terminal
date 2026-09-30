const assert=require('node:assert/strict');const {run}=require('./cleanup-duplicate-indexes.cjs');
const response=count=>({contract:'duplicate-index-cleanup-v1',ok:true,count});
(async()=>{
 let calls=[],saved=false;
 const r=await run({apply:true,save(){saved=true},rpc:async apply=>{calls.push(apply);if(apply)assert(saved);return response(calls.length===1?16:0)}});assert(r.ok);assert.deepEqual(calls,[false,true,false]);
 calls=[];await assert.rejects(run({apply:true,save(){},rpc:async apply=>{calls.push(apply);if(apply)throw Error('timeout');return response(16)}}),/timeout/);assert.deepEqual(calls,[false,true]);
 const drift=await run({apply:true,save(){},rpc:async()=>response(1)});assert.equal(drift.ok,false);
 calls=[];const preview=await run({save(){},rpc:async x=>{calls.push(x);return response(16)}});assert.equal(preview.applied,false);assert.deepEqual(calls,[false]);
 await assert.rejects(run({apply:true,save(){throw Error('disk full')},rpc:async()=>response(16)}),/disk full/);
 console.log('PASS: save before mutation, no retries after timeout, residual detection, preview no apply, evidence-write failure blocks');
})();
