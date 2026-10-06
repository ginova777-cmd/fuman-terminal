'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {load}=require('../lib/mother-shared-water-remote-evidence.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const key='x.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.x';
function setup(mutate=()=>{}){
 const bytes=Buffer.alloc(200000,65),h=sha(bytes),run='isolated-run',receipt={contract:'mother-pool-shared-water-acceptance-v1',verification_run_id:run,evidence_hashes:[h]};
 const text=JSON.stringify(receipt),pinned=sha(text);let calls=0;
 const options={batchSize:1,url:'https://example.invalid',key,runId:run,receiptSha256:pinned,fetchImpl:async(url,opt)=>{
  calls++;const b=JSON.parse(opt.body);let response;
  if(String(url).endsWith('get_mother_shared_water_receipt'))response={contract:'mother-shared-water-readback-v1',verification_run_id:run,receipt_utf8:text,receipt_sha256:pinned};
  else{const encoded=bytes.toString('base64'),o=b.p_offset,n=Math.min(o+b.p_length,encoded.length);response={contract:'mother-shared-water-evidence-chunk-v1',verification_run_id:run,sha256:h,byte_length:bytes.length,total_chars:encoded.length,offset:o,base64_chunk:encoded.slice(o,n),next_offset:n<encoded.length?n:null};}
  mutate(response,calls);return new Response(JSON.stringify(response),{status:200});
 }};
 return {options,bytes,h,calls:()=>calls};
}
(async()=>{let count=0;
 const a=setup(),r=await load(a.options);assert.equal(r.transport_complete,true);assert.equal(r.water_gate_pass,false);assert.equal(r.diagnostics.requests,4);assert.deepEqual(r.resolve('sha256:'+a.h),a.bytes);r.resolve('sha256:'+a.h).fill(0);assert.deepEqual(r.resolve('sha256:'+a.h),a.bytes);count++;
 for(const [mutate,error] of [
  [(r,n)=>{if(n===1)r.receipt_utf8+=' ';},/RECEIPT_HASH/],
  [(r,n)=>{if(n>1)r.verification_run_id='other';},/CHUNK_IDENTITY/],
  [(r,n)=>{if(n>1)r.offset++;},/CHUNK_IDENTITY/],
  [(r,n)=>{if(n>1)r.next_offset=0;},/CHUNK_RANGE/],
  [(r,n)=>{if(n>1)r.base64_chunk=r.base64_chunk.slice(1);},/CHUNK_RANGE/],
  [(r,n)=>{if(n===2)r.base64_chunk='B'+r.base64_chunk.slice(1);},/EVIDENCE_HASH/],
  [(r,n)=>{if(n===3){r.byte_length+=3;r.total_chars+=4;}},/CHUNK_CHANGED/]
 ]){await assert.rejects(()=>load(setup(mutate).options),error);count++;}
 for(const [change,error]of [[o=>o.maxRequests=1,/REQUEST_LIMIT/],[o=>o.maxBundleBytes=10,/BUNDLE_LIMIT/],[o=>o.deadlineMs=0,/DEADLINE/],[o=>o.key='x.'+Buffer.from('{"role":"service_role"}').toString('base64url')+'.x',/ANON_JWT/],[o=>o.receiptSha256=null,/PINNED_RECEIPT/]]){const t=setup();change(t.options);await assert.rejects(()=>load(t.options),error);count++;}
 const fail=setup();let calls=0;fail.options.fetchImpl=async()=>{calls++;return new Response('',{status:522});};await assert.rejects(()=>load(fail.options),/HTTP_522/);assert.equal(calls,1);count++;
 console.log(JSON.stringify({ok:true,cases:count,mode:'isolated',production_connected:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
