'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {readJson,writeJson}=require('./fugle-websocket-quotes');
const {createCandleStore}=require('./daytrade-candle-store');
const {createParentBridge}=require('./mother-evidence-parent.cjs');
const ns=()=>process.hrtime.bigint().toString();
const fs=require('node:fs'),path=require('node:path');
let evidence=null,initError=null,sequence=null,proof=null,failed=false;
const {createCounts}=require('./mother-shadow-telemetry.cjs');
let telemetry=null,counts=null,ordinal=0;
const pendingTelemetry=new Map();
function emitTelemetry(record){try{parentPort.postMessage({type:'shadowTelemetry',record});}catch{}}
function evidenceStatus(s){
 try{const done=s.last_receipt?.parent_id;if(done&&pendingTelemetry.has(done)){emitTelemetry({...pendingTelemetry.get(done),event:'EVIDENCE_TERMINAL',evidence_terminal_status:'PARENT_COMPLETE',finished_at:new Date().toISOString(),block_gap_reason:null});pendingTelemetry.delete(done);}
 if(s.state!=='RUNNING'){for(const r of pendingTelemetry.values())emitTelemetry({...r,event:'EVIDENCE_TERMINAL',evidence_terminal_status:s.state,evidence_continuity:'GAP/CONTINUITY_UNKNOWN',finished_at:new Date().toISOString(),block_gap_reason:s.reason});pendingTelemetry.clear();}}catch{}
 parentPort.postMessage({type:'evidenceStatus',status:s});
}
function finishTelemetry(ok){if(!telemetry)return;try{
 const state=evidence?.status();const partial=initError||(state&&state.state!=='RUNNING'?state.reason:null);
 const record={...telemetry,...counts.finish(telemetry.row_count,partial),event:'SAVE_RESULT',finished_at:new Date().toISOString(),save_ok:ok,evidence_mode:!workerData.evidence?'OFF':state?.state==='RUNNING'?'ON':state?.state==='BYPASSED'?'BYPASSED':'BLOCKED',evidence_capture_duration_ms:telemetry.evidence_capture_duration_ms,evidence_terminal_status:!ok?'FAILED':!workerData.evidence?'OFF':partial?(state?.state||'BLOCKED'):proof?'PENDING_COMMIT':'ZERO_CHANGE',evidence_continuity:partial||!ok?'GAP/CONTINUITY_UNKNOWN':'NO_CONTINUITY_CLAIM',block_gap_reason:!ok?'ORIGINAL_SAVE_FAILED':partial||initError||null,evidence_parent_id:proof?.token||null};
 if(proof&&record.evidence_terminal_status==='PENDING_COMMIT'){if(pendingTelemetry.size<2)pendingTelemetry.set(proof.token,{parent_id:record.parent_id,epoch:record.epoch});else emitTelemetry({event:'MONITOR_GAP',parent_id:record.parent_id,reason:'TERMINAL_TRACKING_LIMIT'});}
 emitTelemetry(record);
 }catch{emitTelemetry({event:'MONITOR_GAP',parent_id:telemetry.parent_id,reason:'RESULT_FAILED'});}finally{telemetry=null;counts=null;}}

if(workerData.evidence)try{evidence=createParentBridge({...workerData.evidence,kind:'candle',onStatus:evidenceStatus});}catch(e){initError=e.message;}
const store=createCandleStore({read:()=>readJson(workerData.file,{}),retentionMs:workerData.retentionMs,
 observe:(previous,merged,changed,serialized)=>{
  if(counts){try{counts.observe(previous,merged,changed,ordinal,evidence?.status().state||(!workerData.evidence?'OFF':'BLOCKED'));}catch{counts.stop('TELEMETRY_OBSERVER_FAILED',ordinal);}ordinal++;}
  if(!evidence)return;
  if(evidence.status().state!=='RUNNING'){evidence.bypass(1);return;}
  const observedAt=telemetry?performance.now():0;
  try{if(!changed){evidence.observe(previous,merged,false);return;}evidence.observe(previous,merged,true,serialized);}
  finally{if(telemetry)telemetry.evidence_capture_duration_ms+=performance.now()-observedAt;}
 },
 write:(value,lookup)=>{
  let token=null;
  const sealAt=telemetry&&evidence?performance.now():0;
  try{token=evidence?.seal(lookup);}catch(e){void evidence?.stop('CAPTURE_FAILED:'+e.message);}
  if(telemetry&&evidence)telemetry.evidence_capture_duration_ms+=performance.now()-sealAt;
  const start=ns();if(telemetry)telemetry.cache_write_started_at=new Date().toISOString();
  try{writeJson(workerData.file,value,{compact:true});}catch(e){void evidence?.stop('ORIGINAL_CACHE_SAVE_FAILED','BLOCKED');throw e;}
  const end=ns();if(telemetry){telemetry.cache_write_finished_at=new Date().toISOString();telemetry.cache_write_duration_ms=Number(BigInt(end)-BigInt(start))/1e6;}
  if(token)proof={token,ok:true,original_ack:true,cache_file:workerData.file,cache_started_ns:start,cache_finished_ns:end,spool_sequence:sequence};
 }
});
parentPort.on('message',message=>{
 if(message.type==='evidenceParentAck'){
  if(message.epoch===workerData.evidence?.epoch)evidence?.confirm(message.token,message.proof);
  else void evidence?.stop('PARENT_ACK_EPOCH_MISMATCH','BLOCKED');return;
 }
 if(message.type==='evidenceStop'){void evidence?.stop(message.reason||'OPERATOR_STOP');return;}
 if(failed){if(message.shadowTelemetry)emitTelemetry({...message.shadowTelemetry,event:'SAVE_RESULT',save_ok:false,evidence_terminal_status:'FAILED',block_gap_reason:'SAVE_WORKER_ALREADY_FAILED',capture_completed:false,unknown_remaining:true,finished_at:new Date().toISOString()});return;}
 if(message.shadowTelemetry){telemetry={...message.shadowTelemetry,cache_write_started_at:null,cache_write_finished_at:null,cache_write_duration_ms:null,evidence_capture_duration_ms:0};counts=createCounts();ordinal=0;}
 try{
  proof=null;sequence=message.sequence;evidence?.startParent(sequence);let rows=message.rows;
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
  if(telemetry){telemetry.row_count=rows.length;telemetry.rows=rows.length;}
  const count=store.merge(rows);
  // Original ACK goes first. No evidence fsync/readback/parse/audit is awaited.
  parentPort.postMessage({sequence:message.sequence,ok:true,count,...(proof?{evidence_token:proof.token}:{})});
  finishTelemetry(true);
  if(!proof)evidence?.discardUnwrittenParent();
  if(proof){const saved=proof;setImmediate(()=>parentPort.postMessage({type:'evidenceSaved',sequence:message.sequence,epoch:workerData.evidence.epoch,token:saved.token,proof:saved}));}
  else if(initError)parentPort.postMessage({type:'evidenceStatus',status:{state:'BLOCKED',reason:initError}});
 }catch{failed=true;parentPort.postMessage({sequence:message.sequence,ok:false});finishTelemetry(false);}
});
