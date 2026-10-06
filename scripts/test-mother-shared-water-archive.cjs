'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{gzipSync}=require('node:zlib');
const {pack,unpack}=require('../lib/mother-shared-water-archive.cjs');const sha=b=>createHash('sha256').update(b).digest('hex');
const blobs=new Map();for(let i=0;i<1235;i++){const raw=Buffer.from(JSON.stringify({contract:'market-evidence-fixture',symbol:String(1000+i%411),sequence:i,trade_date:'2026-10-06',received_at:'2026-10-06T01:00:00Z',payload:{price:70,source:'Fugle.websocket.aggregates',size:10}}));blobs.set('sha256:'+sha(raw),raw);}
const receipt={contract:'mother-pool-shared-water-acceptance-v1',verification_run_id:'isolated-archive',evidence_hashes:[...blobs.keys()].map(k=>k.slice(7)).sort(),water_gate_pass:false};
const packed=pack({receipt,blobs}),expected={archiveSha256:packed.archive_sha256,receiptSha256:packed.receipt_sha256,runId:receipt.verification_run_id};
let restored=unpack(packed.archive,expected);for(const [ref,bytes]of blobs)assert(restored.resolve(ref).equals(bytes));
assert.throws(()=>unpack(Buffer.from('corrupt'),expected),/HASH_INVALID/);
assert.throws(()=>unpack(packed.archive,{...expected,receiptSha256:'0'.repeat(64)}),/RECEIPT_MISMATCH/);
assert.throws(()=>unpack(packed.archive,{...expected,runId:'other'}),/MANIFEST_INVALID/);
assert.throws(()=>pack({receipt:{...receipt,evidence_hashes:[]},blobs}),/MANIFEST_INVALID/);
assert.throws(()=>pack({receipt,blobs:new Map([...blobs].slice(1))}),/BLOB_SET_MISMATCH/);
const bomb=gzipSync(Buffer.alloc(16*1024*1024+1));assert.throws(()=>unpack(bomb,{...expected,archiveSha256:sha(bomb)}));
const first=[...blobs.keys()][0],copy=restored.resolve(first);copy.fill(0);assert(restored.resolve(first).equals(blobs.get(first)));
console.log(JSON.stringify({ok:true,cases:8,mode:'isolated_lossless_archive',evidence_blobs:blobs.size,raw_bytes:packed.raw_bytes,archive_bytes:packed.archive.length,compression_ratio:packed.archive.length/packed.raw_bytes,production_connected:false,deployed:false}));
