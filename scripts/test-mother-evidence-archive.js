'use strict';
const assert=require('node:assert/strict'),{pack,unpack}=require('../lib/mother-pool-evidence-archive');
const {hash}=require('../lib/mother-pool-module-write-set');
const bridge={tradeDate:'2026-10-01',groups:{example:{rows:Array.from({length:2000},(_,i)=>({symbol:String(i),raw:'原始證據'.repeat(40)}))}}};
const encoded=pack(bridge);assert(encoded.bridge_archive);assert.deepEqual(unpack(encoded),bridge);
assert.equal(hash(unpack(JSON.parse(JSON.stringify(encoded)))),hash(bridge));
assert(Buffer.byteLength(JSON.stringify(encoded))<Buffer.byteLength(JSON.stringify(bridge))/2);
assert.deepEqual(unpack({bridge}),bridge);assert.deepEqual(pack(null),{bridge:null});
assert.throws(()=>unpack({}),/MISSING/);assert.throws(()=>unpack({...encoded,bridge}),/AMBIGUOUS/);
for(const mutate of [a=>a.raw_sha256='0'.repeat(64),a=>a.raw_bytes--,a=>a.raw_bytes=33*1024*1024,a=>a.contract='wrong',a=>a.data+=' ',a=>a.data=a.data.slice(0,-8)]){
 const changed=structuredClone(encoded);mutate(changed.bridge_archive);assert.throws(()=>unpack(changed));
}
// The producer keeps every row and its original source hash. The verifier
// rejects missing source contracts for both plain and archived evidence.
const {collect,verify}=require('../lib/mother-pool-warmup-union');
const identity={trade_date:'2026-10-01',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1};
const input=collect({identity,symbols:['2330'],bridge,asOf:'2026-10-01T00:00:00Z'});
assert.equal(input.rows[0].source_hash,hash(bridge));assert(input.source_evidence.bridge_archive);
assert.equal(verify(input.rows,{...identity,writer_write_set:{plan:input}}),false);
// Exercise successful verification through the actual module with a minimal
// registered-source fixture. Production's registry and gate rules are untouched.
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const file=require.resolve('../lib/mother-pool-warmup-union'),localRequire=createRequire(file),moduleStub={exports:{}};
const context={module:moduleStub,exports:moduleStub.exports,require:id=>id==='./terminal-strategy-morning-handoff'?{...localRequire(id),SOURCE_REGISTRY:{strategy2:{producer:'fixture'}}}:localRequire(id)};
vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
const valid={tradeDate:identity.trade_date,previousSourceDate:'2026-09-30',updatedAt:'2026-10-01T00:00:00Z',groups:{strategy2:{status:'ready',runId:'r',scanDate:'2026-09-30',symbols:['2330'],sourceReceipt:{run_id:'r',trade_date:'2026-09-30',status:'complete',result_count:1,checked_at:'2026-09-30T05:00:00Z'},sourceRows:[{symbol:'2330',run_id:'r',trade_date:'2026-09-30',raw:'source'.repeat(20000)}],handoff:{ok:true,failed_checks:[],source_run_id:'r',strategy_source_date:'2026-09-30',handoff_trade_date:identity.trade_date}}}};
const success=moduleStub.exports.collect({identity,symbols:['2330'],bridge:valid,asOf:'2026-10-01T00:01:00Z'});
assert(success.source_evidence.bridge_archive);assert.equal(success.rows[0].status,'READY');
const round={...identity,writer_write_set:{plan:success}};
assert.equal(moduleStub.exports.verify(success.rows,round),true);
const tampered=JSON.parse(JSON.stringify(round));tampered.writer_write_set.plan.source_evidence.bridge_archive.raw_sha256='0'.repeat(64);
assert.equal(moduleStub.exports.verify(success.rows,tampered),false);
const legacy=JSON.parse(JSON.stringify(round));legacy.writer_write_set.plan.source_evidence={bridge:valid};
assert.equal(moduleStub.exports.verify(success.rows,legacy),true);
console.log('PASS: lossless archive/JSON roundtrip, original hash, legacy evidence, corrupt hash/size/encoding rejection, bounded inflate and unchanged fail-closed source gates.');
