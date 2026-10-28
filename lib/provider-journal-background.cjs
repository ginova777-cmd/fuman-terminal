'use strict';
// Only evidence persistence moves off-thread. Receipt times are supplied by
// the Collector before enqueueing; queued records are never reported as stored.
const {Worker}=require('node:worker_threads');
function createJournal(root,{kind,maxBytes=8*1024*1024,maxRecords=10000,batchSize=256,flushMs=20,segmentEvidence=null}={}){
 if(!['side','trade'].includes(kind))throw Error('UNKNOWN_JOURNAL');
 const worker=new Worker(require.resolve('./provider-journal-worker.cjs'),{workerData:{root,kind,segmentEvidence}});
 const gapRecorder=require('./trade-gap-recorder.cjs').create(segmentEvidence);
 let queue=[],inflight=null,bytes=0,records=0,sequence=0,timer=null,stored=0,error=null,closed=false,failed=false,rejected=0;
 let segmentHealth=null; const waiters=new Set();
 const sideLast=new Map();let duplicates=0;
 worker.unref();
 const finish=()=>{if(records===0||failed){for(const done of waiters)done();waiters.clear();}};
 function fail(code){error=error||code;failed=true;if(segmentEvidence){gapRecorder.record(code);for(const item of [...(inflight?.items||[]),...queue])gapRecorder.record('UNACKNOWLEDGED_AFTER_FAILURE',item.row.data,item.row.receivedAt);}if(timer)clearTimeout(timer);timer=null;worker.unref();finish();}
 function pump(){
  if(timer)clearTimeout(timer);timer=null;if(failed||inflight||!queue.length)return;
  const items=queue.splice(0,batchSize);inflight={id:++sequence,items};
  try{worker.postMessage({id:sequence,rows:items.map(x=>x.row)});}catch{fail('JOURNAL_WORKER_SEND_FAILED');}
 }
 worker.on('error',()=>fail('JOURNAL_WORKER_FAILED'));
 worker.on('exit',()=>{if(!closed)fail('JOURNAL_WORKER_EXITED');});
 worker.on('message',ack=>{
  if(!inflight||ack.id!==inflight.id){fail('JOURNAL_ACK_MISMATCH');return;}
  for(const item of inflight.items){bytes-=item.bytes;records--;}
  inflight=null;stored=ack.stored;segmentHealth=ack.segment_evidence;
  if(ack.error)error=error||ack.error;
  if(queue.length)pump();else {worker.unref();finish();}
 });
 function health(){return {gap_evidence:gapRecorder.health(),segment_evidence:segmentHealth,ok:!error&&!failed,contract:'provider_journal_background_v1',status:error||failed?'FAILED':records?'PENDING':'DRAINED',duplicate_records:duplicates,queued_records:records,queued_bytes:bytes,stored_records:stored,rejected_records:rejected,last_error:error?{code:error}:null,error};}
 return {
  capture(data,receivedAt=new Date().toISOString()){
   if(closed||failed){rejected++;gapRecorder.record('JOURNAL_UNAVAILABLE',data,receivedAt);return {stored:false,queued:false,reason:'JOURNAL_UNAVAILABLE'};}
   // Cheap filters avoid IPC for trial/heartbeat and non-stock messages.
   if(!data||data.isTrial===true||!/^\d{4}$/.test(String(data.symbol||'')))return {stored:false,queued:false,reason:'NOT_FORMAL_STOCK'};
   if(kind==='side'&&!data.total)return {stored:false,queued:false,reason:'MISSING_PROVIDER_TOTAL'};
   let sideKey=null,sideIdentity=null;
   if(kind==='side'){
    const t=data.total,received=Date.parse(receivedAt),event=t.time/1000;
    if(['tradeVolume','tradeVolumeAtBid','tradeVolumeAtAsk'].every(k=>typeof t[k]==='number'&&Number.isFinite(t[k])&&t[k]>=0)
      &&t.tradeVolumeAtBid+t.tradeVolumeAtAsk<=t.tradeVolume&&Number.isSafeInteger(t.time)&&t.time>=1e15
      &&Number.isFinite(received)&&event<=received){
     const local=new Date(event+28800000).toISOString();
     if(local.slice(0,10)===data.date&&local.slice(11,16)>='09:00'&&local.slice(11,16)<='13:30'){
      data={symbol:data.symbol,date:data.date,total:{time:t.time,tradeVolume:t.tradeVolume,tradeVolumeAtBid:t.tradeVolumeAtBid,tradeVolumeAtAsk:t.tradeVolumeAtAsk}};
      sideKey=data.date+':'+data.symbol;sideIdentity=JSON.stringify(data);
      if(sideLast.get(sideKey)===sideIdentity){duplicates++;return {stored:false,queued:false,reason:'DUPLICATE'};}
     }
    }
   }
   const row={data,receivedAt};let size;
   try{size=Buffer.byteLength(JSON.stringify(row));}catch{error=error||'JOURNAL_SERIALIZATION_FAILED';return {stored:false,queued:false,reason:error};}
   if(records>=maxRecords||bytes+size>maxBytes){rejected++;error=error||'JOURNAL_QUEUE_LIMIT';gapRecorder.record('JOURNAL_QUEUE_LIMIT',data,receivedAt);return {stored:false,queued:false,reason:'JOURNAL_QUEUE_LIMIT'};}
   // Structured clone is taken at enqueue time, so a caller cannot mutate evidence.
   queue.push({row:structuredClone(row),bytes:size});bytes+=size;records++;worker.ref();
   // Never cache rejected records. A retry after a full queue must still enqueue.
   if(sideKey){if(sideLast.size>=10000&&!sideLast.has(sideKey))sideLast.delete(sideLast.keys().next().value);sideLast.set(sideKey,sideIdentity);}
   if(!timer&&!inflight)timer=setTimeout(pump,flushMs);
   return {stored:false,queued:true};
  },health,
  async drain(timeoutMs=12000){
   if(records&&!failed){pump();await new Promise((resolve,reject)=>{const done=()=>{clearTimeout(timeout);resolve();};const timeout=setTimeout(()=>{waiters.delete(done);reject(Error('JOURNAL_DRAIN_TIMEOUT'));},timeoutMs);waiters.add(done);});}
   await gapRecorder.flush();return health();
  },
  async abortIsolatedWorker(){if(!segmentEvidence)throw Error('ISOLATED_EVIDENCE_REQUIRED');fail('WORKER_FORCED_TERMINATION');await worker.terminate();await gapRecorder.flush();return health();},
  async close(){try{return await this.drain();}finally{closed=true;if(timer)clearTimeout(timer);await worker.terminate();await gapRecorder.flush();}}
 };
}
module.exports={createJournal};
