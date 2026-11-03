'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const modules={side:'./provider-side-journal.cjs',trade:'./telegram-detectors/provider-trade-journal.cjs'};
if(!Object.hasOwn(modules,workerData.kind))throw Error('UNKNOWN_JOURNAL');
let observer=null;
if(workerData.kind==='trade'&&workerData.segmentEvidence){try{observer=require('./trade-segment-worker-observer.cjs').create(workerData.segmentEvidence);}catch(e){observer={beginBatch(){},endBatch(){},health:()=>({status:'GAP',error:'SEGMENT_INITIALIZATION_FAILED',continuity_verified:false})};}}
const journal=require(modules[workerData.kind]).createJournal(workerData.root,observer);
let stored=0,failure=null;
parentPort.on('message',({id,rows})=>{
 observer?.beginBatch(id,rows);
 if(workerData.kind==='side'&&journal.captureBatch){
  try{const result=journal.captureBatch(rows);stored+=result.stored;if(result.error)failure=failure||result.error;}catch{failure='JOURNAL_CAPTURE_FAILED';}
 }else for(const row of rows){
  try{
   const result=journal.capture(row.data,row.receivedAt);
   if(result===true||result?.stored===true)stored++;
   const state=journal.health();
   if(state.ok===false)failure=state.last_error?.code||state.error||'JOURNAL_WRITE_FAILED';
  }catch{failure='JOURNAL_CAPTURE_FAILED';}
 }
 observer?.endBatch();
 const pause=workerData.segmentEvidence?.isolatedPauseAfterSeal;
 if(pause instanceof SharedArrayBuffer){const barrier=new Int32Array(pause);Atomics.store(barrier,0,1);Atomics.wait(barrier,1,0,5000);}
 parentPort.postMessage({id,stored,error:failure,segment_evidence:observer?.health()||null});
});
