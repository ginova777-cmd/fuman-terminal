'use strict';
const {parentPort,workerData:c}=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {sha,durable,difference,keyOf,projection}=require('./mother-change-evidence.cjs');
const CONTRACT='mother-change-evidence-v3-c2-capacity';
let parent=null,sequence=0,previousCommit=null,used=0,failed=false,lock=null;
let lastInput=null,lastDone=null,processing=false;
const revisions=new Map();
const started=performance.now();
let durableMs=0,durableCalls=0;const cpuStart=process.cpuUsage();
function save(name,value){const size=Buffer.byteLength(JSON.stringify(value));if(used+size>c.limits.maxDiskBytes)throw Error('EVIDENCE_DISK_BUDGET');const s=fs.statfsSync(c.dir);if(Number(s.bavail)*Number(s.bsize)<c.limits.minFreeBytes+size)throw Error('EVIDENCE_DISK_FREE_WARNING');const t=performance.now();durable(path.join(c.dir,name),value);durableMs+=performance.now()-t;durableCalls++;used+=fs.statSync(path.join(c.dir,name)).size;}
function fault(at){if(c.testOnly?.crashAt===at)process.exit(71);if(c.testOnly?.failAt===at)throw Error('INJECTED_'+at);}
function metrics(){return {heap:process.memoryUsage(),resource:process.resourceUsage(),elapsed_ms:performance.now()-started,durable_ms:durableMs,durable_calls:durableCalls,logical_disk_bytes:used,physical_disk_io:'UNAVAILABLE',cpu_us_process:process.cpuUsage(cpuStart)};}
function fail(e){failed=true;parentPort.postMessage({type:'blocked',reason:e.message,metrics:metrics()});}
if(c.stopOnly){try{fs.mkdirSync(c.dir+'.stops',{recursive:true});const file=path.join(c.dir+'.stops',crypto.randomUUID()+'.json');durable(file,c.receipt);parentPort.postMessage({stop_receipt:file});}catch(e){parentPort.postMessage({stop_receipt_error:e.message});}}
else {
try{
 require('./mother-evidence-recovery.cjs').verify(c.recovery,{...c,dir:c.dir});
 if(fs.existsSync(c.dir)&&fs.readdirSync(c.dir).length)throw Error('C2_REQUIRES_NEW_EPOCH_DIRECTORY');fs.mkdirSync(c.dir,{recursive:true});
 lock=fs.openSync(path.join(c.dir,'owner.lock'),'wx');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,epoch:c.epoch,kind:c.kind}));fs.fsyncSync(lock);fs.closeSync(lock);lock=null;
 save('recovery.json',{contract:CONTRACT,reference:c.recovery,continuous:false,gap_closed:false});parentPort.postMessage({type:'ready'});
}catch(e){fail(e);}
parentPort.on('message',async message=>{
 if(failed)return;
 if(processing){fail(Error('SUB_CONCURRENT_MESSAGE'));return;}processing=true;
 try{
  if(c.testOnly?.delayMs)await new Promise(r=>setTimeout(r,c.testOnly.delayMs));
  if(typeof message.json!=='string'||Buffer.byteLength(message.json)>c.limits.maxBatchBytes||sha(message.json)!==message.sha256)throw Error('SUB_MESSAGE_HASH_OR_SIZE');
  if(lastInput===message.sha256){parentPort.postMessage(lastDone);return;}
  const m=JSON.parse(message.json);if(m.contract!==CONTRACT||m.epoch!==c.epoch||!Array.isArray(m.entries)||m.entries.length>c.limits.maxBatchEvents||m.total_entries>20000||m.sub_count<1||m.sub_count>20000)throw Error('PARENT_IDENTITY_INVALID');
  if(!parent){if(m.sub_index!==0)throw Error('PARENT_SUB_GAP');parent={id:m.parent_id,next:0,total:m.total_entries,count:0,subCount:m.sub_count,root:m.root_hash,hash:crypto.createHash('sha256'),last:null,changed:0,duplicates:m.duplicate_count||0,transport:m.transport_only_count||0,final:new Map(),chain:new Map()};fault('before_parent');save(`parent-${sequence+1}.json`,{...m,entries:undefined,status:'PRE_CACHE_INTENT_VOLATILE',scope:'manifest durable after original cache ACK; intent captured before cache'});}
  if(m.parent_id!==parent.id||m.sub_index!==parent.next||m.total_entries!==parent.total||m.sub_count!==parent.subCount||m.root_hash!==parent.root)throw Error('PARENT_SUB_GAP');
  const p=m.proof;if(p?.ok!==true||p.original_ack!==true||p.collector_epoch!==c.epoch||BigInt(m.frozen_ns)>BigInt(p.cache_started_ns)||BigInt(p.cache_started_ns)>BigInt(p.cache_finished_ns)||(c.recoverySourceCache&&path.resolve(p.cache_file)!==path.resolve(c.recoverySourceCache)))throw Error('PARENT_ACK_INVALID');
  const events=[];
  for(const e of m.entries){const b=Buffer.from(e.json),head=Buffer.alloc(4);head.writeUInt32BE(b.length);parent.hash.update(head).update(b);const {previous,merged}=JSON.parse(e.json),final=JSON.parse(e.final_json),id=keyOf(merged,c.kind),d=difference(previous,merged,c.kind);
   if(keyOf(final,c.kind).key!==id.key)throw Error('PARENT_FINAL_IDENTITY');const finalHash=sha(projection(final,c.kind));if(parent.final.has(id.key)&&parent.final.get(id.key)!==finalHash)throw Error('PARENT_FINAL_CONFLICT');parent.final.set(id.key,finalHash);
   const prior=parent.chain.get(id.key)||revisions.get(id.key)?.hash;if(prior&&prior!==d.previous_hash)throw Error('PARENT_REVISION_CHAIN');parent.chain.set(id.key,d.content_hash);
   const ordinal=parent.count++;if(!d.changed){parent.duplicates++;if(d.groups.transport.length)parent.transport++;continue;}
   if(!revisions.has(id.key)&&revisions.size>=50000)throw Error('REVISION_MEMORY_LIMIT');const revision=(revisions.get(id.key)?.revision||0)+1;revisions.set(id.key,{revision,hash:d.content_hash});
   events.push({event_id:m.parent_id+':'+ordinal,ordinal,...id,revision,operation:d.operation,previous_hash:d.previous_hash,content_hash:d.content_hash,previous, payload:merged,final_payload:final,cache_visibility:d.content_hash===finalHash?'FINAL_AT_PARENT_ACK':'INTERMEDIATE_TRANSITION'});
  }
  const finalSub=m.sub_index===m.sub_count-1;
  if(finalSub){if(parent.count!==parent.total||parent.hash.digest('hex')!==parent.root)throw Error('PARENT_ROOT_MISMATCH');for(const [key,value]of parent.chain)if(parent.final.get(key)!==value)throw Error('PARENT_FINAL_CHAIN_MISMATCH');}
  const batch={contract:CONTRACT,status:'PRE_CACHE_INTENT_VOLATILE',epoch:c.epoch,parent_id:m.parent_id,sub_index:m.sub_index,sub_count:m.sub_count,sequence:++sequence,previous_commit_hash:previousCommit,previous_parent_sub_hash:parent.last,intent:m,events};batch.hash=sha(batch);const prefix=String(sequence).padStart(12,'0');
  fault('before_prepare');save(prefix+'.prepare.json',batch);fault('after_prepare');
  const saved={contract:CONTRACT,parent_id:m.parent_id,sequence,sub_index:m.sub_index,prepare_hash:batch.hash,proof:p,status:'ORIGINAL_CACHE_ACK_VERIFIED'};save(prefix+'.saved.json',saved);fault('after_saved');
  const commit={contract:CONTRACT,status:'DURABLE_COMMITTED',parent_id:m.parent_id,sequence,sub_index:m.sub_index,prepare_hash:batch.hash,saved_hash:sha(saved),previous_commit_hash:previousCommit,events:events.length};commit.hash=sha(commit);save(prefix+'.commit.json',commit);fault('after_commit');previousCommit=commit.hash;parent.last=commit.hash;parent.next++;parent.changed+=events.length;
  let receipt=null;if(finalSub){receipt={contract:CONTRACT,status:'PARENT_COMPLETE',parent_id:parent.id,total_entries:parent.count,changed_events:parent.changed,duplicate_count:parent.duplicates,transport_only_count:parent.transport,sub_count:parent.subCount,root_hash:parent.root,last_commit_hash:parent.last,continuous:false,gap_closed:false,completed_at:new Date().toISOString()};fault('before_parent_complete');save(prefix+'.parent-complete.json',receipt);fault('after_parent_complete');parent=null;}
  lastInput=message.sha256;lastDone={type:'done',parent_id:m.parent_id,sub_index:m.sub_index,events:events.length,receipt,metrics:metrics()};parentPort.postMessage(lastDone);
 }catch(e){fail(e);}finally{processing=false;}
});
}
