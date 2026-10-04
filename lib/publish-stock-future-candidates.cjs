'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const runtime=require('./stock-future-standard-runtime.cjs');
async function publish({root,tradeDate,key,writerRunId,leaseValid,send,readback,writeJson,apply,now=()=>new Date().toISOString()}){
 if(!apply)return {status:'dry_run'};
 if(!leaseValid())throw Error('CANDIDATE_WRITER_LEASE_REQUIRED');
 const cursorFile=path.join(root,'state','stock-future-candidate-publication.json');
 let prior;try{prior=JSON.parse(fs.readFileSync(cursorFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const at=now();
 // Persist exact request bytes before sending. An aborted HTTP request may have
 // committed; the next scheduled round must read this revision before resending.
 const pendingFile=path.join(root,'state','stock-future-candidate-pending.json');
 let pending;try{pending=JSON.parse(fs.readFileSync(pendingFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(pending?.trade_date===tradeDate&&prior?.revision!==pending.revision){
  if(typeof readback!=='function')throw Error('CANDIDATE_READBACK_REQUIRED');
  if(crypto.createHash('sha256').update(JSON.stringify(pending.payload)).digest('hex')!==pending.revision||pending.payload.trade_date!==tradeDate||pending.payload.catalogue_run_id!==pending.catalogue_run_id)throw Error('CANDIDATE_PENDING_HASH_INVALID');
  const found=await readback(pending);
  if(found){
   if(found.revision!==pending.revision||found.catalogue_run_id!==pending.catalogue_run_id||found.trade_date!==tradeDate||found.counts?.candidates!==pending.payload.candidates.length)throw Error('CANDIDATE_READBACK_MISMATCH');
   writeJson(cursorFile,{fingerprint:pending.fingerprint,revision:pending.revision,trade_date:tradeDate,catalogue_run_id:pending.catalogue_run_id,counts:pending.payload.counts,published_at:found.published_at,failures:0,recovered_by_readback:true});
   // Keep the pending evidence; matching cursor makes subsequent rounds cheap.
   prior={fingerprint:pending.fingerprint,revision:pending.revision};
  }else{
   if(!leaseValid())throw Error('CANDIDATE_WRITER_LEASE_EXPIRED');
   const ack=await send({p_payload:pending.payload,p_revision:pending.revision,p_writer_run_id:pending.writer_run_id});
   if(ack?.status!=='PUBLISHED'||ack.revision!==pending.revision||ack.total_count!==pending.payload.candidates.length)throw Error('CANDIDATE_PUBLICATION_ACK_INVALID');
   writeJson(cursorFile,{fingerprint:pending.fingerprint,revision:pending.revision,trade_date:tradeDate,catalogue_run_id:pending.catalogue_run_id,counts:pending.payload.counts,published_at:ack.published_at,failures:0});
   return {status:'published_not_natural_verified',revision:pending.revision,counts:pending.payload.counts};
  }
 }
 if(prior?.next_retry_at&&Date.parse(prior.next_retry_at)>Date.parse(at))return {status:'backoff',next_retry_at:prior.next_retry_at};
 let snapshot;
 try{snapshot=await runtime.refresh({runtime:root,tradeDate,asOf:at,key});}
 catch(e){const failures=(prior?.failures||0)+1,delay=[60000,120000,240000,300000][Math.min(failures-1,3)],result={status:'source_blocked',failures,next_retry_at:new Date(Date.parse(at)+delay).toISOString(),reason:/^[A-Z0-9_:]+$/.test(e.message)?e.message:'CANDIDATE_SOURCE_FAILED'};writeJson(cursorFile,{...prior,...result});return result;}
 const output=runtime.resolve(snapshot,tradeDate,now());
 // Stable fingerprint prevents re-publication every minute. Time is retained in the first receipt.
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({catalogue:snapshot.source_hash,products:snapshot.standard_product_evidence.raw_sha256,resolutions:output.resolutions.map(({as_of,...r})=>r)})).digest('hex');
 if(prior?.fingerprint===fingerprint)return {status:'unchanged',revision:prior.revision,counts:output.counts};
 const revision=crypto.createHash('sha256').update(JSON.stringify(output)).digest('hex');
 if(!leaseValid())throw Error('CANDIDATE_WRITER_LEASE_EXPIRED');
 writeJson(pendingFile,{trade_date:tradeDate,catalogue_run_id:snapshot.run_id,fingerprint,revision,writer_run_id:writerRunId,payload:output});
 const result=await send({p_payload:output,p_revision:revision,p_writer_run_id:writerRunId});
 if(result?.status!=='PUBLISHED'||result.revision!==revision||result.total_count!==output.candidates.length)throw Error('CANDIDATE_PUBLICATION_ACK_INVALID');
 writeJson(cursorFile,{fingerprint,revision,trade_date:tradeDate,catalogue_run_id:snapshot.run_id,counts:output.counts,published_at:result.published_at,failures:0});
 return {status:'published_not_natural_verified',revision,counts:output.counts};
}
module.exports={publish};
