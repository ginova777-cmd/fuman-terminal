'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {readJson,writeJson}=require('./fugle-websocket-quotes');
const {createCandleStore}=require('./daytrade-candle-store');
const {createBridge,ns,boundedJson}=require('./mother-evidence-bridge.cjs');
const fs=require('node:fs'),path=require('node:path');
let evidence=null,initError=null,changes=[],sequence=null,proof=null,failed=false;
if(workerData.evidence)try{evidence=createBridge({...workerData.evidence,kind:'candle',onStatus:s=>parentPort.postMessage({type:'evidenceStatus',status:s})});}catch(e){initError=e.message;}
const store=createCandleStore({read:()=>readJson(workerData.file,{}),retentionMs:workerData.retentionMs,
 observe:(previous,merged,changed)=>{
  if(!evidence)return;
  if(evidence.status().state!=='RUNNING'){evidence.bypass(1);return;}
  if(!changed){evidence.observeDuplicate(previous?.candleSeenAt!==merged.candleSeenAt||previous?.updatedAt!==merged.updatedAt);return;}
  if(changes.length>=workerData.evidence.limits.maxBatchEvents){void evidence.stop('CANDLE_CAPTURE_LIMIT','BLOCKED');return;}
  changes.push({previous,merged});
 },
 write:(value,lookup)=>{
  let token=null,rowsJson=null;
  try{
   token=evidence?.begin(changes);
   if(token){const keys=new Set(changes.map(c=>`${c.merged.code||c.merged.symbol}|${c.merged.candleTime||c.merged.date||''}`));rowsJson=boundedJson([...keys].map(k=>lookup(k)).filter(Boolean),workerData.evidence.limits.maxBatchBytes);}
  }catch(e){void evidence?.stop('CAPTURE_FAILED:'+e.message,'BLOCKED');}
  const start=ns();
  try{writeJson(workerData.file,value,{compact:true});}catch(e){void evidence?.stop('ORIGINAL_CACHE_SAVE_FAILED','BLOCKED');throw e;}
  const end=ns();
  if(token&&rowsJson)proof={token,ok:true,original_ack:true,cache_file:workerData.file,cache_started_ns:start,cache_finished_ns:end,rows_json:rowsJson,spool_sequence:sequence};
 }
});
parentPort.on('message',message=>{
 if(message.type==='evidenceParentAck'){
  if(message.epoch===workerData.evidence?.epoch)evidence?.confirm(message.token,message.proof);
  else void evidence?.stop('PARENT_ACK_EPOCH_MISMATCH','BLOCKED');return;
 }
 if(message.type==='evidenceStop'){void evidence?.stop(message.reason||'OPERATOR_STOP');return;}
 if(failed)return;
 try{
  changes=[];proof=null;sequence=message.sequence;let rows=message.rows;
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
  const count=store.merge(rows);
  // Original ACK goes first. No evidence fsync/readback/parse/audit is awaited.
  parentPort.postMessage({sequence:message.sequence,ok:true,count});
  if(proof){const saved=proof;setImmediate(()=>parentPort.postMessage({type:'evidenceSaved',sequence:message.sequence,epoch:workerData.evidence.epoch,token:saved.token,proof:saved}));}
  else if(initError)parentPort.postMessage({type:'evidenceStatus',status:{state:'BLOCKED',reason:initError}});
 }catch{failed=true;parentPort.postMessage({sequence:message.sequence,ok:false});}
});
