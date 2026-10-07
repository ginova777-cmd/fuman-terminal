'use strict';
// Evidence-only worker: no network, subscriptions, DB, or Consumer imports.
const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs'),path=require('node:path');
let fsyncNs=0n,fsyncCount=0,logicalWriteBytes=0;
const originalFsync=fs.fsyncSync,originalWrite=fs.writeFileSync;
fs.fsyncSync=function(...args){const t=process.hrtime.bigint();try{return originalFsync.apply(fs,args);}finally{fsyncNs+=process.hrtime.bigint()-t;fsyncCount++;}};
fs.writeFileSync=function(file,data,...args){const result=originalWrite.call(fs,file,data,...args);logicalWriteBytes+=Buffer.byteLength(data);return result;};
const {createEvidence,sha}=require('./mother-change-evidence.cjs');
const {C2,validate}=require('./mother-evidence-intent.cjs');
let store,active=null,stopping=false,lastIntentSequence=0;
const started=process.hrtime.bigint(),cpuStart=process.cpuUsage(),threadStart=process.threadCpuUsage?.();
let ioNs=0n,ioCalls=0;
function io(fn){const t=process.hrtime.bigint();try{return fn();}finally{ioNs+=process.hrtime.bigint()-t;ioCalls++;}}
function metrics(){return {elapsed_ms:Number(process.hrtime.bigint()-started)/1e6,io_work_ms:Number(ioNs)/1e6,io_calls:ioCalls,fsync_count:fsyncCount,fsync_ms:Number(fsyncNs)/1e6,logical_write_bytes:logicalWriteBytes,physical_disk_io:'UNAVAILABLE',worker_heap_bytes:process.memoryUsage().heapUsed,process_rss_bytes:process.memoryUsage().rss,cpu_us_process:process.cpuUsage(cpuStart),worker_cpu_us:threadStart?process.threadCpuUsage(threadStart):null,cpu_scope:threadStart?'worker thread and process separately':'process only'};}
function block(error){stopping=true;parentPort.postMessage({type:'blocked',reason:error.message,metrics:metrics(),evidence:store?.status()});}
try{
 const recovery=require('./mother-evidence-recovery.cjs').verify(workerData.recovery,workerData);
 if(fs.existsSync(workerData.dir)&&fs.readdirSync(workerData.dir).length)throw Error('C2_REQUIRES_NEW_EPOCH_DIRECTORY');
 fs.mkdirSync(workerData.dir,{recursive:true});
 require('./mother-change-evidence.cjs').durable(path.join(workerData.dir,'recovery.json'),{contract:C2,evidence_state:'GAP/CONTINUITY_UNKNOWN',continuous:false,recovery_reference:workerData.recovery,recovery,phase2:'NOT_AUTHORIZED'});
 if(workerData.continuity){
  const previous=JSON.parse(fs.readFileSync(workerData.continuity.previous_stop_receipt,'utf8'));
  if(previous.contract!=='mother-evidence-stop-v1'||previous.epoch===workerData.epoch||previous.continuity_gap!==true||path.resolve(previous.evidence_dir)!==recovery.previous_dir)throw Error('CONTINUITY_REENABLE_INVALID');
  fs.mkdirSync(workerData.dir,{recursive:true});
  require('./mother-change-evidence.cjs').durable(path.join(workerData.dir,'continuity.json'),{mode:'NEW_EPOCH_AFTER_GAP',previous_stop_receipt:workerData.continuity.previous_stop_receipt,previous_stop_sha256:sha(previous),previous_epoch:previous.epoch,epoch:workerData.epoch,continuous:false});
 }
 store=createEvidence({...workerData,kind:workerData.kind,contract:C2});
 if(store.status().status==='BLOCKED')throw Error(store.status().reason);
 parentPort.postMessage({type:'ready',evidence:store.status()});
}catch(e){block(e);}
parentPort.on('message',async message=>{
 if(stopping)return;
 try{
  if(message.type==='prepare'){
   if(workerData.testOnly?.crashBeforePrepare)process.exit(71);
   if(active)throw Error('EVIDENCE_WORKER_SEQUENCE_BUSY');
   if(workerData.testOnly?.delayMs)await new Promise(r=>setTimeout(r,workerData.testOnly.delayMs));
   if(workerData.testOnly?.diskFailure)throw Error('ENOSPC_INJECTED');
   if(message.epoch!==workerData.epoch||sha(message.json)!==message.hash)throw Error('QUEUE_HASH_MISMATCH');
   const intent=validate(JSON.parse(message.json),{epoch:workerData.epoch,kind:workerData.kind,token:message.token});
   if(intent.intent_sequence!==lastIntentSequence+1)throw Error('INTENT_SEQUENCE_GAP');
   if(BigInt(intent.frozen_ns)>BigInt(message.enqueue_ns))throw Error('INTENT_ENQUEUE_ORDER_INVALID');
   const changes=intent.entries.map(e=>({previous:e.previous,merged:e.merged}));
   const batch=io(()=>store.prepare(changes,{token:message.token,enqueue_ns:message.enqueue_ns,intent,intent_sha256:sha(intent)}));
   if(!batch&&store.status().status==='BLOCKED')throw Error(store.status().reason);
   lastIntentSequence=intent.intent_sequence;
   active={token:message.token,batch,durableNs:process.hrtime.bigint().toString()};
   parentPort.postMessage({type:'prepared',token:message.token,sequence:batch?.sequence||null,evidence:store.status()});
  }else if(message.type==='confirm'){
   if(workerData.testOnly?.delayConfirmMs)await new Promise(r=>setTimeout(r,workerData.testOnly.delayConfirmMs));
   if(!active||message.token!==active.token)throw Error('CACHE_ACK_SEQUENCE_MISMATCH');
   if(workerData.recoverySourceCache&&path.resolve(message.proof.cache_file||'')!==path.resolve(workerData.recoverySourceCache))throw Error('CACHE_ACK_SOURCE_MISMATCH');
   let commit=null;
   if(active.batch){
    const ack=io(()=>store.persistedConfirmation(active.batch,message.proof,active.durableNs));
    if(!ack)throw Error(store.status().reason||'SAVE_CONFIRMATION_FAILED');
    commit=io(()=>store.commit(ack));if(!commit)throw Error(store.status().reason||'COMMIT_FAILED');
   }
   parentPort.postMessage({type:'done',token:active.token,commit,evidence:store.status(),metrics:metrics()});active=null;
  }
 }catch(e){block(e);}
});
// No unlink/GC on termination. owner.lock is recovery evidence, not auto-cleared.
