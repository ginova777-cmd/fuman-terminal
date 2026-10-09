'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),os=require('os');
const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');
const {local,sha}=require('./producer-handoff.cjs');
const {hashFile,inspect}=require('../../lib/mother-evidence-recovery-stream.cjs');
const {atomic}=require('./technical-control.cjs');
if(!isMainThread){try{parentPort.postMessage({ok:true,value:inspect(workerData.file,workerData.kind,536870912,workerData.scratch)});}catch(e){parentPort.postMessage({ok:false,error:e.message});}}
function guardedInspect(data){return new Promise((resolve,reject)=>{
 const start=Date.now();let done=false,peak=0,min=Infinity;
 const metrics=()=>({rss:process.memoryUsage().rss,available:os.freemem()});
 const initial=metrics();if(initial.available<1073741824||initial.rss>536870912)return reject(Object.assign(Error(initial.available<1073741824?'HOST_AVAILABLE_RAM':'PROCESS_RSS'),{resource:initial,stage:'PRE_WORKER'}));
 const w=new Worker(__filename,{workerData:data,resourceLimits:{maxOldGenerationSizeMb:128}});
 function finish(err,value){if(done)return;done=true;clearInterval(timer);if(err){err.resource={peak_rss:peak,available_min:min,...metrics(),elapsed_ms:Date.now()-start};err.stage='RECOVERY_WORKER';w.terminate().then(()=>reject(err));}else resolve({value,elapsed_ms:Date.now()-start,peak_rss:peak,available_min:min});}
 const timer=setInterval(()=>{const m=metrics();peak=Math.max(peak,m.rss);min=Math.min(min,m.available);if(m.available<1073741824)finish(Error('HOST_AVAILABLE_RAM'));else if(m.rss>536870912)finish(Error('PROCESS_RSS'));else if(Date.now()-start>120000)finish(Error('TIMEOUT'));},250);
 peak=initial.rss;min=initial.available;
 w.on('message',m=>finish(m.ok?null:Error(m.error),m.value));w.on('error',e=>finish(e));w.on('exit',code=>{if(!done)finish(Error('WORKER_EXIT_'+code));});
});}
async function prepare({directory,quote,candle,boundary,owner,manifest_hash}){
 const dir=local(directory);if(boundary?.scope!=='ISOLATED_REVIEW'||boundary.quiescent!==true||!owner||!/^[a-f0-9]{64}$/.test(manifest_hash||''))throw Error('QUIESCENT_BOUNDARY_REQUIRED');
 fs.mkdirSync(dir,{recursive:true});const epoch=crypto.randomUUID(),run=path.join(dir,epoch);fs.mkdirSync(run);const r={contract:'fresh-epoch-preparation-v1',epoch,owner,manifest_hash,status:'PREPARING',scope:'ISOLATED_REVIEW',continuity:'UNKNOWN',evidence_enabled:false,recovery:{}};
 try{for(const [kind,source]of Object.entries({quote,candle})){local(source);const copy=path.join(run,kind+'.baseline.json'),raw=hashFile(source,536870912,copy);if(boundary.hashes?.[kind]!==raw.sha256)throw Error('BOUNDARY_HASH');const a=await guardedInspect({file:copy,kind,scratch:path.join(run,kind+'-recovery')}),b=await guardedInspect({file:copy,kind,scratch:path.join(run,kind+'-verify')});if(a.value.sha256!==b.value.sha256||a.value.rows!==b.value.rows||a.value.sha256!==raw.sha256||a.value.duplicate_count!==0||b.value.duplicate_count!==0)throw Error('INDEPENDENT_VERIFY');r.recovery[kind]={source,baseline:copy,raw,recovery:a,verify:b};}
 // Refuse source movement across the two captures; quiescence is still an external prerequisite.
 for(const [kind,source]of Object.entries({quote,candle}))if(hashFile(source).sha256!==boundary.hashes[kind])throw Error('BOUNDARY_MOVED');
 r.status='PREPARED_NOT_STARTED';atomic(path.join(run,'prepared-start.json'),r);return {run,receipt:r};
 }catch(e){r.status='BLOCKED';r.trigger_reason=e.message;r.resource=e.resource||null;r.stage=e.stage||'SNAPSHOT_OR_VERIFY';atomic(path.join(run,'failure.json'),r);throw e;}
}
module.exports={prepare,guardedInspect};
