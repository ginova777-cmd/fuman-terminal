'use strict';
const {Worker}=require('node:worker_threads');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {sha}=require('./mother-change-evidence.cjs');
const {capture}=require('./mother-evidence-intent.cjs');
const ns=()=>process.hrtime.bigint().toString();
// Reject oversized/nested inputs before serialization; work is bounded by limits.
function boundedJson(value,limit){
 let remaining=limit,nodes=0;const seen=new Set();
 function visit(v,depth){
  if(depth>24||++nodes>limit/2)throw Error('EVIDENCE_OBJECT_LIMIT');
  if(typeof v==='string'){remaining-=v.length*6+2;}
  else if(v&&typeof v==='object'){
   if(seen.has(v))throw Error('EVIDENCE_CYCLE');seen.add(v);
   for(const k of Object.keys(v)){remaining-=k.length*6+4;if(remaining<0)throw Error('EVIDENCE_BYTE_LIMIT');visit(v[k],depth+1);}seen.delete(v);
  }else remaining-=32;
  if(remaining<0)throw Error('EVIDENCE_BYTE_LIMIT');
 }visit(value,0);const json=JSON.stringify(value);if(Buffer.byteLength(json)>limit)throw Error('EVIDENCE_BYTE_LIMIT');return json;
}
function createBridge(config){
 const {dir,kind,epoch,producerVersion,limits,controlFile=null,onStatus=()=>{}}=config;
 if(!limits||!['maxEvents','maxBytes','maxBatchEvents','maxBatchBytes','maxAgeMs','minFreeBytes','maxDiskBytes'].every(k=>Number.isFinite(limits[k])&&limits[k]>0))throw Error('EXPLICIT_EVIDENCE_LIMITS_REQUIRED');
 let state='RUNNING',reason=null,ready=false,worker=null,busy=false,active=null,queue=[],queuedBytes=0,queuedEvents=0,next=0;
 let produced=0,committed=0,failed=0,bypassed=0,lastSuccess=null,lastError=null,lastEvidence=null,lastMetrics=null,stopPromise=null,receiptPath=null,receiptError=null,receiptSaved=false;
 let duplicates=0,transportOnly=0;
 const startedAt=new Date().toISOString();
 function status(){return {state,reason,epoch,kind,ready,prepared_token:active?.prepared?active.token:null,queued_event_count:queuedEvents,queue_count_scope:'bounded observed pairs awaiting classification',queued_bytes:queuedBytes,oldest_queued_age_ms:queue[0]?Date.now()-queue[0].at:0,observed_pair_count:produced,produced_count:lastEvidence?.event_count||0,duplicate_count:duplicates+(lastEvidence?.duplicate_replay_count||0),transport_only_count:transportOnly+(lastEvidence?.transport_only_count||0),committed_count:committed,failed_count:failed,dropped_count:0,bypassed_count:bypassed,worker_busy:busy,worker_last_success:lastSuccess,worker_last_error:lastError,evidence:lastEvidence,worker_metrics:lastMetrics,stop_receipt:receiptPath,stop_receipt_saved:receiptSaved,stop_receipt_error:receiptError,collector_restart_requested:false,contract:'mother-change-evidence-v2-c2',intent_state:'PRE_CACHE_INTENT_VOLATILE',commit_state:'DURABLE_COMMITTED',continuity:'GAP/CONTINUITY_UNKNOWN',continuous:false,recovery_required:state!=='RUNNING'||!ready,lost_intent_count:null,started_at:startedAt};}
 function report(){try{onStatus(status());}catch{}}
 async function persistStop(receipt,items){
  const target=dir+'.stops';await fs.promises.mkdir(target,{recursive:true});
  const file=path.join(target,epoch+'-'+crypto.randomUUID()+'.json');
  const temp=file+'.tmp',h=await fs.promises.open(temp,'wx');
  try{await h.writeFile(JSON.stringify({...receipt,pending:items}));await h.sync();}finally{await h.close();}
  await fs.promises.rename(temp,file);return file;
 }
 function stop(why='OPERATOR_STOP',terminal='BYPASSED'){
  if(stopPromise)return stopPromise;
  state='STOPPING';reason=why;lastError=terminal==='BYPASSED'?lastError:why;if(terminal!=='BYPASSED')failed++;
  clearInterval(timer);report();
  const receipt={contract:'mother-evidence-stop-v1',reason:why,requested_at:new Date().toISOString(),epoch,kind,evidence_dir:dir,sequence:lastEvidence?.latest_committed_sequence||0,last_success:lastSuccess,backlog:{events:queuedEvents,bytes:queuedBytes},uncompleted_tokens:queue.map(q=>q.token),bypassed_count:bypassed,dropped_count:0,continuity_gap:true,evidence_state:'GAP/CONTINUITY_UNKNOWN',lost_intent_count:null,full_cache_recovery_required:true,collector_continues:true};
  // Stop only this dedicated evidence worker. No Collector/WS process controls.
  stopPromise=(async()=>{
   if(worker)try{await worker.terminate();}catch(e){receipt.worker_stop_error=e.message;}
   busy=false;
   try{receiptPath=await persistStop(receipt,queue.map(q=>({token:q.token,at:q.at,json:q.json,hash:q.hash,proof:q.proof||null})));receiptSaved=true;state=terminal;}
   catch(e){receiptError=e.code||e.message;state='FAILED';lastError='STOP_RECEIPT_NOT_DURABLE';}
   report();return status();
  })();return stopPromise;
 }
 function dispatch(){
  if(state!=='RUNNING'||!ready||busy||!queue.length)return;
  active=queue[0];busy=true;
  try{worker.postMessage({type:'prepare',epoch,token:active.token,json:active.json,hash:active.hash,enqueue_ns:active.enqueueNs});}
  catch(e){void stop('EVIDENCE_SEND_FAILED','FAILED');}
 }
 function sendConfirm(){if(active?.prepared&&active.proof&&!active.confirmSent&&state==='RUNNING'){active.confirmSent=true;worker.postMessage({type:'confirm',token:active.token,proof:active.proof});}}
 let polling=false;
 const timer=setInterval(async()=>{
  if(state!=='RUNNING'||polling)return;polling=true;
  try{
   if(queue[0]&&Date.now()-queue[0].at>limits.maxAgeMs){void stop('EVIDENCE_BACKLOG_AGE','BLOCKED');return;}
   if(controlFile){
    let data;try{const stat=await fs.promises.stat(controlFile);if(stat.size>4096)throw Error('CONTROL_SIZE');data=JSON.parse(await fs.promises.readFile(controlFile,'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
    if(data.command==='STOP'&&(data.epoch===epoch||data.epoch==='*'))void stop('OPERATOR_STOP');
   }
  }catch(e){void stop('CONTROL_INVALID:'+e.message,'BLOCKED');}finally{polling=false;}
 },Math.min(250,limits.maxAgeMs));timer.unref();
 try{
  worker=new Worker(path.join(__dirname,'mother-evidence-worker.cjs'),{workerData:{dir,kind,epoch,producerVersion,minFreeBytes:limits.minFreeBytes,maxBytes:limits.maxDiskBytes,testOnly:config.testOnly,continuity:config.continuity,recovery:config.recovery,recoverySourceCache:config.recoverySourceCache},resourceLimits:{maxOldGenerationSizeMb:128}});
  worker.on('message',m=>{
   if(state!=='RUNNING')return;
   if(m.evidence)lastEvidence=m.evidence;if(m.metrics)lastMetrics=m.metrics;
   if(m.type==='ready'){ready=true;dispatch();}
   else if(m.type==='blocked'){lastError=m.reason;void stop(m.reason,'BLOCKED');}
   else if(m.type==='prepared'){
    if(!active||m.token!==active.token){void stop('WORKER_SEQUENCE_MISMATCH','BLOCKED');return;}active.prepared=true;sendConfirm();
   }else if(m.type==='done'){
    if(!active||m.token!==active.token){void stop('WORKER_SEQUENCE_MISMATCH','BLOCKED');return;}
    committed+=m.commit?.events||0;lastSuccess=new Date().toISOString();const item=queue.shift();queuedEvents-=item.count;queuedBytes-=item.bytes;active=null;busy=false;dispatch();
   }report();
  });
  worker.on('error',e=>{lastError=e.message;if(state==='RUNNING')void stop('EVIDENCE_WORKER_ERROR','FAILED');});
  worker.on('exit',code=>{if(state==='RUNNING')void stop('EVIDENCE_WORKER_EXIT:'+code,'FAILED');});
 }catch(e){void stop('EVIDENCE_WORKER_START_FAILED','FAILED');}
 return {status,stop,bypass(count){bypassed+=count;},observeDuplicate(transportChanged){duplicates++;if(transportChanged)transportOnly++;},
  begin(changes){
   produced+=changes.length;
   if(state!=='RUNNING'){bypassed+=changes.length;return null;}
   if(!changes.length)return null;
   if(changes.length>limits.maxBatchEvents||queuedEvents+changes.length>limits.maxEvents){bypassed+=changes.length;void stop('EVIDENCE_QUEUE_COUNT','BLOCKED');return null;}
   try{
    const token=epoch+':'+(++next);
    const json=capture(boundedJson(changes,limits.maxBatchBytes),{epoch,kind,producerVersion,token,sequence:next}),bytes=Buffer.byteLength(json);
    if(bytes>limits.maxBatchBytes)throw Error('EVIDENCE_BYTE_LIMIT');
    if(queuedBytes+bytes>limits.maxBytes){bypassed+=changes.length;void stop('EVIDENCE_QUEUE_BYTES','BLOCKED');return null;}
    queue.push({token,json,hash:sha(json),bytes,count:changes.length,at:Date.now(),enqueueNs:ns()});queuedEvents+=changes.length;queuedBytes+=bytes;dispatch();return token;
   }catch(e){bypassed+=changes.length;void stop(e.message,'BLOCKED');return null;}
  },
  confirm(token,proof){
   if(!token||state!=='RUNNING')return;
   const item=queue.find(q=>q.token===token);
   if(!item){void stop('UNKNOWN_CACHE_ACK','BLOCKED');return;}
   if(proof.ok!==true){void stop('ORIGINAL_CACHE_SAVE_FAILED','BLOCKED');return;}
   const proofBytes=typeof proof.rows_json==='string'?Buffer.byteLength(proof.rows_json):Infinity;
   if(proofBytes>limits.maxBatchBytes||queuedBytes+proofBytes>limits.maxBytes){void stop('ACK_QUEUE_BYTES','BLOCKED');return;}
   if(item.proof){void stop('DUPLICATE_CACHE_ACK','BLOCKED');return;}
   item.bytes+=proofBytes;queuedBytes+=proofBytes;
   item.proof={...proof,token,collector_epoch:epoch};
   if(item===active)try{sendConfirm();}catch{void stop('ACK_SEND_FAILED','FAILED');}
  },
  // No automatic re-enable. New bridge requires a new approved epoch/directory
  // and an explicit continuity receipt; the old owner/pending files remain.
 };
}
function resumeBridge(previous,config){
 const prior=previous.status();
 if(!['BYPASSED','BLOCKED','FAILED'].includes(prior.state)||!prior.stop_receipt_saved||prior.epoch===config.epoch||prior.kind!==config.kind)throw Error('REENABLE_REQUIRES_DURABLE_GAP_RECEIPT_AND_NEW_EPOCH');
 if(!config.recovery)throw Error('FULL_CACHE_RECOVERY_REQUIRED');
 return createBridge({...config,continuity:{previous_stop_receipt:prior.stop_receipt}});
}
module.exports={createBridge,resumeBridge,boundedJson,ns};
