'use strict';
// Volatile capture only; all durable I/O is delegated. Consumers never import this.
const {Worker}=require('node:worker_threads'),path=require('node:path'),crypto=require('node:crypto');
const CONTRACT='mother-change-evidence-v3-c2-capacity';
const ns=()=>process.hrtime.bigint().toString();
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const DEFAULTS=Object.freeze({maxParents:2,maxParentBytes:32*1048576,maxParentEvents:20000,maxEntryBytes:1048576,maxCaptureMs:20});
function freeze(value,limit){let bytes=0,nodes=0;const depths=new WeakMap();const json=JSON.stringify(value,function(k,v){const d=(depths.get(this)||0)+1;if(d>32||++nodes>20000)throw Error('PARENT_OBJECT_LIMIT');bytes+=k.length*6+4;if(v&&typeof v==='object')depths.set(v,d);else bytes+=typeof v==='string'?v.length*6+2:32;if(bytes>limit)throw Error('PARENT_BYTE_LIMIT');return v;});if(Buffer.byteLength(json)>limit)throw Error('PARENT_BYTE_LIMIT');return json;}
// Only the owning candle store supplies its already-produced immutable comparison
// strings. The two excluded transport fields are frozen separately, never read later.
function fromComparison(content,row,limit){if(content===null&&!row)return null;if(typeof content!=='string'||!content.startsWith('{')||!content.endsWith('}'))throw Error('PARENT_SERIALIZED_INVALID');const size=Buffer.byteLength(content);if(size>limit)throw Error('PARENT_SERIALIZED_INVALID');const fields={candleSeenAt:row.candleSeenAt,updatedAt:row.updatedAt};const simple=Object.values(fields).every(v=>v===undefined||v===null||typeof v==='number'||typeof v==='string'&&v.length<256);const transport=simple?JSON.stringify(fields):freeze(fields,limit);return transport==='{}'?{json:content,bytes:size}:{json:content.slice(0,-1)+(content==='{}'?'':',')+transport.slice(1),bytes:size+Buffer.byteLength(transport)-2+(content==='{}'?0:1)};}
function createParentBridge(config){
 const cap={...DEFAULTS,...config.capacity},limits=config.limits;
 for(const [k,v]of Object.entries(cap))if(!Number.isFinite(v)||v<=0||v>DEFAULTS[k])throw Error('PARENT_LIMIT_INVALID');
 if(!limits||!['maxBatchEvents','maxBatchBytes','maxEvents','maxBytes','maxAgeMs','minFreeBytes','maxDiskBytes'].every(k=>Number.isFinite(limits[k])&&limits[k]>0)||limits.maxBatchEvents<1||limits.maxBatchEvents>128||limits.maxBatchBytes<1024||limits.maxBatchBytes>524288||limits.maxEvents<1||limits.maxBytes<1024||limits.maxAgeMs<1)throw Error('EXPLICIT_EVIDENCE_LIMITS_REQUIRED');
 let state='RUNNING',reason=null,ready=false,building=null,ordinal=0,parents=[],bytes=0,busy=false,worker,stopPromise,committed=0,completed=0,duplicates=0,transport=0,metrics=null,lastReceipt=null,lastDone=null,capturePeak=0,lastCapture=0,peakBytes=0;
 const status=()=>({contract:CONTRACT,state,reason,ready,epoch:config.epoch,capture_peak_ms:capturePeak,last_capture_ms:lastCapture,peak_parent_bytes:peakBytes,queued_parent_count:parents.length+(building?1:0),parent_bytes:bytes,queued_event_count:parents.reduce((n,p)=>n+p.entries.length-p.sent,0)+(building?.entries.length||0),inflight_bytes:busy?.bytes||0,inflight_events:busy?.count||0,committed_count:committed,completed_parents:completed,duplicate_count:duplicates,transport_only_count:transport,oldest_queued_age_ms:parents[0]?Date.now()-parents[0].at:0,continuous:false,continuity:'GAP/CONTINUITY_UNKNOWN',recovery_required:state!=='RUNNING'||!ready,collector_restart_requested:false,worker_metrics:metrics,last_receipt:lastReceipt});
 const report=()=>{try{config.onStatus?.(status());}catch{}};
 function stop(why='OPERATOR_STOP'){
  if(stopPromise)return stopPromise;state=why==='OPERATOR_STOP'?'BYPASSED':'BLOCKED';reason=why;clearInterval(timer);building=null;report();
  stopPromise=(async()=>{try{await worker?.terminate();}catch{}// Stop receipt in a separate bounded worker, never synchronous disk I/O here.
   const receipt={contract:CONTRACT,status:'PARENT_GAP',epoch:config.epoch,reason:why,continuous:false,full_cache_recovery_required:true,parents:parents.map(p=>({parent_id:p.id,expected_sub_batches:p.parts.length,completed_sub_batches:p.part,observed:p.entries.length})),unknown_lost_intents:true};
   await new Promise(resolve=>{let w;try{w=new Worker(path.join(__dirname,'mother-evidence-parent-worker.cjs'),{workerData:{stopOnly:true,dir:config.dir,receipt},resourceLimits:{maxOldGenerationSizeMb:128}});}catch(e){lastReceipt={stop_receipt_error:e.message};resolve();return;}const deadline=setTimeout(()=>{lastReceipt={stop_receipt_error:'STOP_RECEIPT_TIMEOUT'};void w.terminate();},5000);w.on('message',m=>{lastReceipt=m;});w.on('error',e=>{lastReceipt={stop_receipt_error:e.message};});w.on('exit',()=>{clearTimeout(deadline);resolve();});});if(lastReceipt?.stop_receipt_error)state='FAILED';parents=[];bytes=0;busy=false;report();return status();})();return stopPromise;
 }
 function pump(){
  if(state!=='RUNNING'||!ready||busy||!parents.length||!parents[0].proof||!parents[0].root)return;
  const p=parents[0],part=p.parts[p.part],entries=p.entries.slice(part.start,part.end).map(e=>({json:e.json,final_json:p.final.get(e.key)}));
  const message={type:'sub',contract:CONTRACT,epoch:config.epoch,parent_id:p.id,original_sequence:p.sequence,frozen_ns:p.frozen,sub_index:p.part,sub_count:p.parts.length,total_entries:p.entries.length,root_hash:p.root,entries,proof:p.proof,duplicate_count:p.duplicates,transport_only_count:p.transport};
  const json=JSON.stringify(message),size=Buffer.byteLength(json);if(size>limits.maxBatchBytes||size*2>limits.maxBytes||entries.length>limits.maxEvents){void stop('SUB_ENVELOPE_LIMIT');return;}
  busy={bytes:size*2,count:entries.length};try{worker.postMessage({json,sha256:hash(json)});}catch(e){void stop('PARENT_SEND_FAILED');}report();
 }
 function seal(lookup){
  const p=building;building=null;if(!p||state!=='RUNNING')return null;const sealStarted=performance.now();
  try{
   p.final=new Map();const lastEntries=new Map();for(const e of p.entries){p.final.set(e.key,e.merged);lastEntries.set(e.key,e);}
   if(lookup)for(const [k,e]of lastEntries){const row=lookup(k);if(!row||(e.sourceRef?row!==e.sourceRef:JSON.stringify(row)!==e.merged))throw Error('PARENT_FINAL_CACHE_MISMATCH');}
   for(const e of p.entries)delete e.sourceRef;
   p.frozen=ns();p.parts=[];let start=0,size=8192;for(let i=0;i<p.entries.length;i++){const e=p.entries[i];const n=2*(e.jsonBytes+lastEntries.get(e.key).mergedBytes)+64;if(n+8192>limits.maxBatchBytes)throw Error('SUB_ENTRY_LIMIT');if(i-start>=limits.maxBatchEvents||size+n>limits.maxBatchBytes){p.parts.push({start,end:i});start=i;size=8192;}size+=n;}p.parts.push({start,end:p.entries.length});p.part=0;p.sent=0;p.at=Date.now();
   // No payload hash or durable I/O before the original cache save.
   p.captureMs+=performance.now()-sealStarted;lastCapture=p.captureMs;capturePeak=Math.max(capturePeak,p.captureMs);if(p.captureMs>cap.maxCaptureMs)throw Error('PARENT_CAPTURE_TIME_LIMIT');parents.push(p);report();return p.id;
  }catch(e){void stop(e.message);return null;}
 }
 const workerConfig={...config};delete workerConfig.onStatus;
 worker=new Worker(path.join(__dirname,'mother-evidence-parent-worker.cjs'),{workerData:workerConfig,resourceLimits:{maxOldGenerationSizeMb:128}});
 worker.on('message',m=>{if(state!=='RUNNING')return;if(m.type==='ready'){ready=true;pump();}else if(m.type==='blocked'){void stop(m.reason);}else if(m.type==='done'){if(lastDone&&lastDone.parent_id===m.parent_id&&lastDone.sub_index===m.sub_index)return;const p=parents[0];if(!busy||!p||m.parent_id!==p.id||m.sub_index!==p.part){void stop('PARENT_SEQUENCE_MISMATCH');return;}committed+=m.events;metrics=m.metrics;lastDone=m;p.sent=p.parts[p.part].end;p.part++;busy=false;if(p.part===p.parts.length){completed++;lastReceipt=m.receipt;bytes-=p.bytes;parents.shift();}pump();}report();});
 worker.on('error',e=>{if(state==='RUNNING')void stop('PARENT_WORKER_ERROR:'+e.code);});worker.on('exit',code=>{if(state==='RUNNING')void stop('PARENT_WORKER_EXIT:'+code);});
 let polling=false;const timer=setInterval(async()=>{if(state!=='RUNNING'||polling)return;polling=true;try{if(parents[0]&&Date.now()-parents[0].at>limits.maxAgeMs)void stop('PARENT_BACKLOG_AGE');if(config.controlFile){const fs=require('node:fs/promises');try{const s=await fs.stat(config.controlFile);if(s.size>4096)throw Error('CONTROL_SIZE');const c=JSON.parse(await fs.readFile(config.controlFile,'utf8'));if(c.command==='STOP'&&(c.epoch===config.epoch||c.epoch==='*'))void stop('OPERATOR_STOP');}catch(e){if(e.code!=='ENOENT')void stop('CONTROL_INVALID');}}}finally{polling=false;}},Math.min(250,limits.maxAgeMs));timer.unref();
 return {status,stop,bypass(){},observeDuplicate(t){duplicates++;if(t)transport++;},
  discardUnwrittenParent(){if(building){duplicates+=building.duplicates;transport+=building.transport;if(building.entries.length)void stop('PARENT_SAVE_PROOF_MISSING');else building=null;}},
  startParent(sequence){if(state!=='RUNNING')return false;if(building||parents.length>=cap.maxParents){void stop('PARENT_COUNT_LIMIT');return false;}building={id:config.epoch+':'+(++ordinal),sequence,entries:[],bytes:0,duplicates:0,transport:0,captureMs:0};return true;},
  observe(previous,merged,changed=true,serialized=null){if(!building||state!=='RUNNING')return;const p=building,t=performance.now();try{if(!changed){p.duplicates++;if(previous?.candleSeenAt!==merged.candleSeenAt||previous?.updatedAt!==merged.updatedAt)p.transport++;return;}
    if(p.entries.length>=cap.maxParentEvents)throw Error('PARENT_EVENT_LIMIT');
    const key=String(merged.code||merged.symbol)+'|'+String(merged.candleTime||merged.date||'');
    // JSON bytes detach nested references before cache persistence. No later cache reconstruction.
    const encode=v=>{const json=freeze(v,cap.maxEntryBytes);return {json,bytes:Buffer.byteLength(json)};},z=serialized?fromComparison(serialized.mergedContent,merged,cap.maxEntryBytes):encode(merged),a=previous===undefined?null:serialized?fromComparison(serialized.previousContent,previous,cap.maxEntryBytes):encode(previous),json=(a===null?'{':'{"previous":'+a.json+',')+'"merged":'+z.json+'}',jsonBytes=z.bytes+11+(a?a.bytes+12:0),n=jsonBytes+z.bytes+128;
    if(n>cap.maxEntryBytes||bytes+n>cap.maxParentBytes)throw Error('PARENT_BYTE_LIMIT');p.entries.push({key,json,jsonBytes,merged:z.json,mergedBytes:z.bytes,...(serialized?{sourceRef:merged}:{})});p.bytes+=n;bytes+=n;peakBytes=Math.max(peakBytes,bytes);
   }catch(e){void stop(e.message);}finally{p.captureMs+=performance.now()-t;lastCapture=p.captureMs;capturePeak=Math.max(capturePeak,p.captureMs);if(p.captureMs>cap.maxCaptureMs)void stop('PARENT_CAPTURE_TIME_LIMIT');}},
  seal,
  begin(changes){if(!this.startParent(null))return null;for(const c of changes)this.observe(c.previous,c.merged);return seal();},
  confirm(token,proof){try{if(state!=='RUNNING'||!token)return;const p=parents.find(p=>p.id===token);if(!p||p.proof||proof.ok!==true||proof.original_ack!==true||BigInt(p.frozen)>BigInt(proof.cache_started_ns)||BigInt(proof.cache_started_ns)>BigInt(proof.cache_finished_ns)){void stop('PARENT_ACK_INVALID');return;}if(config.recoverySourceCache&&path.resolve(proof.cache_file)!==path.resolve(config.recoverySourceCache)){void stop('PARENT_ACK_SOURCE_INVALID');return;}
   p.proof={ok:true,original_ack:true,cache_file:proof.cache_file,cache_started_ns:proof.cache_started_ns,cache_finished_ns:proof.cache_finished_ns,spool_sequence:proof.spool_sequence,collector_epoch:config.epoch};
   setImmediate(()=>{try{if(state!=='RUNNING')return;const h=crypto.createHash('sha256');for(const e of p.entries){const b=Buffer.from(e.json),head=Buffer.alloc(4);head.writeUInt32BE(b.length);h.update(head).update(b);}p.root=h.digest('hex');pump();}catch(e){void stop('PARENT_DISPATCH_FAILED:'+e.message);}});
   }catch(e){void stop('PARENT_ACK_INVALID');}
  }
 };
}
module.exports={createParentBridge,CONTRACT,DEFAULTS};
