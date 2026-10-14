'use strict';
const fs=require('fs'),p=require('path'),os=require('os'),assert=require('assert/strict');
const lib=require('../lib/daytrade-shared-evidence.cjs');const rt=fs.mkdtempSync(p.join(os.tmpdir(),'evidence-write-snapshot-'));const shared={source_hash:'source-v1',rows:Array.from({length:80},(_,i)=>({symbol:String(i),text:'natural證據'.repeat(8)}))};
const rounds=[1,2].map(i=>({module_id:'B24',writer_run_id:'w'+i,generation_id:'g'+i,db_readback:shared,anon_readback:shared}));const paths=rounds.map((r,i)=>{const f=p.join(rt,'round'+i+'.json');lib.write(f,r,rt);return f;});
const value={module_id:'B24',rounds_verified:rounds};const reads=new Map(),original=fs.readFileSync;fs.readFileSync=function(file,...args){if(String(file).includes('shared-evidence'))reads.set(String(file),(reads.get(String(file))||0)+1);return original.call(this,file,...args);};
const out=p.join(rt,'verified.json');let envelope;try{envelope=lib.write(out,value,rt,{roundFiles:paths});}finally{fs.readFileSync=original;}
assert(reads.size>0);assert([...reads.values()].every(n=>n===1),'each shared byte blob once within write');lib.verifyProcessBytes(out,rt,envelope.sha256);assert.deepEqual(lib.read(out,rt),value);
const blob=[...reads.keys()][0],bytes=fs.readFileSync(blob);fs.writeFileSync(blob,'{}');assert.throws(()=>lib.verifyProcessBytes(out,rt,envelope.sha256),/EVIDENCE_HASH_DRIFT/);assert.throws(()=>lib.write(p.join(rt,'later.json'),value,rt,{roundFiles:paths}),/EVIDENCE_HASH_DRIFT/);fs.writeFileSync(blob,bytes);
const changed=structuredClone(value);changed.rounds_verified[0].generation_id='other';assert.throws(()=>lib.write(p.join(rt,'wrong-generation.json'),changed,rt,{roundFiles:paths}),/EVIDENCE_PARENT_CHANGED/);
assert.throws(()=>lib.verifyProcessBytes(out,rt,'0'.repeat(64)),/EVIDENCE_PROCESS_RESULT_DRIFT/);
console.log(JSON.stringify({pass:true,tests:['one_read_per_blob_per_write','exact_roundtrip','independent_readback','changed_bytes_rejected','no_cross_write_cache','generation_drift_rejected','process_hash_mismatch_rejected'],runtime:rt}));
