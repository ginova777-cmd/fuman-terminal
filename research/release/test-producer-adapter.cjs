'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {ProducerAdapter}=require('./producer-adapter.cjs'),{seed}=require('./test-recovery.cjs');
const {digest}=require('../integration/coordinator.cjs');
const {snapshotManifest}=require('../phase2/incremental-writer.cjs');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'mp-producer-wiring-'));
const limits={maxEvents:1024,maxBytes:4194304,maxBatchEvents:128,maxBatchBytes:524288,maxAgeMs:15000,minFreeBytes:1048576,maxDiskBytes:67108864};
const delay=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){const deadline=Date.now()+15000;while(!fn()){if(Date.now()>deadline)throw Error('FIXTURE_TIMEOUT');await delay(10);}}
async function feed(kind,rows){
 const base=path.join(scratch,kind);fs.mkdirSync(base);const dir=path.join(base,'feed'),cache=path.join(base,'cache.json'),epoch='test-'+kind;
 fs.writeFileSync(cache,JSON.stringify({[kind==='candle'?'candles':'quotes']:[]}));
 const config={dir,epoch,kind,producerVersion:'SYNTHETIC_PRODUCER_FIXTURE',limits};config.recovery=require('../../lib/mother-evidence-recovery.cjs').recover({cacheFile:cache,kind,targetEpoch:epoch,targetDir:dir,out:path.join(base,'baseline'),bootstrap:true});
 const bridge=kind==='candle'?require('../../lib/mother-evidence-parent.cjs').createParentBridge(config):require('../../lib/mother-evidence-bridge.cjs').createBridge(config),snapshots=[];
 try{await until(()=>bridge.status().ready||bridge.status().state!=='RUNNING');assert(bridge.status().ready);
 for(let i=0;i<rows.length;i++){const changes=[{...(i?{previous:rows[i-1]}:{}),merged:rows[i]}],token=bridge.begin(changes);assert(token);const started=process.hrtime.bigint().toString();fs.writeFileSync(cache,JSON.stringify({[kind==='candle'?'candles':'quotes']:[rows[i]]}));bridge.confirm(token,{ok:true,original_ack:true,cache_file:cache,cache_started_ns:started,cache_finished_ns:process.hrtime.bigint().toString(),rows_json:JSON.stringify([rows[i]])});await until(()=>kind==='candle'?bridge.status().completed_parents===i+1:bridge.status().committed_count>=i+1);
 const copy=path.join(base,'snapshot-'+(i+1));fs.cpSync(dir,copy,{recursive:true});snapshots.push({kind,epoch,directory:copy,source_id:'fixture:'+kind,producer_version:kind==='quote'?config.producerVersion:null,manifest_hash:snapshotManifest(copy).hash});}
 return snapshots;}finally{await bridge.stop('ISOLATED_FIXTURE_FINISHED');}
}
(async()=>{const started=Date.now(),x=seed(),raw=x.frame.events[0].payload,date=x.frame.trade_date,asOf=x.frame.asOf;
const q={code:'1000',trade_date:date,market:'TSE',close:106,open:100,high:107,low:99,previousClose:100,quoteSource:'fugle-ws-trades',lastTradeTime:asOf,exchangeTime:asOf,receivedAt:asOf,tradeSerial:1,tradeVolume:20000};
const quotes=await feed('quote',[q,{...q,tradeSerial:2}]),candles=await feed('candle',[raw,{...raw,volume:1001}]),tests=[],evidence=[];
const env=p=>({MP_PHASE2_ENABLED:'1',...(p>=3?{MP_PHASE3_ENABLED:'1'}:{}),...(p===4?{MP_PHASE4_ENABLED:'1'}:{})});
for(const p of [2,3,4]){const s=seed(),reference=seed(),make=(i,extra={})=>new ProducerAdapter({directory:s.dir,env:env(p),sources:[quotes[i],candles[i]],...extra});let r;
 for(let i=0;i<2;i++){const at=i?date+'T13:01:00+08:00':asOf,gate={...s.frame.gate,as_of:at};r=await make(i).run({asOf:at,gate});assert.equal(r.root.sequence,i+1);const saved=s.c.store.get(r.root.sourceCursor.intent_hash);assert.equal(saved.producer.parts[0].next.sequence,i+1);assert.equal(saved.producer.parts[1].next.sequence,i+1);assert.equal(saved.events.length,2);
 if(p===4){await reference.c.run(saved);const clean=v=>{v=structuredClone(v);delete v.txHash;delete v.coordinator.continuous;return v;};assert.deepEqual(clean(r.root),clean(reference.c.store.root()));}
 assert.equal((await make(i).run({asOf:at,gate})).status,'REPLAY_DEDUP');}
 const clock=date+'T13:02:00+08:00';r=await make(1).run({asOf:clock,gate:{...s.frame.gate,as_of:clock}});assert.equal(r.root.sequence,3);assert.equal(s.c.store.get(r.root.sourceCursor.intent_hash).events.length,0);assert.equal(r.producer.parts[0].next.sequence,2);
 assert.equal((await make(1).rollback().adapter.runIncremental({})).status,'OFF');
 assert.equal(r.production_continuity_verified,false);assert(!fs.existsSync(path.join(s.dir,'recovery')));
 const before=digest(s.c.store.root());assert.equal((await make(1,{stop:()=>true}).run({})).status,'STOPPED');assert.equal(digest(s.c.store.root()),before);
 await assert.rejects(new ProducerAdapter({directory:s.dir,env:env(p),sources:[{...quotes[1],epoch:'other'},candles[1]]}).run({asOf,gate:s.frame.gate}),/IDENTITY_DRIFT/);
 evidence.push({phase:p,directory:s.dir,root_hash:before});tests.push('phase '+p+' actual C2 v2/v3 producer two segments -> continuous ports / source cursor / exact replay / STOP / parity');}
const off=path.join(scratch,'off');assert.equal((await new ProducerAdapter({directory:off,sources:null}).run({})).status,'OFF');assert(!fs.existsSync(off));tests.push('OFF has zero IO and no source requirements');
for(const fault of ['AFTER_PORT_2','BEFORE_RENAME','AFTER_RENAME']){const s=seed(),a=new ProducerAdapter({directory:s.dir,env:env(4),sources:[quotes[0],candles[0]]});await assert.rejects(a.run({asOf,gate:s.frame.gate,fault}),/CRASH/);const r=await a.run({asOf,gate:s.frame.gate});assert.equal(r.root.sequence,1);assert.equal((await a.run({asOf,gate:s.frame.gate})).status,'REPLAY_DEDUP');tests.push('producer cursor failure recovery '+fault);}
for(const kind of ['hash','partial','producer-version','formal-path']){const s=seed(),src=structuredClone([quotes[0],candles[0]]);
 if(kind==='hash')src[0].manifest_hash='0'.repeat(64);
 if(kind==='producer-version')src[0].producer_version='wrong';
 if(kind==='formal-path')src[0].directory='C:/fuman-runtime';
 if(kind==='partial'){const dir=path.join(scratch,'partial');fs.cpSync(candles[0].directory,dir,{recursive:true});for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.parent-complete.json')))fs.unlinkSync(path.join(dir,f));src[1].directory=dir;src[1].manifest_hash=snapshotManifest(dir).hash;}
 await assert.rejects(new ProducerAdapter({directory:s.dir,env:env(4),sources:src}).run({asOf,gate:s.frame.gate}));assert.equal(s.c.store.root(),null);tests.push('reject '+kind+' without cursor advance');}
console.log(JSON.stringify({status:'PASS',tests,evidence,source_fixture_root:scratch,elapsed_ms:Date.now()-started,peak_rss_kib:process.resourceUsage().maxRSS,formal:false,formal_readiness:'BLOCKED_C2_CONTINUITY_AND_B3'}));
})().catch(e=>{console.error(e);process.exitCode=1});
