'use strict';
// Only evidence persistence moves off-thread. Receipt times are supplied by
// the Collector before enqueueing; queued records are never reported as stored.
const {Worker}=require('node:worker_threads');
function createJournal(root,{kind,maxBytes=8*1024*1024,maxRecords=10000,batchSize=256,flushMs=20}={}){
 if(!['side','trade'].includes(kind))throw Error('UNKNOWN_JOURNAL');
 const worker=new Worker(require.resolve('./provider-journal-worker.cjs'),{workerData:{root,kind}});
 let queue=[],inflight=null,bytes=0,records=0,sequence=0,timer=null,stored=0,error=null,closed=false,failed=false,rejected=0;
 const waiters=new Set();
 worker.unref();
 const finish=()=>{if(records===0||failed){for(const done of waiters)done();waiters.clear();}};
 function fail(code){error=error||code;failed=true;if(timer)clearTimeout(timer);timer=null;worker.unref();finish();}
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
  inflight=null;stored=ack.stored;
  if(ack.error)error=error||ack.error;
  if(queue.length)pump();else {worker.unref();finish();}
 });
 function health(){return {ok:!error&&!failed,contract:'provider_journal_background_v1',status:error||failed?'FAILED':records?'PENDING':'DRAINED',queued_records:records,queued_bytes:bytes,stored_records:stored,rejected_records:rejected,last_error:error?{code:error}:null,error};}
 return {
  capture(data,receivedAt=new Date().toISOString()){
   if(closed||failed){rejected++;return {stored:false,queued:false,reason:'JOURNAL_UNAVAILABLE'};}
   // Cheap filters avoid IPC for trial/heartbeat and non-stock messages.
   if(!data||data.isTrial===true||!/^\d{4}$/.test(String(data.symbol||'')))return {stored:false,queued:false,reason:'NOT_FORMAL_STOCK'};
   if(kind==='side'&&!data.total)return {stored:false,queued:false,reason:'MISSING_PROVIDER_TOTAL'};
   const row={data,receivedAt};let size;
   try{size=Buffer.byteLength(JSON.stringify(row));}catch{error=error||'JOURNAL_SERIALIZATION_FAILED';return {stored:false,queued:false,reason:error};}
   if(records>=maxRecords||bytes+size>maxBytes){rejected++;error=error||'JOURNAL_QUEUE_LIMIT';return {stored:false,queued:false,reason:'JOURNAL_QUEUE_LIMIT'};}
   // Structured clone is taken at enqueue time, so a caller cannot mutate evidence.
   queue.push({row:structuredClone(row),bytes:size});bytes+=size;records++;worker.ref();
   if(!timer&&!inflight)timer=setTimeout(pump,flushMs);
   return {stored:false,queued:true};
  },health,
  async drain(timeoutMs=12000){
   if(records&&!failed){pump();await new Promise((resolve,reject)=>{const done=()=>{clearTimeout(timeout);resolve();};const timeout=setTimeout(()=>{waiters.delete(done);reject(Error('JOURNAL_DRAIN_TIMEOUT'));},timeoutMs);waiters.add(done);});}
   return health();
  },
  async close(){try{return await this.drain();}finally{closed=true;if(timer)clearTimeout(timer);await worker.terminate();}}
 };
}
module.exports={createJournal};
