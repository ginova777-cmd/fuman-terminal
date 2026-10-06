'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {readJson,writeJson}=require('./fugle-websocket-quotes');
const {createCandleStore}=require('./daytrade-candle-store');
const fs=require('node:fs'),path=require('node:path');
let recentCache=null;
const store=createCandleStore({read:()=>readJson(workerData.file,{}),write:value=>{
 writeJson(workerData.file,value,{compact:true});
 if(process.env.FUMAN_SHARED_WATER_ACCEPTANCE==='1'){
  try{
   const recent=require('./daytrade-recent-candle-cache.cjs').buildRecent(value);
   writeJson(workerData.file+'.recent.json',recent,{compact:true});
   recentCache={status:'SAVED',updated_at:recent.updatedAt,count:recent.count,full_history_complete:false};
  }catch(error){recentCache={status:'BLOCKED',reason:error.message,full_history_complete:false};}
 }
},retentionMs:workerData.retentionMs});
let failed=false;
parentPort.on('message',message=>{
 if(failed)return;
 try{
  let rows=message.rows;
  if(message.spoolFiles){
   if(!workerData.spoolDir||!Array.isArray(message.spoolFiles)||!message.spoolFiles.length||message.spoolFiles.length>512)throw Error('INVALID_SPOOL_MESSAGE');
   rows=[];let size=0;
   for(const name of message.spoolFiles){
    if(!/^(\d{12})-(\d+)\.json$/.test(name))throw Error('INVALID_SPOOL_PATH');
    const file=path.join(workerData.spoolDir,name),stat=fs.lstatSync(file);size+=stat.size;
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>workerData.batchBytes+1024||size>16*1024*1024)throw Error('SPOOL_READ_LIMIT');
    const batch=JSON.parse(fs.readFileSync(file,'utf8')).rows;
    if(!Array.isArray(batch)||batch.length!==Number(name.match(/-(\d+)\.json$/)[1])||batch.length>workerData.batchRows||rows.length+batch.length>20000)throw Error('SPOOL_ROW_LIMIT');
    rows.push(...batch);
   }
  }
  const count=store.merge(rows);parentPort.postMessage({sequence:message.sequence,ok:true,count,recentCache});
 }
 catch{failed=true;parentPort.postMessage({sequence:message.sequence,ok:false});}
});
