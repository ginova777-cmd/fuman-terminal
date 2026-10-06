'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {freshFixture,fixture,materialize}=require('./test-mother-shared-water-evidence.cjs');
const {freeze}=require('../lib/mother-shared-water-freeze.cjs');
const {load}=require('../lib/mother-shared-water-remote-evidence.cjs');
const {createVerifier}=require('../lib/mother-shared-water-evidence.cjs');
const {verifyLoaded}=require('../lib/mother-shared-water-consumer.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),now=Date.parse('2026-10-06T05:00:00Z');
async function check(idle,page=false,archive=false){
 const f=idle?fixture():freshFixture(),b=materialize(f);
 const identity={...f.receipt,canonical_run_id:'canonical',mother_pool_run_id:'mother',snapshot_sequence:1,producer_version:'test-only',verification_run_id:'remote-integration-'+idle};
 const capture={contract:'mother-shared-water-capture-v1',captured_at:'2026-10-06T04:59:56Z',stored:true,authenticated:true,closed:false,connection_id:f.native.connection_id,rows:[{symbol:'1216',raw_utf8:b.raw.toString(),raw_sha256:hash(b.raw),transport_utf8:b.transport.toString(),transport_sha256:hash(b.transport)}]};
 const bundle=await freeze({identity,prioritySymbols:['1216'],snapshotBytes:Buffer.from(JSON.stringify({...identity,status:'complete',complete:true,symbols:['1216']})),readCapture:async(options={})=>({...structuredClone(capture),captured_at:options.after?'2026-10-06T05:00:00.001Z':capture.captured_at}),readback:async()=>({reader_role:'anon',complete:true,bytes:Buffer.from(JSON.stringify([f.publication.row]))}),writeCompletedAt:f.publication.write_completed_at,now:(()=>{let n=0;return ()=>now+(n++>1?2:0);})()});
 const text=JSON.stringify(bundle.receipt),receiptHash=hash(text);
 const packed=archive?require('../lib/mother-shared-water-archive.cjs').pack(bundle):null;
 const transport={page,archive,batchSize:1,url:'https://example.invalid',key:'x.'+Buffer.from('{"role":"anon"}').toString('base64url')+'.x',runId:identity.verification_run_id,receiptSha256:receiptHash,now:()=>now,fetchImpl:async(url,options)=>{
  const q=JSON.parse(options.body);
  if(String(url).endsWith('find_mother_shared_water_receipt')){
   for(const [field,value] of Object.entries(q.p_expected))assert.equal(value,bundle.receipt[field]);
   return Response.json({contract:'mother-shared-water-pointer-v1',verification_run_id:identity.verification_run_id,receipt_sha256:receiptHash,checked_at:bundle.receipt.checked_at,valid_until:bundle.receipt.valid_until,evidence_current:true});
  }
  assert.equal(q.p_verification_run_id,identity.verification_run_id);
  if(String(url).endsWith('get_mother_shared_water_receipt'))return Response.json({contract:'mother-shared-water-readback-v1',verification_run_id:identity.verification_run_id,receipt_utf8:text,receipt_sha256:receiptHash,...(packed?{archive_sha256:packed.archive_sha256,archive_bytes:packed.archive.length,archive_raw_bytes:packed.raw_bytes}:{})});
  if(String(url).endsWith('get_mother_shared_water_archive_chunk')){const encoded=packed.archive.toString('base64'),next=q.p_offset+q.p_length;return Response.json({contract:'mother-shared-water-archive-chunk-v1',verification_run_id:identity.verification_run_id,archive_sha256:packed.archive_sha256,byte_length:packed.archive.length,total_chars:encoded.length,offset:q.p_offset,base64_chunk:encoded.slice(q.p_offset,next),next_offset:next<encoded.length?next:null});}
  if(String(url).endsWith('get_mother_shared_water_evidence_page'))return Response.json({contract:'mother-shared-water-evidence-page-v1',verification_run_id:identity.verification_run_id,after_sha256:null,next_after_sha256:null,complete:true,chunks:bundle.receipt.evidence_hashes.map(h=>{const b=bundle.blobs.get('sha256:'+h),encoded=b.toString('base64');assert(encoded.length<=131072);return {contract:'mother-shared-water-evidence-chunk-v1',verification_run_id:identity.verification_run_id,sha256:h,byte_length:b.length,total_chars:encoded.length,offset:0,base64_chunk:encoded,next_offset:null};})});
  const bytes=bundle.blobs.get('sha256:'+q.p_sha256);assert.ok(bytes);const encoded=bytes.toString('base64'),next=Math.min(q.p_offset+q.p_length,encoded.length);
  return Response.json({contract:'mother-shared-water-evidence-chunk-v1',verification_run_id:identity.verification_run_id,sha256:q.p_sha256,byte_length:bytes.length,total_chars:encoded.length,offset:q.p_offset,base64_chunk:encoded.slice(q.p_offset,next),next_offset:next<encoded.length?next:null});
 }};
 const fetched=await load(transport);
 const result=verifyLoaded(fetched,{nowMs:now+2,expected:{...identity,contract_version:'1.1.0',scope_definition_version:'full-priority-fixed-membership-v1',requested_symbols:['1216']}});
 assert.equal(result.water_gate_pass,!idle);assert.equal(result.formal_entry_authorization,false);assert.equal(fetched.water_gate_pass,false);
 if(idle)assert.ok(fetched.receipt.rows[0].reason_codes.includes('NO_NEW_TRADE_CONTINUITY_UNPROVEN'));
 if(archive){
  const expected={...identity,contract_version:'1.1.0',scope_definition_version:'full-priority-fixed-membership-v1',requested_symbols:['1216'],requested_symbols_sha256:bundle.receipt.requested_symbols_sha256,snapshot_symbols_sha256:bundle.receipt.snapshot_symbols_sha256,snapshot_bytes_sha256:bundle.receipt.snapshot_bytes_sha256};
  delete expected.verification_run_id;
  const verified=await require('../lib/mother-shared-water-consumer.cjs').readVerified({url:transport.url,key:transport.key,fetchImpl:transport.fetchImpl,now:()=>now+2,expected});
  assert.equal(verified.water_gate_pass,!idle);assert.equal(verified.membership_verified,true);assert.equal(verified.verification_run_id,identity.verification_run_id);assert.equal(verified.formal_entry_authorization,false);
  assert.equal(expected.verification_run_id,undefined);
 }
}
(async()=>{for(const page of [false,true]){await check(false,page);await check(true,page);}await check(false,false,true);await check(true,false,true);console.log(JSON.stringify({ok:true,cases:6,mode:'freeze_remote_transport_real_resolver_consumer_isolated',production_connected:false,natural_evidence:false}));})().catch(e=>{console.error(e);process.exitCode=1;});
