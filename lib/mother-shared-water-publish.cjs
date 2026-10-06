'use strict';
const {createHash}=require('node:crypto');
const sha=b=>createHash('sha256').update(b).digest('hex');
// Transport injected by the existing Writer. No key lookup, retries, latest
// pointer updates, or deployment side effects occur in this module.
async function publish(bundle,{post,readReceipt,maxRequestBytes=4*1024*1024,now=Date.now,compressed=false}){
 const text=JSON.stringify(bundle.receipt),expected=sha(Buffer.from(text));
 const blobs=[...bundle.blobs.entries()].map(([ref,bytes])=>{
  const hash=sha(bytes);if(ref!=='sha256:'+hash)throw Error('LOCAL_BLOB_HASH_MISMATCH');return {sha256:hash,base64:bytes.toString('base64')};
 });
 if(JSON.stringify(blobs.map(b=>b.sha256).sort())!==JSON.stringify(bundle.receipt.evidence_hashes))throw Error('LOCAL_MANIFEST_MISMATCH');
 const archive=compressed?require('./mother-shared-water-archive.cjs').pack(bundle):null;
 const payload=archive?{p_receipt_text:text,p_archive_base64:archive.archive.toString('base64'),p_archive_sha256:archive.archive_sha256,p_archive_raw_bytes:archive.raw_bytes}:{p_receipt_text:text,p_blobs:blobs};if(Buffer.byteLength(JSON.stringify(payload))>maxRequestBytes)throw Error('PUBLICATION_REQUEST_LIMIT_NO_TRUNCATION');
 let originalError=null,ack=null;
 try{ack=await post(archive?'publish_mother_shared_water_archive':'publish_mother_shared_water_evidence',payload);}catch(e){originalError={name:e.name||'Error',code:e.code||null,transient:require('../scripts/writer-database-backoff.cjs').transient(String(e.message||e))};}
 // Always independently read the exact run. A lost POST reply is not proof
 // of failure and must not trigger a duplicate blind POST.
 let readback;try{readback=await readReceipt(bundle.receipt.verification_run_id);}catch(e){return {status:'UNKNOWN',original_error:originalError,transient_failure:originalError?.transient===true||require('../scripts/writer-database-backoff.cjs').transient(String(e.message||e)),readback_verified:false,retry_performed:false};}
 const verified=readback?.verification_run_id===bundle.receipt.verification_run_id&&readback?.receipt_sha256===expected&&typeof readback?.receipt_utf8==='string'&&sha(Buffer.from(readback.receipt_utf8))===expected&&(!archive||(readback.archive_sha256===archive.archive_sha256&&readback.archive_bytes===archive.archive.length&&readback.archive_raw_bytes===archive.raw_bytes));
 // Persistence and current usability are separate. A slow commit/readback can
 // consume the entire evidence lifetime; never renew it by changing timestamps.
 const checked=Date.parse(bundle.receipt.checked_at),until=Date.parse(bundle.receipt.valid_until),readAt=now();
 const current=Number.isFinite(checked)&&Number.isFinite(until)&&checked<=readAt&&readAt<until&&until>checked;
 return {status:verified?'COMMITTED':'MISMATCH',verification_run_id:bundle.receipt.verification_run_id,receipt_sha256:expected,original_error:originalError,ack_matched:ack?.receipt_sha256===expected,readback_verified:verified,retry_performed:false,readback_at:new Date(readAt).toISOString(),evidence_current:current,first_blocker:!verified?'PUBLICATION_READBACK_MISMATCH':!current?'PUBLICATION_EVIDENCE_EXPIRED_OR_TIME_INVALID':bundle.receipt.first_blocker||null,water_gate_pass:verified&&current&&bundle.receipt.water_gate_pass===true};
}
module.exports={publish};
