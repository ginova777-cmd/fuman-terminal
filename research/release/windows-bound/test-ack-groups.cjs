'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {validateAck}=require('./stop-ack-contract.cjs');
const a=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
const i=Object.fromEntries(['pid','creation_time','epoch','entry','executable'].map(k=>[k,a[k]]));
const q={...i,request_id:a.request_id,requested_at:a.requested_at};
const rows=[];function test(name,fn){fn();rows.push({name,pass:true})}
test('saved nonempty ACK groups=1 accepted',()=>assert.equal(validateAck(a,q,i).kind,'SAVED_ARTIFACTS_REQUIRE_READBACK'));
for(const place of ['pending','proof.pending'])for(const k of ['dirty_groups','pending_records'])test(place+'.'+k+' nonzero rejected',()=>{const x=structuredClone(a);(place==='pending'?x.pending:x.proof.pending)[k]=1;assert.throws(()=>validateAck(x,q,i),/ACK_PENDING/)});
for(const v of [-1,0.5,'1',null])test('invalid groups '+JSON.stringify(v),()=>{const x=structuredClone(a);x.pending.groups=v;assert.throws(()=>validateAck(x,q,i),/ACK_GROUPS/)});
const zero=structuredClone(a);zero.boundary={events:0,quotes:0,candles:0,last_event:null};zero.proof.files=[];zero.proof.caches=[];zero.proof.accepted=0;zero.proof.rejected=0;zero.proof.conflicts=0;zero.proof.publication={files_written:0,bars_published:0,bytes_written:0};
test('empty proof with retained group rejected',()=>assert.throws(()=>validateAck(zero,q,i),/ZERO_GROUPS_UNPROVEN/));
zero.pending.groups=0;zero.proof.pending.groups=0;
test('zero-data proof remains accepted',()=>assert.equal(validateAck(zero,q,i).kind,'ZERO_ACCEPTED_IN_BOUND_EPOCH'));
console.log(JSON.stringify({status:'PASS',count:rows.length,tests:rows},null,2));
