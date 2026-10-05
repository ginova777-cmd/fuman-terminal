'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const modules={side:'./provider-side-journal.cjs',trade:'./telegram-detectors/provider-trade-journal.cjs'};
if(!Object.hasOwn(modules,workerData.kind))throw Error('UNKNOWN_JOURNAL');
const journal=require(modules[workerData.kind]).createJournal(workerData.root);
let stored=0,failure=null;
parentPort.on('message',({id,rows})=>{
 for(const row of rows){
  try{
   const result=journal.capture(row.data,row.receivedAt);
   if(result===true||result?.stored===true)stored++;
   const state=journal.health();
   if(state.ok===false)failure=state.last_error?.code||state.error||'JOURNAL_WRITE_FAILED';
  }catch{failure='JOURNAL_CAPTURE_FAILED';}
 }
 parentPort.postMessage({id,stored,error:failure});
});
