'use strict';
const {Worker}=require('node:worker_threads');
const path=require('node:path');
function createAsyncCandleStore({file,retentionMs,onStatus=()=>{},saveTimeoutMs=30000,setTimer=setTimeout,clearTimer=clearTimeout,maxPendingRows=20000,maxPendingBytes=16*1024*1024,spawn=options=>new Worker(path.join(__dirname,'daytrade-candle-save-worker.js'),options)}){
 let deadline=null,reason=null,worker=null,inflight=null,sequence=0,failed=false,pendingBytes=0,savedCount=0;
 const pending=new Map();
 function status(){return {ok:!failed,reason,persistenceGap:failed,pendingRows:pending.size,pendingBytes,inflightRows:inflight?.rows.length||0,savedCount};}
 function fail(code){if(failed)return;failed=true;reason=code;clearTimer(deadline);onStatus(status());worker?.unref?.();}
 function flush(){if(failed||inflight||!pending.size)return;
  const rows=[...pending.values()].map(x=>x.row);pending.clear();pendingBytes=0;
  inflight={sequence:++sequence,rows};
  deadline=setTimer(()=>fail('CANDLE_SAVE_TIMEOUT'),saveTimeoutMs);
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
   clearTimer(deadline);savedCount=message.count;inflight=null;onStatus(status());flush();
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
  if(pending.size){try{start();flush();}catch{fail('CANDLE_SAVE_START_FAILED');}}
  return status();
 },status,stop(){clearTimer(deadline);failed=true;return worker?.terminate();}};
}
module.exports={createAsyncCandleStore};
