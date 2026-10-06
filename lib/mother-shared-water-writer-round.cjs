'use strict';
const fs=require('node:fs'),path=require('node:path');
const {freeze}=require('./mother-shared-water-freeze.cjs');
const {publish}=require('./mother-shared-water-publish.cjs');
const {createReadback}=require('./mother-shared-water-anon-readback.cjs');
// Writer identity is stable across incremental publications. Each frozen proof
// needs its own immutable ID; publish() reuses it for the exact-run readback.
function createVerificationRunId(writerRunId){
 if(typeof writerRunId!=='string'||!writerRunId.trim())throw Error('WRITER_RUN_ID_REQUIRED');
 return 'shared-water:'+require('node:crypto').createHash('sha256').update(writerRunId).digest('hex')+':'+require('node:crypto').randomUUID();
}
async function waitForCapture({read,after,connectionId,requestId,scopeHash,deadline,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const threshold=after===undefined?null:Date.parse(after);if(after!==undefined&&!Number.isFinite(threshold))throw Error('CAPTURE_REQUEST_TIME_INVALID');
 for(;;){
  if(now()>=deadline)throw Error('CAPTURE_FRESH_WAIT_TIMEOUT');
  const value=await read();
  if(value===null){await sleep(Math.min(250,Math.max(0,deadline-now())));continue;}
  if(value.contract!=='mother-shared-water-capture-v1'||value.stored!==true||value.closed||!value.authenticated)throw Error('CAPTURE_NOT_ACTIVE');
  if(connectionId&&value.connection_id!==connectionId)throw Error('CAPTURE_CONNECTION_CHANGED');
  const captured=Date.parse(value.captured_at);if(!Number.isFinite(captured)||captured>now())throw Error('CAPTURE_TIME_INVALID');
  if((threshold===null||captured>threshold)&&(!requestId||value.request_id===requestId)){
   if(scopeHash&&value.requested_symbols_sha256!==scopeHash)throw Error('CAPTURE_SCOPE_MISMATCH');return value;
  }
  await sleep(Math.min(250,Math.max(0,deadline-now())));
 }
}
// Optional existing-Writer stage. Deployment/cadence approval is required before
// FUMAN_SHARED_WATER_ACCEPTANCE=1. Failure never grants trading permission.
async function capture({runtimeRoot,prioritySymbols,deadline,after=new Date().toISOString(),connectionId=null}){
 const capturePath=path.join(runtimeRoot,'state','mother-shared-water-capture-latest.json');
 const requestModule=require('./mother-shared-water-capture-request.cjs'),selection=requestModule.scope(prioritySymbols);
 const requestId=await requestModule.request(path.join(runtimeRoot,'state','mother-shared-water-capture-request.json'),{after,connectionId,symbols:selection.requested_symbols,deadline});
 let cached=null,stamp=null;
 return waitForCapture({after,connectionId,requestId,scopeHash:selection.requested_symbols_sha256,deadline,read:async()=>{let stat;try{stat=fs.statSync(capturePath);}catch(e){if(e.code==='ENOENT')return null;throw e;}if(stat.size>5*1024*1024)throw Error('CAPTURE_FILE_LIMIT');const version=stat.mtimeMs+':'+stat.size;if(version!==stamp){cached=JSON.parse(fs.readFileSync(capturePath,'utf8'));stamp=version;}return cached;}});
}
async function run({runtimeRoot,writerIdentity,prioritySymbols,producerVersion,writeCompletedAt,initialCapture,writtenSymbols,quoteAcknowledgements=[],url,anonKey,post,assertPublicationContext}){
 const deadline=Date.now()+30000;
 const remaining=()=>{const ms=Math.min(8000,deadline-Date.now());if(ms<=0)throw Error('SHARED_WATER_STAGE_DEADLINE');return ms;};
 if(!/^[a-f0-9]{40}$/.test(producerVersion||''))throw Error('PRODUCER_SHA_INVALID');
 if(!Number.isFinite(Date.parse(writeCompletedAt))&&!quoteAcknowledgements.length)throw Error('QUOTE_WRITE_COMPLETION_MISSING');
 if(!initialCapture||!Number.isFinite(Date.parse(initialCapture.captured_at))||Date.parse(initialCapture.captured_at)>Date.now()||(Number.isFinite(Date.parse(writeCompletedAt))&&Date.parse(initialCapture.captured_at)>Date.parse(writeCompletedAt)))throw Error('PRE_WRITE_CAPTURE_REQUIRED');
 if(!Array.isArray(writtenSymbols)||(!writtenSymbols.length&&!quoteAcknowledgements.length)||new Set(writtenSymbols).size!==writtenSymbols.length||writtenSymbols.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s)))throw Error('QUOTE_WRITE_SET_INVALID');
 if(initialCapture.requested_symbols_sha256!==require('./mother-shared-water-capture-request.cjs').scope(prioritySymbols).requested_symbols_sha256)throw Error('PRE_WRITE_CAPTURE_SCOPE_MISMATCH');
 const snapshotPath=path.join(runtimeRoot,'state','daytrade-mother-pool-snapshot-latest.json');
 const snapshotBytes=fs.readFileSync(snapshotPath),snapshot=JSON.parse(snapshotBytes.toString('utf8'));
 if(snapshot.complete!==true||snapshot.status!=='complete'||snapshot.trade_date!==writerIdentity.trade_date||snapshot.canonical_run_id!==writerIdentity.canonical_run_id)throw Error('SNAPSHOT_NOT_SAME_WRITER_DATE');
 const identity={...writerIdentity,producer_version:producerVersion,mother_pool_run_id:snapshot.mother_pool_run_id,generation:snapshot.generation,snapshot_sequence:snapshot.snapshot_sequence,verification_run_id:createVerificationRunId(writerIdentity.writer_run_id)};
 const readCapture=async options=>!options?initialCapture:capture({runtimeRoot,prioritySymbols,deadline:Math.min(deadline-8000,Date.now()+20000),...options});
 const bundle=await freeze({identity,prioritySymbols,snapshotBytes,readCapture,readback:createReadback({url,key:anonKey,deadlineMs:deadline}),writeCompletedAt,writtenSymbols,quoteAcknowledgements});
 if(!snapshotBytes.equals(fs.readFileSync(snapshotPath)))throw Error('SNAPSHOT_CHANGED_BEFORE_PUBLICATION');
 if(assertPublicationContext&&await assertPublicationContext()!==true)throw Error('PUBLISHED_CONTEXT_UNVERIFIED');
 const localArchive=require('./mother-shared-water-local-archive.cjs').save(bundle,{directory:path.join(runtimeRoot,'data','mother-pool','shared-water-evidence')});
 const result=await publish(bundle,{compressed:true,post:(name,body)=>post(name,body,{timeoutMs:remaining()}),readReceipt:async runId=>{
  const response=await fetch(new URL('/rest/v1/rpc/get_mother_shared_water_receipt',url),{method:'POST',headers:{apikey:anonKey,Authorization:'Bearer '+anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_verification_run_id:runId}),signal:AbortSignal.timeout(remaining())});
  if(!response.ok)throw Error('RECEIPT_READBACK_HTTP_'+response.status);
  const chunks=[];let size=0;for await(const c of response.body){size+=c.length;if(size>4*1024*1024)throw Error('RECEIPT_READBACK_LIMIT');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }});
 if(result.status==='UNKNOWN'&&result.transient_failure===true)throw Error('SHARED_WATER_PUBLICATION_OUTCOME_UNKNOWN_TRANSIENT');
 return {local_archive:localArchive,contract:bundle.receipt.contract,contract_version:bundle.receipt.contract_version,scope_definition_version:bundle.receipt.scope_definition_version,verification_run_id:identity.verification_run_id,generation:identity.generation,requested_symbols_sha256:bundle.receipt.requested_symbols_sha256,snapshot_symbols_sha256:bundle.receipt.snapshot_symbols_sha256,checked_at:bundle.receipt.checked_at,valid_until:bundle.receipt.valid_until,receipt_sha256:result.receipt_sha256||null,publication_status:result.status,water_gate_pass:result.water_gate_pass===true,readback_verified:result.readback_verified===true,first_blocker:result.status==='COMMITTED'?(result.first_blocker||bundle.receipt.first_blocker):'SHARED_WATER_PUBLICATION_'+result.status,requested_count:bundle.receipt.requested_count,water_available_count:bundle.receipt.water_available_count,unknown_count:bundle.receipt.unknown_count,other_strategy_gates_verified:false,formal_entry_authorization:false};
}
module.exports={run,waitForCapture,capture,createVerificationRunId};
