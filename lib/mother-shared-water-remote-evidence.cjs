'use strict';
// Exact-run anon transport only. Successful loading does not grant a water Gate.
// Callers must independently pin the receipt hash, then run the native verifier.
const {createHash}=require('node:crypto');
const hash=b=>createHash('sha256').update(b).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
async function load({url,key,runId,receiptSha256,expectedIdentity,fetchImpl=fetch,now=Date.now,timeoutMs=12000,deadlineMs=20000,maxRequests=2048,maxBundleBytes=8*1024*1024,batchSize=16,page=false,archive=false}){
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>16)throw Error('EVIDENCE_BATCH_LIMIT');
 if(typeof key!=='string'||!key)throw Error('ANON_KEY_MISSING');
 let role;try{role=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role;}catch{}
 if(role!=='anon')throw Error('ANON_JWT_REQUIRED');
 const base=new URL(url);if(base.protocol!=='https:'||base.username||base.password)throw Error('HTTPS_BASE_REQUIRED');
 const identityFields=['trade_date','canonical_run_id','mother_pool_run_id','writer_run_id','generation','snapshot_sequence','requested_symbols_sha256','snapshot_symbols_sha256','snapshot_bytes_sha256','contract_version','scope_definition_version','producer_version'];
 const expected=expectedIdentity===undefined?null:structuredClone(expectedIdentity);
 if(expected&&identityFields.some(f=>expected[f]===undefined||expected[f]===null||String(expected[f]).length===0))throw Error('EXPECTED_IDENTITY_INCOMPLETE');
 if(!expected&&(typeof runId!=='string'||!runId||runId.length>200||!hex(receiptSha256)))throw Error('PINNED_RECEIPT_REQUIRED');
 if(expected&&(runId!==undefined||receiptSha256!==undefined))throw Error('AMBIGUOUS_RECEIPT_SELECTION');
 const start=now(),end=start+deadlineMs;let requests=0,wireBytes=0,totalBytes=0;
 const wireLimit=20*1024*1024,blobs=new Map();
 async function rpc(name,body){
  if(++requests>maxRequests)throw Error('EVIDENCE_REQUEST_LIMIT');
  const remaining=Math.min(timeoutMs,end-now());if(remaining<=0)throw Error('EVIDENCE_DEADLINE');
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),remaining);
  try{
   const r=await fetchImpl(new URL('/rest/v1/rpc/'+name,base),{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:abort.signal,redirect:'error'});
   if(!r.ok)throw Error('EVIDENCE_HTTP_'+r.status);
   const chunks=[];let size=0;
   for await(const b of r.body){size+=b.length;wireBytes+=b.length;if(size>4*1024*1024||wireBytes>wireLimit)throw Error('EVIDENCE_WIRE_LIMIT');chunks.push(b);}
   if(now()>end)throw Error('EVIDENCE_DEADLINE');
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  }finally{clearTimeout(timer);}
 }
 if(expected){
  const pointer=await rpc('find_mother_shared_water_receipt',{p_expected:Object.fromEntries(identityFields.map(f=>[f,expected[f]]))});
  if(pointer.contract!=='mother-shared-water-pointer-v1'||typeof pointer.verification_run_id!=='string'||!pointer.verification_run_id||pointer.verification_run_id.length>200||!hex(pointer.receipt_sha256))throw Error('RECEIPT_POINTER_INVALID');
  if(pointer.evidence_current!==true||!(Date.parse(pointer.checked_at)<=now()&&now()<Date.parse(pointer.valid_until)))throw Error('RECEIPT_POINTER_EXPIRED');
  runId=pointer.verification_run_id;receiptSha256=pointer.receipt_sha256;
 }
 const envelope=await rpc('get_mother_shared_water_receipt',{p_verification_run_id:runId});
 if(envelope.contract!=='mother-shared-water-readback-v1'||envelope.verification_run_id!==runId||envelope.receipt_sha256!==receiptSha256||typeof envelope.receipt_utf8!=='string')throw Error('RECEIPT_ENVELOPE_MISMATCH');
 const receiptBytes=Buffer.from(envelope.receipt_utf8);
 if(receiptBytes.length>2*1024*1024||hash(receiptBytes)!==receiptSha256)throw Error('RECEIPT_HASH_MISMATCH');
 const receipt=JSON.parse(envelope.receipt_utf8),hashes=receipt.evidence_hashes;
 if(expected&&identityFields.some(f=>String(receipt[f])!==String(expected[f])))throw Error('DISCOVERED_RECEIPT_IDENTITY_MISMATCH');
 if(receipt.verification_run_id!==runId||receipt.contract!=='mother-pool-shared-water-acceptance-v1'||!Array.isArray(hashes)||hashes.length<1||hashes.length>8000||hashes.some(h=>!hex(h))||new Set(hashes).size!==hashes.length||JSON.stringify([...hashes].sort())!==JSON.stringify(hashes))throw Error('EVIDENCE_MANIFEST_INVALID');
 if(archive){
  const length=envelope.archive_bytes,total=4*Math.ceil(length/3);
  if(!hex(envelope.archive_sha256)||!Number.isSafeInteger(length)||length<1||length>3*1024*1024||!Number.isSafeInteger(envelope.archive_raw_bytes)||envelope.archive_raw_bytes<1||envelope.archive_raw_bytes>16*1024*1024)throw Error('ARCHIVE_METADATA_INVALID');
  let offset=0,encoded='';
  do{
   const c=await rpc('get_mother_shared_water_archive_chunk',{p_verification_run_id:runId,p_offset:offset,p_length:131072});
   const count=Math.min(131072,total-offset),next=offset+count;
   if(c.contract!=='mother-shared-water-archive-chunk-v1'||c.verification_run_id!==runId||c.archive_sha256!==envelope.archive_sha256||c.byte_length!==length||c.total_chars!==total||c.offset!==offset||typeof c.base64_chunk!=='string'||c.base64_chunk.length!==count||c.next_offset!==(next<total?next:null))throw Error('ARCHIVE_CHUNK_MISMATCH');
   encoded+=c.base64_chunk;offset=c.next_offset;
  }while(offset!==null);
  const bytes=Buffer.from(encoded,'base64');if(bytes.length!==length||bytes.toString('base64')!==encoded)throw Error('ARCHIVE_ENCODING_INVALID');
  const restored=require('./mother-shared-water-archive.cjs').unpack(bytes,{archiveSha256:envelope.archive_sha256,receiptSha256,runId});
  if(restored.raw_bytes!==envelope.archive_raw_bytes||restored.decoded_bytes>maxBundleBytes||!restored.receipt_bytes.equals(receiptBytes))throw Error('ARCHIVE_SIZE_OR_RECEIPT_MISMATCH');
  if(now()>end)throw Error('EVIDENCE_DEADLINE');
  return {receipt,receipt_bytes:Buffer.from(receiptBytes),resolve:restored.resolve,transport_complete:true,water_gate_pass:false,formal_entry_authorization:false,diagnostics:{run_id:runId,receipt_sha256:receiptSha256,evidence_count:restored.blobs.size,decoded_bytes:restored.decoded_bytes,archive_bytes:length,wire_bytes:wireBytes,requests,elapsed_ms:now()-start,retry_count:0,reader_role:'anon',encoding:'gzip'}};
 }
 // Serial requests cap load; endpoint throughput/TTL must be measured before
 // production enablement. No retries and no partial resolver escape on failure.
 const prefetched=new Map();
 for(let i=0;i<hashes.length;i++){
  const h=hashes[i];
  if(page&&!prefetched.has(h)){
   const after=i?hashes[i-1]:null;
   const result=await rpc('get_mother_shared_water_evidence_page',{p_verification_run_id:runId,p_after_sha256:after});
   const count=result.chunks?.length;
   if(result.contract!=='mother-shared-water-evidence-page-v1'||result.verification_run_id!==runId||result.after_sha256!==after||!Array.isArray(result.chunks)||count<1||count>256||i+count>hashes.length||JSON.stringify(result.chunks.map(c=>c.sha256))!==JSON.stringify(hashes.slice(i,i+count)))throw Error('EVIDENCE_PAGE_IDENTITY_INVALID');
   const complete=i+count===hashes.length;
   if(result.complete!==complete||result.next_after_sha256!==(complete?null:hashes[i+count-1]))throw Error('EVIDENCE_PAGE_CURSOR_INVALID');
   for(const c of result.chunks)prefetched.set(c.sha256,c);
  }else if(!page&&batchSize>1&&i%batchSize===0){
   const group=hashes.slice(i,i+batchSize);
   const batch=await rpc('get_mother_shared_water_evidence_batch',{p_verification_run_id:runId,p_requests:group.map(sha256=>({sha256,offset:0,length:131072}))});
   if(batch.contract!=='mother-shared-water-evidence-batch-v1'||batch.verification_run_id!==runId||!Array.isArray(batch.chunks)||batch.chunks.length!==group.length||new Set(batch.chunks.map(c=>c.sha256)).size!==group.length||batch.chunks.some(c=>!group.includes(c.sha256)))throw Error('EVIDENCE_BATCH_IDENTITY_INVALID');
   for(const c of batch.chunks)prefetched.set(c.sha256,c);
  }
  let offset=0,total=null,length=null,encoded='';
  do{
   const r=offset===0&&prefetched.has(h)?prefetched.get(h):await rpc('get_mother_shared_water_evidence_chunk',{p_verification_run_id:runId,p_sha256:h,p_offset:offset,p_length:131072});
   prefetched.delete(h);
   if(r.contract!=='mother-shared-water-evidence-chunk-v1'||r.verification_run_id!==runId||r.sha256!==h||r.offset!==offset||!Number.isSafeInteger(r.byte_length)||r.byte_length<0||r.byte_length>4*1024*1024||!Number.isSafeInteger(r.total_chars)||r.total_chars!==4*Math.ceil(r.byte_length/3)||typeof r.base64_chunk!=='string')throw Error('EVIDENCE_CHUNK_IDENTITY_INVALID');
   if(total===null){total=r.total_chars;length=r.byte_length;totalBytes+=length;if(totalBytes>maxBundleBytes)throw Error('EVIDENCE_BUNDLE_LIMIT');}
   if(total!==r.total_chars||length!==r.byte_length)throw Error('EVIDENCE_CHUNK_CHANGED');
   const expectedLength=Math.min(131072,total-offset),next=offset+expectedLength;
   if(r.base64_chunk.length!==expectedLength||r.next_offset!==(next<total?next:null))throw Error('EVIDENCE_CHUNK_RANGE_INVALID');
   encoded+=r.base64_chunk;offset=r.next_offset;
  }while(offset!==null);
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length!==length||bytes.toString('base64')!==encoded||hash(bytes)!==h)throw Error('EVIDENCE_HASH_MISMATCH');
  blobs.set('sha256:'+h,bytes);
 }
 // Return copies so a consumer cannot mutate a previously checked store.
 return {receipt,receipt_bytes:Buffer.from(receiptBytes),resolve:ref=>blobs.has(ref)?Buffer.from(blobs.get(ref)):undefined,transport_complete:true,water_gate_pass:false,formal_entry_authorization:false,diagnostics:{run_id:runId,receipt_sha256:receiptSha256,evidence_count:blobs.size,decoded_bytes:totalBytes,wire_bytes:wireBytes,requests,elapsed_ms:now()-start,retry_count:0,reader_role:'anon'}};
}
module.exports={load,loadPaged:options=>load({...options,page:true}),loadArchive:options=>load({...options,archive:true})};
