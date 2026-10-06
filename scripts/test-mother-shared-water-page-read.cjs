'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {loadPaged}=require('../lib/mother-shared-water-remote-evidence.cjs');
const sha=x=>createHash('sha256').update(x).digest('hex');
async function exercise(mode='normal'){
 const blobs=new Map(Array.from({length:513},(_,i)=>{const b=Buffer.from(i===512?'x'.repeat(200000):'native-fixture-'+i);return [sha(b),b];}));
 const hashes=[...blobs.keys()].sort(),run='isolated-page';
 const receipt={contract:'mother-pool-shared-water-acceptance-v1',verification_run_id:run,evidence_hashes:hashes},text=JSON.stringify(receipt);
 let requests=0;
 const chunk=(h,offset=0)=>{const b=blobs.get(h),encoded=b.toString('base64'),next=offset+131072;return {contract:'mother-shared-water-evidence-chunk-v1',verification_run_id:run,sha256:h,byte_length:b.length,total_chars:encoded.length,offset,base64_chunk:encoded.slice(offset,next),next_offset:next<encoded.length?next:null};};
 const result=await loadPaged({url:'https://isolated.invalid',key:'x.'+Buffer.from('{"role":"anon"}').toString('base64url')+'.x',runId:run,receiptSha256:sha(text),fetchImpl:async(url,options)=>{
  requests++;const body=JSON.parse(options.body);let value;
  if(url.pathname.endsWith('get_mother_shared_water_receipt'))value={contract:'mother-shared-water-readback-v1',verification_run_id:run,receipt_utf8:text,receipt_sha256:sha(text)};
  else if(url.pathname.endsWith('get_mother_shared_water_evidence_page')){
   const start=body.p_after_sha256===null?0:hashes.indexOf(body.p_after_sha256)+1,selected=hashes.slice(start,start+256),complete=start+selected.length===hashes.length;
   value={contract:'mother-shared-water-evidence-page-v1',verification_run_id:run,after_sha256:body.p_after_sha256,next_after_sha256:complete?null:selected.at(-1),complete,chunks:selected.map(h=>chunk(h))};
   if(mode==='missing')value.chunks.shift();
   if(mode==='duplicate')value.chunks[1]=value.chunks[0];
   if(mode==='wrong-run')value.verification_run_id='other';
   if(mode==='wrong-cursor')value.next_after_sha256='f'.repeat(64);
   if(mode==='early-complete')value.complete=true;
   if(mode==='empty')value.chunks=[];
  }else if(url.pathname.endsWith('get_mother_shared_water_evidence_chunk'))value=chunk(body.p_sha256,body.p_offset);
  else throw Error('UNEXPECTED_RPC');
  return {ok:true,body:(async function*(){yield Buffer.from(JSON.stringify(value));})()};
 }});
 for(const [h,b]of blobs)assert(result.resolve('sha256:'+h).equals(b));
 assert.equal(requests,6); // receipt + three pages + two large-blob continuations
 assert.equal(result.water_gate_pass,false);return result;
}
(async()=>{const result=await exercise();for(const mode of ['missing','duplicate','wrong-run','wrong-cursor','early-complete','empty'])await assert.rejects(()=>exercise(mode),/EVIDENCE_PAGE_/);console.log(JSON.stringify({ok:true,cases:7,evidence_blobs:513,requests:result.diagnostics.requests,mode:'isolated_paged_transport',real_http:false,deployed:false}));})().catch(e=>{console.error(e);process.exitCode=1;});
