'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {Worker} = require('node:worker_threads');
const FILE = /^(\d{12})-(\d+)\.json$/;

// Single Collector owns this directory. Only an exact successful worker ACK
// removes batches; an interrupted save can therefore replay the same revisions.
function createSpooledCandleStore({file, retentionMs, onStatus=()=>{},
  spoolDir=file+'.pending', batchRows=5000, batchBytes=4*1024*1024,
  maxSpoolBytes=256*1024*1024, maxSpoolFiles=512, flushDelayMs=5000,
  saveTimeoutMs=30000, spawn=options=>new Worker(path.join(__dirname,'daytrade-candle-save-worker.js'),options)}) {
  const pending=new Map(), queue=[];
  let bytes=0, diskBytes=0, sequence=0, worker=null, inflight=null;
  let flushTimer=null, deadline=null, failed=false, stopped=false, timedOut=false, reason=null, savedCount=0, timeoutBarrier=null;
  function status(){return {ok:!failed&&!timedOut,reason,persistenceGap:failed||timedOut,
    pendingRows:pending.size,pendingBytes:bytes,inflightRows:inflight?.rows||0,savedCount,
    queuedRows:queue.reduce((n,x)=>n+x.rows,0),queuedFiles:queue.length,spoolBytes:diskBytes,
    oldestQueuedAt:queue[0]?.at||null,timeoutBarrier,spoolDir};}
  function notify(){onStatus(status());}
  function fail(code){failed=true;reason=code;clearTimeout(flushTimer);clearTimeout(deadline);notify();worker?.unref?.();}
  function initialize(){
    fs.mkdirSync(spoolDir,{recursive:true});
    const names=fs.readdirSync(spoolDir);
    if(names.some(n=>n.endsWith('.tmp'))) throw Error('CANDLE_SPOOL_INCOMPLETE_FILE');
    for(const name of names.filter(n=>FILE.test(n)).sort()){
      const match=name.match(FILE),full=path.join(spoolDir,name),stat=fs.lstatSync(full);
      if(!stat.isFile()||stat.isSymbolicLink())throw Error('CANDLE_SPOOL_INVALID_FILE');
      const rows=Number(match[2]);
      if(rows<1||rows>batchRows||stat.size>batchBytes+1024)throw Error('CANDLE_SPOOL_INVALID_BATCH');
      queue.push({name,rows,bytes:stat.size,at:stat.mtime.toISOString()});
      diskBytes+=stat.size;sequence=Math.max(sequence,Number(match[1]));
    }
    if(queue.length>maxSpoolFiles||diskBytes>maxSpoolBytes)throw Error('CANDLE_SPOOL_CAPACITY');
  }
  function start(){
    if(worker)return;
    worker=spawn({workerData:{file,retentionMs,spoolDir,batchRows,batchBytes}});
    worker.on('error',()=>{if(!stopped)fail('CANDLE_SAVE_WORKER_ERROR');});
    worker.on('exit',()=>{if(!stopped)fail('CANDLE_SAVE_WORKER_EXITED');});
    worker.on('message',message=>{
      if(failed||stopped)return;
      if(!inflight||message.sequence!==inflight.sequence){fail('CANDLE_SAVE_ACK_MISMATCH');return;}
      if(!message.ok){fail('CANDLE_SAVE_FAILED');return;}
      clearTimeout(deadline);
      try {
        for(const batch of inflight.batches){fs.unlinkSync(path.join(spoolDir,batch.name));diskBytes-=batch.bytes;queue.shift();}
      } catch(_){fail('CANDLE_SPOOL_ACK_CLEANUP_FAILED');return;}
      savedCount=message.count;inflight=null;
      // Rows received after the timeout are normal pending work. Clear only
      // after every batch present at the deadline has an exact successful ACK.
      if(timedOut&&message.sequence>=timeoutBarrier){timedOut=false;reason=null;timeoutBarrier=null;}
      notify();dispatch();
    });
  }
  function dispatch(){
    if(failed||stopped||inflight||!queue.length)return;
    try {
      start();
      const batches=[];let rows=0,size=0;
      for(const batch of queue){
        if(batches.length&&(rows+batch.rows>20000||size+batch.bytes>16*1024*1024))break;
        batches.push(batch);rows+=batch.rows;size+=batch.bytes;
      }
      inflight={sequence:Number(batches[batches.length-1].name.match(FILE)[1]),batches,rows};
      deadline=setTimeout(()=>{
        timedOut=true;reason='CANDLE_SAVE_TIMEOUT';
        seal(); // Include the buffered rows received before this deadline.
        timeoutBarrier=sequence;notify();
      },saveTimeoutMs);
      worker.postMessage({sequence:inflight.sequence,spoolFiles:batches.map(x=>x.name)});
    }catch(_){fail('CANDLE_SAVE_SEND_FAILED');}
  }
  function seal(){
    if(!pending.size||failed||stopped)return;
    clearTimeout(flushTimer);flushTimer=null;
    const body=JSON.stringify({rows:[...pending.values()].map(x=>x.row)});
    const size=Buffer.byteLength(body);
    if(queue.length>=maxSpoolFiles||diskBytes+size>maxSpoolBytes){fail('CANDLE_SPOOL_CAPACITY');return;}
    const name=String(++sequence).padStart(12,'0')+'-'+pending.size+'.json';
    const full=path.join(spoolDir,name),temp=full+'.tmp';let fd;
    try {
      fd=fs.openSync(temp,'wx');fs.writeFileSync(fd,body);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      fs.renameSync(temp,full);
    }catch(_){if(fd!==undefined)fs.closeSync(fd);fail('CANDLE_SPOOL_WRITE_FAILED');return;}
    queue.push({name,rows:pending.size,bytes:size,at:new Date().toISOString()});diskBytes+=size;
    pending.clear();bytes=0;dispatch();
  }
  try{initialize();dispatch();}catch(error){fail(error.message);}
  return {merge(rows){
    if(failed||stopped)return status();
    for(const row of rows){
      const symbol=String(row.code||row.symbol||''),time=row.candleTime||row.date;
      if(!/^\d{4}$/.test(symbol)||!time){fail('INVALID_CANDLE_IDENTITY');break;}
      const key=symbol+'|'+time,size=Buffer.byteLength(JSON.stringify(row))+1;
      if(size>batchBytes){fail('CANDLE_SPOOL_ROW_TOO_LARGE');break;}
      if(pending.size>=batchRows||bytes-(pending.get(key)?.bytes||0)+size>batchBytes){seal();if(failed)break;}
      bytes-=pending.get(key)?.bytes||0;
      pending.set(key,{row:structuredClone(row),bytes:size});bytes+=size;
      if(pending.size>=batchRows||bytes>=batchBytes){seal();if(failed)break;}
    }
    if(pending.size&&!failed&&flushTimer===null)flushTimer=setTimeout(seal,flushDelayMs);
    return status();
  },status,flush:seal,stop(){
    if(!failed)seal();stopped=true;clearTimeout(flushTimer);clearTimeout(deadline);
    return worker?.terminate();
  }};
}
module.exports={createSpooledCandleStore};
