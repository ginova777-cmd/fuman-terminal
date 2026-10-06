'use strict';
const assert=require('node:assert/strict');
const {freeze}=require('../lib/mother-shared-water-freeze.cjs');
const {freshFixture:fixture,materialize}=require('./test-mother-shared-water-evidence.cjs');
function args(changeHead=false){
 const f=fixture(),b=materialize(f),identity={...f.receipt,canonical_run_id:'c',mother_pool_run_id:'m',snapshot_sequence:1,producer_version:'test',verification_run_id:'test-only'};
 const capture={contract:'mother-shared-water-capture-v1',captured_at:'2026-10-06T04:59:56Z',stored:true,authenticated:true,closed:false,connection_id:f.native.connection_id,rows:[{symbol:'1216',raw_utf8:b.raw.toString(),raw_sha256:f.row.payload_sha256,transport_utf8:b.transport.toString(),transport_sha256:f.row.transport_sha256}]};let calls=0;
 return {identity,prioritySymbols:['1216'],snapshotBytes:Buffer.from(JSON.stringify({...identity,symbols:['1216']})),readCapture:async(options={})=>{const value=structuredClone(capture);if(options.after)value.captured_at='2026-10-06T05:00:00.001Z';if(calls++&&changeHead)value.rows[0].raw_sha256='f'.repeat(64);return value;},readback:async()=>({reader_role:'anon',complete:true,bytes:Buffer.from(JSON.stringify([f.publication.row]))}),writeCompletedAt:f.publication.write_completed_at,now:(()=>{let calls=0;return ()=>Date.parse('2026-10-06T05:00:00Z')+(calls++>1?2:0);})()};
}
(async()=>{let r=await freeze(args());assert.equal(r.receipt.status,'PASS');assert.equal(r.persisted,false);assert.equal(r.blobs.size,5);
 // v1.1 FRESH may have a newer pending head; its own publication must match.
 r=await freeze(args(true));assert.equal(r.receipt.status,'PASS');assert.equal(r.receipt.rows[0].source_status,'FRESH');
 r=await freeze({...args(),writtenSymbols:[]});assert.equal(r.receipt.status,'BLOCKED');assert.equal(r.receipt.requested_count,1);assert.equal(r.receipt.rows[0].source_status,'UNKNOWN');
 const a=args();a.readback=async()=>({reader_role:'service_role',complete:true,bytes:Buffer.from('[]')});await assert.rejects(()=>freeze(a),/ANON_READBACK_INVALID/);
 const limited=args();limited.maxBundleBytes=5;await assert.rejects(()=>freeze(limited),/BUNDLE_LIMIT/);
 console.log(JSON.stringify({ok:true,cases:5,mode:'isolated',production_connected:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
