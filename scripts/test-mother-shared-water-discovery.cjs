'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {load}=require('../lib/mother-shared-water-remote-evidence.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected={trade_date:'2026-10-06',canonical_run_id:'c',mother_pool_run_id:'m',writer_run_id:'w',generation:'g',snapshot_sequence:1,requested_symbols_sha256:sha('p'),snapshot_symbols_sha256:sha('s'),snapshot_bytes_sha256:sha('b'),contract_version:'1.1.0',scope_definition_version:'full-priority-fixed-membership-v1',producer_version:'a'.repeat(40)};
function setup({expired=false,wrongIdentity=false}={}){
 const bytes=Buffer.from('isolated evidence'),h=sha(bytes),receipt={...expected,generation:wrongIdentity?'wrong':'g',contract:'mother-pool-shared-water-acceptance-v1',verification_run_id:'proof-1',evidence_hashes:[h]},text=JSON.stringify(receipt);let calls=0;
 return {calls:()=>calls,options:{url:'https://example.invalid',key:'x.'+Buffer.from('{"role":"anon"}').toString('base64url')+'.x',batchSize:1,expectedIdentity:expected,now:()=>1000,fetchImpl:async(url,options)=>{
  calls++;let r;
  if(String(url).endsWith('find_mother_shared_water_receipt')){assert.deepEqual(JSON.parse(options.body).p_expected,expected);r={contract:'mother-shared-water-pointer-v1',verification_run_id:'proof-1',receipt_sha256:sha(text),checked_at:new Date(0).toISOString(),valid_until:new Date(expired?500:30000).toISOString(),evidence_current:!expired};}
  else if(String(url).endsWith('get_mother_shared_water_receipt'))r={contract:'mother-shared-water-readback-v1',verification_run_id:'proof-1',receipt_sha256:sha(text),receipt_utf8:text};
  else r={contract:'mother-shared-water-evidence-chunk-v1',verification_run_id:'proof-1',sha256:h,byte_length:bytes.length,total_chars:bytes.toString('base64').length,offset:0,base64_chunk:bytes.toString('base64'),next_offset:null};
  return new Response(JSON.stringify(r));
 }}};
}
(async()=>{
 const ok=setup();assert.equal((await load(ok.options)).transport_complete,true);assert.equal(ok.calls(),3);
 const expired=setup({expired:true});await assert.rejects(()=>load(expired.options),/POINTER_EXPIRED/);assert.equal(expired.calls(),1);
 const wrong=setup({wrongIdentity:true});await assert.rejects(()=>load(wrong.options),/IDENTITY_MISMATCH/);assert.equal(wrong.calls(),2);
 await assert.rejects(()=>load({...setup().options,expectedIdentity:{trade_date:'2026-10-06'}}),/IDENTITY_INCOMPLETE/);
 await assert.rejects(()=>load({...setup().options,runId:'other'}),/AMBIGUOUS/);
 console.log(JSON.stringify({ok:true,cases:5,mode:'isolated_discovery',deployed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
