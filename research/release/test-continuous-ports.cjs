'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const {ProductionAdapter}=require('./production-adapter.cjs'),{seed}=require('./test-recovery.cjs');
const {Coordinator,digest}=require('../integration/coordinator.cjs'),{reclaim}=require('../integration/recover-dead-owner.cjs');
const port={scope:'ISOLATED',contract:'phase234-file-port-v1',version:'v1'};
const env=p=>({MP_PHASE2_ENABLED:'1',...(p>=3?{MP_PHASE3_ENABLED:'1'}:{}),...(p===4?{MP_PHASE4_ENABLED:'1'}:{})});
const adapter=(x,p,opts={})=>new ProductionAdapter({directory:x.dir,env:env(p),port,...opts});
const phase2=(x,r)=>x.c.store.get(r.ports.receipts[2]).payload;
function next(frame,sequence,events,asOf=frame.asOf){return {...structuredClone(frame),sequence,events,asOf,gate:{...frame.gate,as_of:asOf}};}
function candle(frame,time,volume=1000){const e=structuredClone(frame.events[0]);e.payload.candleTime=frame.trade_date+'T'+time+'+08:00';e.payload.volume=volume;e.payload_sha256=digest(e.payload);return e;}
function scrub(root){const x=structuredClone(root);delete x.txHash;delete x.coordinator.continuous;return x;}
if(process.argv[2]==='continuous-child'){
 const [dir,p,stage]=process.argv.slice(3),x={dir},a=adapter(x,Number(p));
 if(stage==='AFTER_PUBLISH'){
  const old=fs.renameSync;fs.renameSync=function(a,b){const result=old(a,b);if(path.basename(b)==='root.json')process.exit(78);return result;};
 }else{
  const {ContinuousPorts}=require('./continuous-ports.cjs'),original=ContinuousPorts.prototype.record;
  ContinuousPorts.prototype.record=function(p,...args){const r=original.call(this,p,...args);if(stage==='PORT_'+p)process.exit(78);return r;};
 }
 a.runIncremental(JSON.parse(fs.readFileSync(path.join(dir,'input.json')))).then(()=>process.exit(2)).catch(e=>{console.error(e);process.exitCode=1;});
}else(async()=>{
 const tests=[],evidence=[];const start=Date.now();
 for(const p of [2,3,4]){
  const x=seed(),frames=[x.frame],baseline=x.c.baseline();
  let r=await adapter(x,p).runIncremental(x.frame);assert.equal(r.status,p===4?'OFFLINE_COMMITTED':'ISOLATED_PHASE_COMMITTED');assert.equal(r.root.sequence,1);
  assert(phase2(x,r).changed_minutes.some(e=>e.key.includes('04:40:00')));
  r=await adapter(x,p).runIncremental(x.frame);assert.equal(r.status,'REPLAY_DEDUP');
  frames.push(next(x.frame,2,x.frame.events));r=await adapter(x,p).runIncremental(frames.at(-1));assert.equal(phase2(x,r).changed_minutes.length,0);
  frames.push(next(x.frame,3,[candle(x.frame,'12:40:00',1001)]));r=await adapter(x,p).runIncremental(frames.at(-1));assert(phase2(x,r).changed_minutes.some(e=>e.kind==='INVALIDATE'));assert(phase2(x,r).changed_minutes.some(e=>e.kind==='UPSERT'));
  frames.push(next(x.frame,4,[candle(x.frame,'13:00:00')]));r=await adapter(x,p).runIncremental(frames.at(-1));assert.equal(phase2(x,r).changed_minutes.length,0);assert(r.root.coordinator.due['1000']);
  frames.push(next(x.frame,5,[],x.frame.trade_date+'T13:01:00+08:00'));r=await adapter(x,p).runIncremental(frames.at(-1));assert.equal(phase2(x,r).changed_minutes.length,1);assert(!r.root.coordinator.due['1000']);
  const raw={symbol:'1000',trade_date:x.frame.trade_date,lastTradeTime:frames.at(-1).asOf,tradeSerial:'9',lastPrice:108,source:'fugle-websocket'};
  frames.push(next(x.frame,6,[{type:'QUOTE',symbol:'1000',payload:raw,payload_sha256:digest(raw)}],frames.at(-1).asOf));r=await adapter(x,p).runIncremental(frames.at(-1));assert.deepEqual(phase2(x,r).candle_symbols,[]);assert.equal(r.root.sequence,6);
  assert(!fs.existsSync(path.join(x.dir,'recovery')));assert(!fs.existsSync(x.c.pending));
  if(p===4){const original=seed();for(const f of frames)await original.c.run(f);assert.deepEqual(scrub(r.root),scrub(original.c.store.root()));}
  const digestBefore=digest(x.c.store.root()),files=fs.readdirSync(x.dir);assert.equal((await adapter(x,p).rollback().adapter.runIncremental(frames.at(-1))).status,'OFF');assert.equal(digest(x.c.store.root()),digestBefore);assert.deepEqual(fs.readdirSync(x.dir),files);
  await assert.rejects(adapter(x,p).run(frames.at(-1)),/REBASE/);
  await assert.rejects(adapter(x,p,{port:{...port,version:'v2'}}).runIncremental(frames.at(-1)),/REBASE/);
  evidence.push({phase:p,directory:x.dir,sequences:6,final_root_sha256:digestBefore,receipts:r.ports.receipts,baseline_sha256:digest(baseline)});
  tests.push('phase '+p+': six continuous frames, restart, duplicate, old-minute revision, pending completion clock, quote-only, readback, replay, rollback, no cold recovery');
 }
 for(const mutate of [f=>f.epoch='wrong',f=>f.trade_date='2026-10-09',f=>f.sequence=3,f=>f.events[0].payload_sha256='0'.repeat(64)]){
  const x=seed(),f=structuredClone(x.frame);mutate(f);await assert.rejects(adapter(x,4).runIncremental(f));assert.equal(x.c.store.root(),null);
 }tests.push('epoch/date/sequence/event hash rejected');
 for(const p of [2,3,4]){
  const x=seed();let calls=0;assert.equal((await adapter(x,p,{stop:()=>++calls>2}).runIncremental(x.frame)).status,'STOPPED');assert.equal(x.c.store.root(),null);
  assert.equal((await adapter(x,p).runIncremental(x.frame)).root.sequence,1);assert.equal((await adapter(x,p).runIncremental(x.frame)).status,'REPLAY_DEDUP');
  const ref=x.c.store.root().continuous?.receipts[2]||x.c.store.root().coordinator.continuous.receipts[2];fs.appendFileSync(path.join(x.dir,'objects',ref+'.json'),' ');await assert.rejects(adapter(x,p).runIncremental(next(x.frame,2,[])),/OBJECT_HASH/);
 }tests.push('each phase STOP retains intent; restart once; receipt tamper blocks');
 for(const [p,stages]of [[2,['PORT_2','AFTER_PUBLISH']],[3,['PORT_3','AFTER_PUBLISH']],[4,['PORT_2','PORT_3','PORT_4','AFTER_PUBLISH']]])for(const stage of stages){
  const x=seed(),child=spawnSync(process.execPath,['--max-old-space-size=128',__filename,'continuous-child',x.dir,String(p),stage],{timeout:20000,encoding:'utf8'});assert.equal(child.status,78,child.stderr);
  const published=x.c.store.root();assert.equal(!!published,stage==='AFTER_PUBLISH');
  for(const name of ['coordinator.lock','owner.lock'])if(fs.existsSync(path.join(x.dir,name))){const l=JSON.parse(fs.readFileSync(path.join(x.dir,name)));reclaim(x.dir,name,typeof l==='number'?l:l.pid);}
  const r=await adapter(x,p).runIncremental(x.frame);assert.equal(r.root.sequence,1);assert.equal(r.status,stage==='AFTER_PUBLISH'?'REPLAY_DEDUP':p===4?'OFFLINE_COMMITTED':'ISOLATED_PHASE_COMMITTED');assert(!fs.existsSync(x.c.pending));
  tests.push('actual child process death '+p+'/'+stage+'; explicit dead owner reclaim; one publication');
 }
 const x=seed();await adapter(x,4).runIncremental(x.frame);await assert.rejects(adapter(x,4).runIncremental({...x.frame,asOf:x.frame.trade_date+'T13:01:00+08:00'}),/REPLAY_CONFLICT/);
 await assert.rejects(adapter(x,3).runIncremental(next(x.frame,2,[])),/REBASE/);tests.push('same-sequence conflict and flags drift rejected');

 for(const p of [2,3,4])for(const fault of ['BEFORE_ROOT','BEFORE_RENAME','AFTER_RENAME']){
  const x=seed();await adapter(x,p).runIncremental(x.frame);const old=digest(x.c.store.root()),second=next(x.frame,2,[candle(x.frame,'12:40:00',1111)]);
  await assert.rejects(adapter(x,p).runIncremental(second,{fault}),/CRASH/);
  if(fault!=='AFTER_RENAME')assert.equal(digest(x.c.store.root()),old);else assert.equal(x.c.store.root().sequence,2);
  assert.equal((await adapter(x,p).runIncremental(second)).root.sequence,2);assert.equal((await adapter(x,p).runIncremental(second)).status,'REPLAY_DEDUP');
 }tests.push('nine phase/root fault combinations on second sequence retain previous publication or dedup committed publication');
 const cold=seed();adapter(cold,2).bindMode(cold.c.store,'COLD_RECOVERY');await assert.rejects(adapter(cold,2).runIncremental(cold.frame),/REBASE/);assert.equal(cold.c.store.root(),null);tests.push('cold directory rejected by continuous without entering recovery');
 const drift=seed();await adapter(drift,3).runIncremental(drift.frame);const b=drift.c.baseline();b.baseline_sha256='0'.repeat(64);fs.writeFileSync(drift.c.baseFile,JSON.stringify({hash:drift.c.store.put(b)}));await assert.rejects(adapter(drift,3).runIncremental(next(drift.frame,2,[])),/BASELINE_DRIFT/);tests.push('independently valid but different baseline rejected');
 const blank=path.join(require('os').tmpdir(),'mp-default-off-'+Date.now());assert.equal((await new ProductionAdapter({directory:blank}).runIncremental({})).status,'OFF');assert(!fs.existsSync(blank));
 for(const e of [{MP_PHASE3_ENABLED:'1'},{MP_PHASE4_ENABLED:'1'},{MP_PHASE2_ENABLED:'1',MP_PHASE4_ENABLED:'1'}])assert.throws(()=>new ProductionAdapter({directory:blank,env:e,port}),/DEPENDENCY/);tests.push('default OFF and all dependency violations');
 console.log(JSON.stringify({status:'PASS',tests,evidence,elapsed_ms:Date.now()-start,peak_rss_kib:process.resourceUsage().maxRSS,formal_connected:false,natural_shadow:'NOT_AUTHORIZED'}));
})().catch(e=>{console.error(e);process.exitCode=1;});

