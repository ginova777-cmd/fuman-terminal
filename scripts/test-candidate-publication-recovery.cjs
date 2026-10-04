'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const runtime=require('../lib/stock-future-standard-runtime.cjs');
const {publish}=require('../lib/publish-stock-future-candidates.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-readback-test-'));fs.mkdirSync(path.join(root,'state'));
const date='2026-10-05';let minute=0,sends=0,reads=0,committed=null,timeout=true,lease=true;
runtime.refresh=async()=>({source_hash:'a',run_id:'catalogue',standard_product_evidence:{raw_sha256:'b'}});
runtime.resolve=()=>({trade_date:date,catalogue_run_id:'catalogue',generated_at:date+`T01:${String(minute).padStart(2,'0')}:00Z`,candidates:[{future_symbol:'ABC'}],resolutions:[],counts:{candidates:1}});
const options={root,tradeDate:date,writerRunId:'writer',apply:true,key:'fixture',leaseValid:()=>lease,writeJson:(f,v)=>fs.writeFileSync(f,JSON.stringify(v)),send:async body=>{sends++;committed=body;if(timeout)throw Object.assign(Error('timed out'),{name:'AbortError'});return {status:'PUBLISHED',revision:body.p_revision,total_count:1,published_at:'now'};},readback:async p=>{reads++;return committed?{trade_date:date,catalogue_run_id:'catalogue',revision:committed.p_revision,counts:{candidates:1},published_at:'now'}:null;}};
(async()=>{
 await assert.rejects(()=>publish(options),{name:'AbortError'});
 const pending=JSON.parse(fs.readFileSync(path.join(root,'state/stock-future-candidate-pending.json')));assert.equal(pending.revision,committed.p_revision);
 minute=5;assert.equal((await publish(options)).status,'unchanged');assert.equal(sends,1);assert.equal(reads,1);
 await publish(options);assert.equal(reads,1);assert.equal(sends,1);
 // An absent revision can only resend the saved exact request, not a new timestamp.
 fs.writeFileSync(path.join(root,'state/stock-future-candidate-publication.json'),'{}');committed=null;timeout=false;
 await publish(options);assert.equal(committed.p_revision,pending.revision);assert.deepEqual(committed.p_payload,pending.payload);
 fs.writeFileSync(path.join(root,'state/stock-future-candidate-publication.json'),'{}');const before=sends;
 await assert.rejects(()=>publish({...options,readback:async()=>{throw Error('READ_TIMEOUT');}}),/READ_TIMEOUT/);assert.equal(sends,before);
 await assert.rejects(()=>publish({...options,readback:async()=>({...pending,counts:{candidates:99}})}),/READBACK_MISMATCH/);assert.equal(sends,before);
 lease=false;await assert.rejects(()=>publish(options),/LEASE/);
 console.log('PASS: committed timeout readback, stable retries, no repeated reads, absent revision replay, readback errors stop, lease guard; fixture only');
})().catch(e=>{console.error(e);process.exitCode=1;});
