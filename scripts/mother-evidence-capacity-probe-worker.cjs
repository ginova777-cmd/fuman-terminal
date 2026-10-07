'use strict';
const {parentPort,workerData:c}=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const started=performance.now();
const memory=()=>({heap:process.memoryUsage(),resource:process.resourceUsage()});
const send=v=>parentPort.postMessage({...v,at_ms:performance.now()-started,memory:memory()});
send({stage:'start'});
async function main(){
 const {recover,verify}=require(path.join(c.root,'lib/mother-evidence-recovery.cjs'));
 if(c.mode==='recovery'){
  const config={cacheFile:c.input,kind:c.kind,targetEpoch:crypto.randomUUID(),targetDir:path.join(c.dir,'evidence'),out:path.join(c.dir,'recovery'),bootstrap:true};
  send({stage:'recover_begin'});const t=performance.now(),ref=recover(config);const recoverMs=performance.now()-t;send({stage:'recover_done',recover_ms:recoverMs,reference:ref});
  const t2=performance.now(),r=verify(ref,{epoch:config.targetEpoch,kind:c.kind,dir:config.targetDir,recoverySourceCache:c.input});
  send({stage:'complete',status:'PASS',recover_ms:recoverMs,verify_ms:performance.now()-t2,rows:r.baseline_rows,input_bytes:r.baseline_bytes});return;
 }
 const {createParentBridge:createBridge}=require(path.join(c.root,'lib/mother-evidence-parent.cjs')); const ns=()=>process.hrtime.bigint().toString();
 const source=JSON.parse(fs.readFileSync(c.input,'utf8')).slice(0,c.rows),changes=source.map(merged=>({merged}));
 const rowsJson=JSON.stringify(source),changesJson=JSON.stringify(changes),rawBytes=Buffer.byteLength(rowsJson),changeBytes=Buffer.byteLength(changesJson);
 // A 1-row local baseline isolates batch admission from full-cache recovery capacity.
 // This fixture is explicitly NOT a formal full-cache recovery acceptance.
 const small=path.join(c.dir,'batch-baseline.json');fs.writeFileSync(small,JSON.stringify({candles:source.slice(0,1)}));
 const epoch=crypto.randomUUID(),dir=path.join(c.dir,'evidence'),recovery=recover({cacheFile:small,kind:'candle',targetEpoch:epoch,targetDir:dir,out:path.join(c.dir,'batch-recovery'),bootstrap:true});
 const b=createBridge({dir,kind:'candle',epoch,producerVersion:'capacity-fixed-'+c.sha,limits:c.limits,recovery});
 const until=async fn=>{const end=Date.now()+20000;while(!fn()){if(Date.now()>end)throw Error('TIMEOUT');await new Promise(r=>setTimeout(r,5));}};
 try{
  await until(()=>b.status().ready||b.status().state!=='RUNNING');if(!b.status().ready)throw Error(b.status().reason);
  send({stage:'capture_begin',rows:source.length,batch_bytes:rawBytes,changes_bytes:changeBytes,limits:c.limits});
  const t=performance.now(); b.startParent(1); for(const {previous,merged} of changes){ const content=r=>{if(!r)return null;const v={...r};delete v.candleSeenAt;delete v.updatedAt;return JSON.stringify(v)}; b.observe(previous,merged,true,{previousContent:content(previous),mergedContent:content(merged)}); } const token=b.seal(),captureMs=performance.now()-t,queued=b.status();
  send({stage:'capture_return',capture_ms:captureMs,accepted:!!token,bridge:queued});
  const file=path.join(c.dir,'simulated-primary.json'),start=ns();fs.writeFileSync(file,JSON.stringify({candles:source}));const end=ns();
  if(token)b.confirm(token,{ok:true,original_ack:true,cache_file:file,cache_started_ns:start,cache_finished_ns:end,rows_json:rowsJson});
  await until(()=>b.status().completed_parents===1||['BLOCKED','FAILED','BYPASSED'].includes(b.status().state));
  const status=b.status();send({stage:'complete',status:status.completed_parents===1?'PASS':'BLOCKED',capture_ms:captureMs,rows:source.length,batch_bytes:rawBytes,changes_bytes:changeBytes,capture_queue_bytes:queued.parent_bytes,limits:c.limits,bridge:status,primary_copy_rows:JSON.parse(fs.readFileSync(file)).candles.length,primary_untouched:true});
 }finally{await b.stop('CAPACITY_TEST_FINISHED');}
}
main().catch(e=>send({stage:'error',status:'BLOCKED',reason:e.code||e.message}));
