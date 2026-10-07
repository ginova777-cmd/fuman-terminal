'use strict';
// Monitoring only. No Evidence authority, cache reads, DB or network.
const {Worker}=require('node:worker_threads'),path=require('node:path');
const CONTRACT='mother-shadow-parent-telemetry-v1';
const transport=new Set(['received_at','receivedAt','candleSeenAt','updatedAt','heartbeatAt','transportSeenAt']);
const quality=/source|synthetic|usable|available|unit|origin|websocket|restRepair|oddLot|quality|complete|finality/i;
function classify(a,b){
 if(!a||Object.keys(a).length===0)return 'INSERT';
 let nodes=0,chars=0;
 function stable(x,d=0){if(typeof x==='string'){chars+=x.length;if(x.length>65536||chars>131072)throw Error('CLASSIFICATION_BYTE_BOUND');}if(++nodes>4096||d>16)throw Error('CLASSIFICATION_BOUND');if(Array.isArray(x))return x.map(v=>stable(v,d+1));if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,stable(x[k],d+1)]));return x;}
 let changed=false,onlyQuality=true;
 for(const k of new Set([...Object.keys(a),...Object.keys(b)])){if(transport.has(k))continue;if(JSON.stringify(stable(a[k]))!==JSON.stringify(stable(b[k]))){changed=true;if(!quality.test(k))onlyQuality=false;}}
 return changed?(onlyQuality?'QUALITY_CHANGE':'REVISE'):'DUPLICATE';
}
function createCounts({budgetMs=2}={}){
 const c={rows_observed:0,rows_compared:0,changed_events_observed:0,duplicate_count:0,transport_only_count:0,quality_change_count:0,revise_count:0,insert_count:0,capture_completed:false,capture_stopped_at_ordinal:null,capture_stop_reason:null,unknown_remaining:true,observation_duration_ms:0};
 let stopped=false;
 function stop(reason,ordinal){if(stopped)return;stopped=true;c.capture_stop_reason=reason;c.capture_stopped_at_ordinal=ordinal;}
 return {observe(a,b,changed,ordinal,state){
   if(stopped)return;
   if(state&&state!=='RUNNING'&&state!=='OFF'){stop('EVIDENCE_'+state,ordinal);return;}
   if(c.observation_duration_ms>=budgetMs){stop('TELEMETRY_COUNT_BUDGET',ordinal);return;}
   const t=performance.now();c.rows_observed++;
   try{const op=changed?classify(a,b):'DUPLICATE';c.rows_compared++;if(op==='DUPLICATE'){c.duplicate_count++;if([...transport].some(k=>a?.[k]!==b?.[k]))c.transport_only_count++;}else{c.changed_events_observed++;c[op==='INSERT'?'insert_count':op==='REVISE'?'revise_count':'quality_change_count']++;}}
   catch(e){stop(e.message,ordinal);}finally{c.observation_duration_ms+=performance.now()-t;}
  },stop,finish(total,reason=null){if(reason)stop(reason,c.rows_observed);c.capture_completed=!stopped&&c.rows_compared===total;c.unknown_remaining=!c.capture_completed;return {...c};}};
}
function createSink(config){
 const maxRecords=256,maxBytes=1048576,maxRecordBytes=32768;
 let worker=null,ready=false,busy=null,queue=[],bytes=0,seq=0,written=0,gap=false,reason=null,dropped=0,closed=false,deadline=null;
 const status=()=>({contract:CONTRACT,monitor_gap:gap,reason,dropped_records:dropped,accepted_records:seq,written_records:written,queued_records:queue.length+(busy?1:0),queued_bytes:bytes,closed,durability:'OS_APPEND_NOT_FSYNC; crash tail may be lost'});
 function fail(why){gap=true;reason=reason||why;clearTimeout(deadline);queue=[];bytes=0;busy=null;try{worker?.terminate();}catch{}}
 function pump(){if(gap||closed||!ready||busy||!queue.length)return;busy=queue.shift();try{worker.postMessage(busy);deadline=setTimeout(()=>fail('MONITOR_APPEND_TIMEOUT'),2000);deadline.unref();}catch{fail('MONITOR_SEND_FAILED');}}
 try{worker=new Worker(path.join(__dirname,'mother-shadow-telemetry-worker.cjs'),{workerData:{file:config.file,maxFileBytes:config.maxFileBytes||16*1048576},resourceLimits:{maxOldGenerationSizeMb:32}});worker.unref();worker.on('message',m=>{if(m.ready){ready=true;pump();return;}if(m.error){fail(m.error);return;}if(!busy||m.seq!==busy.seq){fail('MONITOR_ACK_MISMATCH');return;}clearTimeout(deadline);bytes-=busy.bytes;busy=null;written++;pump();});worker.on('error',()=>fail('MONITOR_WORKER_ERROR'));worker.on('exit',()=>{if(!closed&&!gap)fail('MONITOR_WORKER_EXIT');});}catch{fail('MONITOR_START_FAILED');}
 const api={status,write(record){try{if(gap||closed){dropped++;return false;}const json=JSON.stringify({contract:CONTRACT,telemetry_sequence:seq+1,...record})+'\n',n=Buffer.byteLength(json);if(n>maxRecordBytes||queue.length+(busy?1:0)>=maxRecords||bytes+n>maxBytes){dropped++;fail('MONITOR_QUEUE_LIMIT');return false;}seq++;queue.push({seq,json,bytes:n});bytes+=n;pump();return true;}catch{dropped++;fail('MONITOR_SERIALIZATION_FAILED');return false;}},close:async()=>{if(closed)return status();if(!gap)api.write({event:'MONITOR_SESSION_END',finished_at:new Date().toISOString()});const end=Date.now()+2200;while(!gap&&(busy||queue.length)&&Date.now()<end)await new Promise(r=>setTimeout(r,5));if(busy||queue.length)fail('MONITOR_CLOSE_UNFLUSHED');closed=true;clearTimeout(deadline);await worker?.terminate();return status();},gap:fail};return api;
}
module.exports={CONTRACT,createCounts,createSink,classify};
