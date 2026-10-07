'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {createBridge,ns}=require('../lib/mother-evidence-bridge.cjs');
const {recover,verify}=require('../lib/mother-evidence-recovery.cjs');
const {sha,validateBatch}=require('../lib/mother-change-evidence.cjs');
const {audit}=require('../lib/mother-change-evidence-audit.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+10000;while(!fn()){if(Date.now()>end)throw Error('TIMEOUT');await sleep(5);}}
const row=n=>({code:'2330',market:'TSE',trade_date:'2026-10-06',quoteSeenAt:'2026-10-06T01:00:00Z',close:n,tradeSerial:n,source:'websocket:trades'});
const limits={maxEvents:128,maxBytes:1024*1024,maxBatchEvents:32,maxBatchBytes:128*1024,maxAgeMs:15000,minFreeBytes:1024,maxDiskBytes:32*1024*1024};
function save(b,t,file,rows,extra={}){const start=ns();fs.writeFileSync(file,JSON.stringify(b.status().kind==='candle'?{candles:rows}:{quotes:rows}));const end=ns();b.confirm(t,{ok:true,original_ack:true,cache_file:file,rows_json:JSON.stringify(rows),cache_started_ns:start,cache_finished_ns:end,...extra});}
async function child(){
 const {config,cache,mode}=JSON.parse(fs.readFileSync(process.argv[3]));
 const b=createBridge(config);await until(()=>b.status().ready);
 const t=b.begin([{merged:row(1)}]);save(b,t,cache,[row(1)]);
 if(mode==='prepared')await until(()=>b.status().prepared_token===t||b.status().committed_count===1);
 if(mode==='committed')await until(()=>b.status().committed_count===1);
 // Abrupt entire process exit: no bridge.stop, no queue serialization/owner unlock.
 process.exit(73);
}
async function main(){
 const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});const checks=[],bridges=[];
 const make=(name,previousDir=null,source=null,kind='quote')=>{
  const c={dir:path.join(out,name),epoch:crypto.randomUUID(),kind,producerVersion:'c2-crash-test',limits};
  const cache=source||path.join(out,name+'-cache.json');if(!source)fs.writeFileSync(cache,JSON.stringify(kind==='quote'?{quotes:[]}:{candles:[]}));
  c.recovery=recover({cacheFile:cache,kind,targetEpoch:c.epoch,targetDir:c.dir,out:path.join(out,name+'-recovery'),previousDir,bootstrap:!previousDir});return {c,cache};
 };
 try{
  for(const mode of ['volatile','prepared','committed']){
   const {c,cache}=make('crash-'+mode);if(mode==='volatile')c.testOnly={delayMs:5000};if(mode==='prepared')c.testOnly={delayConfirmMs:5000};
   const file=path.join(out,mode+'-child.json');fs.writeFileSync(file,JSON.stringify({config:c,cache,mode}));
   const result=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[__filename,'--child',file],{stdio:['ignore','pipe','pipe']});let stderr='';p.stderr.on('data',b=>stderr+=b);p.on('error',reject);p.on('exit',code=>resolve({code,stderr}));});
   assert.equal(result.code,73,result.stderr);assert.equal(JSON.parse(fs.readFileSync(cache)).quotes[0].close,1);assert(fs.existsSync(path.join(c.dir,'owner.lock')));
   const names=fs.readdirSync(c.dir);if(mode==='volatile')assert(!names.some(n=>n.endsWith('.prepare.json')));
   if(mode==='prepared'){assert(names.some(n=>n.endsWith('.prepare.json')));assert(!names.some(n=>n.endsWith('.commit.json')));}
   const before=names.map(n=>[n,sha(fs.readFileSync(path.join(c.dir,n)))]);
   const next=make('recovery-'+mode,c.dir,cache);const r=verify(next.c.recovery,next.c);assert.equal(r.lost_intent_count,null);assert.equal(r.gap_closed,false);assert.equal(r.lost_intents_reconstructed,0);
   const b=createBridge(next.c);bridges.push(b);await until(()=>b.status().ready);assert.equal(b.status().continuous,false);
   const t=b.begin([{previous:row(1),merged:row(2)}]);save(b,t,cache,[row(2)]);await until(()=>b.status().committed_count===1);
   const a=audit(next.c.dir);assert.equal(a.events,1);assert.equal([...a.final.values()][0].payload.close,2);assert.equal(a.continuous,false);
   assert.deepEqual(names.map(n=>[n,sha(fs.readFileSync(path.join(c.dir,n)))]),before);
   checks.push(mode+': process crash, immutable old epoch, full cache recovery, lost intents not reconstructed');
  }
  const {c,cache}=make('frozen');c.testOnly={delayMs:200};const b=createBridge(c);bridges.push(b);await until(()=>b.status().ready);
  const original=row(3),t=b.begin([{merged:original}]);original.close=999;save(b,t,cache,[row(3)]);
  fs.writeFileSync(cache,JSON.stringify({quotes:[row(99)]}));await until(()=>b.status().committed_count===1);
  const batch=JSON.parse(fs.readFileSync(path.join(c.dir,'000000000001.prepare.json')));assert.equal(batch.events[0].payload.close,3);assert.equal(batch.context.intent.entries[0].merged.close,3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(c.dir,'000000000001.commit.json'))).status,'DURABLE_COMMITTED');
  checks.push('frozen before cache: later object/cache mutation cannot reconstruct intent');
  const bad=structuredClone(batch);bad.events[0].event_id=crypto.randomUUID();delete bad.batch_hash;bad.batch_hash=sha(bad);assert.throws(()=>validateBatch(bad),/BINDING/);checks.push('rehashing a changed event cannot bypass frozen identity binding');
  const k=make('candle-revisions',null,null,'candle'),kb=createBridge(k.c);bridges.push(kb);await until(()=>kb.status().ready);
  const candle=(minute,volume=10)=>({symbol:'2330',market:'TSE',trade_date:'2026-10-06',candleTime:`2026-10-06T01:${minute}:00Z`,open:100,high:101,low:99,close:100,volume,synthetic:false,source:'websocket:candles'});
  const versions=[{merged:candle('00')},{previous:candle('00'),merged:candle('00',11)},{merged:candle('01')},{previous:candle('00',11),merged:candle('00',12)},{previous:candle('00',12),merged:{...candle('00',12),synthetic:true}}];
  let n=0;for(const change of versions){const kt=kb.begin([change]);save(kb,kt,k.cache,[change.merged]);await until(()=>kb.status().committed_count===n+1);n++;}
  assert.equal(audit(k.c.dir).events,5);assert.equal(audit(k.c.dir).unique_keys,2);
  const final=versions.at(-1).merged;for(const merged of [final,{...final,received_at:'2026-10-06T01:22:00Z'}]){const kt=kb.begin([{previous:final,merged}]);save(kb,kt,k.cache,[merged]);await until(()=>!kb.status().worker_busy);}
  assert.equal(kb.status().committed_count,5);assert.equal(kb.status().duplicate_count,2);assert.equal(kb.status().transport_only_count,1);checks.push('C2 new/same/older-minute revision and quality changes; duplicate/transport-only not market changes');
  const sync=make('no-sync-io'),sb=createBridge(sync.c);bridges.push(sb);await until(()=>sb.status().ready);
  const methods=['readFileSync','writeFileSync','openSync','fsyncSync','renameSync'],originals=Object.fromEntries(methods.map(m=>[m,fs[m]]));let st;
  try{for(const m of methods)fs[m]=()=>{throw Error('MAIN_SYNC_IO_FORBIDDEN');};st=sb.begin([{merged:row(6)}]);assert(st);}finally{for(const m of methods)fs[m]=originals[m];}
  save(sb,st,sync.cache,[row(6)]);await until(()=>sb.status().committed_count===1);checks.push('begin performs no synchronous filesystem I/O on main thread');
  const late=make('late-intent'),lb=createBridge(late.c);bridges.push(lb);await until(()=>lb.status().ready);const early=ns(),lt=lb.begin([{merged:row(4)}]);save(lb,lt,late.cache,[row(4)],{cache_started_ns:early});await until(()=>lb.status().state==='BLOCKED');assert.equal(lb.status().reason,'INTENT_NOT_FROZEN_BEFORE_CACHE');checks.push('post-cache intent rejected; no retrospective prepare');
  const missing=make('no-recovery');delete missing.c.recovery;const mb=createBridge(missing.c);bridges.push(mb);await until(()=>mb.status().state==='BLOCKED');assert.equal(mb.status().reason,'FULL_CACHE_RECOVERY_REQUIRED');save(mb,null,missing.cache,[row(5)]);checks.push('missing recovery blocks evidence only; primary saves continue');
  const corrupt=make('corrupt');fs.appendFileSync(corrupt.c.recovery.path,' ');const cb=createBridge(corrupt.c);bridges.push(cb);await until(()=>cb.status().state==='BLOCKED');assert.equal(cb.status().reason,'RECOVERY_RECEIPT_HASH_MISMATCH');checks.push('corrupt recovery receipt rejected');
  const badCache=make('bad-baseline');const rr=JSON.parse(fs.readFileSync(badCache.c.recovery.path));fs.writeFileSync(rr.baseline_file,'{}');assert.throws(()=>verify(badCache.c.recovery,badCache.c),/BASELINE/);checks.push('mutated recovery baseline rejected');
  const dup=path.join(out,'duplicate-cache.json');fs.writeFileSync(dup,JSON.stringify({quotes:[row(1),row(1)]}));assert.throws(()=>recover({cacheFile:dup,kind:'quote',targetEpoch:'duplicate',targetDir:path.join(out,'dup-evidence'),out:path.join(out,'dup-recovery'),bootstrap:true}),/DUPLICATE/);checks.push('invalid full cache cannot authorize recovery');
  const {startup}=require('../lib/mother-evidence-startup.cjs');assert.throws(()=>startup({root:out}),/CONFIG/);
  const epoch=crypto.randomUUID(),ref={path:path.join(out,'reference.json'),sha256:'a'.repeat(64)},cfg=startup({root:out,producerVersion:'test',quoteCacheFile:path.join(out,'quotes.json'),candleCacheFile:path.join(out,'candles.json'),limitsJson:JSON.stringify(limits),startJson:JSON.stringify({contract:'mother-evidence-start-v2-c2',epoch,recovery:{quote:ref,candle:ref}})});
  assert.equal(cfg.quote.dir,path.join(out,epoch,'quotes'));assert.equal(cfg.candle.dir,path.join(out,epoch,'candles'));assert.equal(cfg.quote.epoch,epoch);assert.throws(()=>verify(c.recovery,{...c,recoverySourceCache:path.join(out,'wrong-cache.json')}),/SOURCE_CACHE_MISMATCH/);checks.push('explicit C2 config binds recovery references to new epoch directories; no enable side effect');
  fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({status:'PHASE1_C2_CRASH_RECOVERY_OFFLINE_VERIFIED',checks,natural_shadow:'NO_GO',phase2:'NOT_AUTHORIZED',power_loss_tested:false},null,2));console.log(JSON.stringify({pass:true,checks:checks.length}));
 }finally{for(const b of bridges)await b.stop('TEST_FINISHED');}
}
(process.argv[2]==='--child'?child():main()).catch(e=>{console.error(e.stack);process.exitCode=1;});
