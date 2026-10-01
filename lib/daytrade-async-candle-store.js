'use strict';
const {Worker}=require('node:worker_threads');
const path=require('node:path');
function createAsyncCandleStore({file,retentionMs,onStatus=()=>{},saveTimeoutMs=30000,setTimer=setTimeout,clearTimer=clearTimeout,flushDelayMs=0,setFlushTimer=setTimeout,clearFlushTimer=clearTimeout,maxPendingRows=20000,maxPendingBytes=16*1024*1024,spawn=options=>new Worker(path.join(__dirname,'daytrade-candle-save-worker.js'),options)}){
 let deadline=null,flushTimer=null,reason=null,worker=null,inflight=null,sequence=0,failed=false,timedOut=false,pendingBytes=0,savedCount=0;
 const pending=new Map();
 function status(){return {ok:!failed&&!timedOut,reason,persistenceGap:failed||timedOut,pendingRows:pending.size,pendingBytes,inflightRows:inflight?.rows.length||0,savedCount};}
 function fail(code){if(failed)return;failed=true;reason=code;clearTimer(deadline);clearFlushTimer(flushTimer);onStatus(status());worker?.unref?.();}
 function schedule(){if(failed||inflight||!pending.size||flushTimer!==null)return;if(flushDelayMs<=0){flush();return;}flushTimer=setFlushTimer(()=>{flushTimer=null;flush();},flushDelayMs);}
 function flush(){if(failed||inflight||!pending.size)return;
  const rows=[...pending.values()].map(x=>x.row);pending.clear();pendingBytes=0;
  inflight={sequence:++sequence,rows};
  // A deadline is an unknown outcome, not proof that subsequent events can be
  // discarded. Keep the bounded queue and accept only the exact late ACK.
  deadline=setTimer(()=>{timedOut=true;reason='CANDLE_SAVE_TIMEOUT';onStatus(status());},saveTimeoutMs);
  try{worker.postMessage(inflight);}catch{fail('CANDLE_SAVE_SEND_FAILED');}
 }
 function start(){if(worker)return;
  worker=spawn({workerData:{file,retentionMs}});
  worker.on('error',()=>fail('CANDLE_SAVE_WORKER_ERROR'));
  worker.on('exit',()=>fail('CANDLE_SAVE_WORKER_EXITED'));
  worker.on('message',message=>{
   if(failed)return;
   if(message.sequence!==inflight?.sequence){fail('CANDLE_SAVE_ACK_MISMATCH');return;}
   if(!message.ok){fail('CANDLE_SAVE_FAILED');return;}
   clearTimer(deadline);savedCount=message.count;inflight=null;
   if(!pending.size){timedOut=false;reason=null;}
   onStatus(status());schedule();
  });
 }
 return {merge(rows){
  if(failed)return status();
  for(const row of rows){
   const symbol=String(row.code||row.symbol||''),time=row.candleTime||row.date;
   if(!/^\d{4}$/.test(symbol)||!time){fail('INVALID_CANDLE_IDENTITY');return status();}
   const key=symbol+'|'+time,bytes=Buffer.byteLength(JSON.stringify(row));
   const nextBytes=pendingBytes-(pending.get(key)?.bytes||0)+bytes;
   if(nextBytes>maxPendingBytes||(!pending.has(key)&&pending.size>=maxPendingRows)){fail('CANDLE_SAVE_QUEUE_CAPACITY');return status();}
   pending.set(key,{row:structuredClone(row),bytes});pendingBytes=nextBytes;
  }
  if(pending.size){try{start();schedule();}catch{fail('CANDLE_SAVE_START_FAILED');}}
  return status();
 },status,stop(){clearTimer(deadline);clearFlushTimer(flushTimer);failed=true;return worker?.terminate();}};
}
module.exports={createAsyncCandleStore};
