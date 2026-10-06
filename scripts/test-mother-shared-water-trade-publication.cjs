'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {freshFixture,materialize}=require('./test-mother-shared-water-evidence.cjs');
const {freeze}=require('../lib/mother-shared-water-freeze.cjs');
const {createVerifier}=require('../lib/mother-shared-water-evidence.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex'),now=Date.parse('2026-10-06T05:00:00Z');
async function run(mode){
 const f=freshFixture(),b=materialize(f),identity={...f.receipt,canonical_run_id:'c',mother_pool_run_id:'m',snapshot_sequence:1,producer_version:'test',verification_run_id:'test-only'};
 const native={contract:'mother-native-trade-head-v1',symbol:'1216',trade_date:f.receipt.trade_date,connection_id:f.native.connection_id,subscription_id:'trade-sub',channel:'trades',received_at:f.native.received_at,is_synthetic:false,payload:{symbol:'1216',time:f.native.payload.lastTrade.time,serial:100,price:70}};
 if(mode==='newer')native.payload.time+=1000;
 if(mode==='conflict')native.payload.price=71;
 if(mode==='wrong-connection')native.connection_id='other';
 if(mode==='future')native.received_at='2026-10-06T05:01:00Z';
 const bytes=Buffer.from(JSON.stringify(native)),entry={symbol:'1216',raw_utf8:bytes.toString(),raw_sha256:hash(bytes)};
 const capture={contract:'mother-shared-water-capture-v1',captured_at:'2026-10-06T04:59:56Z',stored:true,authenticated:true,closed:false,connection_id:f.native.connection_id,rows:[{symbol:'1216',raw_utf8:b.raw.toString(),raw_sha256:hash(b.raw),transport_utf8:b.transport.toString(),transport_sha256:hash(b.transport)}],trade_heads:[entry]};
 let calls=0;
 const r=await freeze({identity,prioritySymbols:['1216'],snapshotBytes:Buffer.from(JSON.stringify({...identity,symbols:['1216']})),readCapture:async(options={})=>{const c=structuredClone(capture);if(options.after)c.captured_at='2026-10-06T05:00:00.001Z';if(calls++===0&&mode==='arrived')c.trade_heads=[];else if(calls>1&&mode==='changed')c.trade_heads[0].raw_sha256='f'.repeat(64);return c;},readback:async()=>({reader_role:'anon',complete:true,bytes:Buffer.from(JSON.stringify([f.publication.row]))}),writeCompletedAt:f.publication.write_completed_at,now:(()=>{let n=0;return ()=>now+(n++>1?2:0);})()});
 assert.equal(r.receipt.water_gate_pass,['normal','newer','arrived','changed'].includes(mode),JSON.stringify(r.receipt.rows));
 if(['newer','arrived','changed'].includes(mode)){const proof=createVerifier({resolve:ref=>r.blobs.get(ref),nowMs:()=>now+2})(r.receipt.rows[0],r.receipt);assert.equal(proof.publication_verified,true);assert.equal(proof.pipeline_caught_up,false);}
 if(mode==='normal'){
  const row=r.receipt.rows[0],proof=createVerifier({resolve:ref=>r.blobs.get(ref),nowMs:()=>now+2})(row,r.receipt);assert.equal(proof.verified,true);assert.equal(proof.continuity_verified,false);
  const p=JSON.parse(r.blobs.get(row.publication_evidence_ref));assert.equal(p.trade_head_sha256,hash(bytes));r.blobs.set(p.trade_head_ref,Buffer.from('{}'));assert.equal(createVerifier({resolve:ref=>r.blobs.get(ref),nowMs:()=>now+2})(row,r.receipt).verified,false);
 }
 return r;
}
(async()=>{for(const mode of ['normal','newer','conflict','wrong-connection','future','arrived','changed'])await run(mode);console.log(JSON.stringify({ok:true,cases:7,mode:'isolated',production_connected:false,no_new_trade_enabled:false}));})().catch(e=>{console.error(e);process.exitCode=1;});
