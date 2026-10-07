'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createEvidence,difference,sha,projection,commitAck}=require('../lib/mother-change-evidence.cjs');
const {mergeFugleQuoteState}=require('../lib/fugle-websocket-quotes');
const {createSpooledCandleStore}=require('../lib/daytrade-spooled-candle-store');
const {audit}=require('../lib/mother-change-evidence-audit.cjs');
const {spawnSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mp-phase1-')),handles=[],stores=[],checks=[];
const now=()=>Date.parse('2026-10-06T05:00:00Z');
const candle=(minute=0,extra={})=>({symbol:'2330',market:'TSE',tradeDate:'2026-10-06',candleTime:new Date(Date.UTC(2026,9,6,1,minute)).toISOString(),candleSeenAt:new Date().toISOString(),open:100,high:101,low:99,close:100,volume:10,source:'websocket:candles',synthetic:false,volumeStrategyUsable:true,...extra});
function create(name,kind='candle',opts={}){const x=createEvidence({dir:path.join(root,name),kind,producerVersion:'isolation-v1',now,...opts});handles.push(x);return x;}
function record(x,previous,merged,kind='candle'){
 const b=x.prepare([{previous,merged}]);if(!b)return null;
 const file=path.join(root,'cache-'+path.basename(x.dir)+'.json'),payload=kind==='candle'?{candles:[merged]}:{quotes:[merged]};
 fs.writeFileSync(file,JSON.stringify(payload));const ack=x.persisted(b,file,payload);assert(ack,x.status().reason);assert(x.commit(ack),x.status().reason);return b;
}
function pass(name,fn){fn();checks.push(name);}
async function until(fn){const end=Date.now()+15000;while(!fn()){if(Date.now()>end)throw Error('TEST_TIMEOUT');await new Promise(r=>setTimeout(r,20));}}
async function main(){
 const x=create('candles');let a=candle();
 pass('new minute',()=>assert.equal(record(x,null,a).events[0].operation,'INSERT'));
 let b={...a,close:101};pass('same minute revision',()=>assert.equal(record(x,a,b).events[0].revision,2));
 pass('newer minute',()=>record(x,null,candle(10)));
 let c={...b,volume:20};pass('older minute revision',()=>assert.equal(record(x,b,c).events[0].revision,3));
 pass('exact duplicate',()=>assert.equal(x.prepare([{previous:c,merged:{...c}}]),null));
 pass('received-only candle',()=>assert.equal(x.prepare([{previous:c,merged:{...c,candleSeenAt:'2026-10-06T04:00:00Z'}}]),null));
 let invalid={...c,volumeStrategyUsable:false};pass('quality valid to invalid',()=>assert.equal(record(x,c,invalid).events[0].operation,'QUALITY_CHANGE'));
 pass('quality invalid to valid',()=>assert.equal(record(x,invalid,c).events[0].operation,'QUALITY_CHANGE'));
 pass('retention and metrics',()=>{const s=x.status();assert.equal(s.event_count,6);assert.equal(s.latest_committed_sequence,6);assert.equal(s.backlog_event_count,0);assert.equal(s.unconsumed_event_count,6);assert.equal(s.gc_status,'DISABLED_NO_CONSUMER_ACK');assert(s.bytes>0);assert(s.changes_committed_per_sec>0);assert.equal(s.duplicate_replay_count,2);});
 const oldEpoch=x.epoch;x.close();const restarted=create('candles');pass('clean restart durable sequence epoch revision',()=>{assert.notEqual(restarted.epoch,oldEpoch);const batch=record(restarted,c,{...c,close:102});assert.equal(batch.sequence,7);assert.equal(batch.events[0].revision,6);});
 pass('exclusive owner',()=>assert.throws(()=>create('candles'),/OWNER_LOCKED/));
 pass('replay audit reconstructs old-minute revision',()=>{const result=audit(restarted.dir);assert.equal(result.events,7);assert.equal(result.final.get('TSE|2330|2026-10-06|2026-10-06T01:00:00.000Z').payload.close,102);});
 pass('actual child exits with prepare only and no false commit',()=>{
  const dir=path.join(root,'process-exit');
  const program=`const {createEvidence}=require(${JSON.stringify(require.resolve('../lib/mother-change-evidence.cjs'))});const e=createEvidence({dir:${JSON.stringify(dir)},kind:'candle',producerVersion:'crash-child'});e.prepare([{merged:${JSON.stringify(a)}}]);process.exit(91);`;
  const child=spawnSync(process.execPath,['-e',program]);assert.equal(child.status,91);assert(fs.existsSync(path.join(dir,'000000000001.prepare.json')));assert(!fs.existsSync(path.join(dir,'000000000001.commit.json')));assert.throws(()=>create('process-exit'),/OWNER_LOCKED/);
 });
 const saveFail=create('savefail');const prepared=saveFail.prepare([{merged:a}]);saveFail.fail('CACHE_SAVE_FAILED');pass('save failure no commit',()=>{assert(prepared);assert.equal(saveFail.status().latest_committed_sequence,0);assert.equal(saveFail.status().backlog_event_count,1);});
 const lost=create('lost');const lb=lost.prepare([{merged:a}]);const cache=path.join(root,'lostcache.json'),payload={candles:[a]};fs.writeFileSync(cache,JSON.stringify(payload));const la=lost.persisted(lb,cache,payload);lost.close();const lostRestart=create('lost');pass('ACK lost restart blocked',()=>{assert.equal(lostRestart.status().reason,'RECOVERY_REQUIRED_UNACKNOWLEDGED_BATCH');assert.equal(lostRestart.status().latest_committed_sequence,0);});
 pass('wrong evidence ACK refused',()=>assert.throws(()=>commitAck(lost.dir,{...la,batch_id:'wrong'}),/ACK_MISMATCH/));
 const commitFail=create('commitfail','candle',{fault:p=>{if(p==='before_commit')throw Error('INJECTED_COMMIT_FAILURE');}});const fb=commitFail.prepare([{merged:a}]);const fa=commitFail.persisted(fb,cache,payload);pass('cache saved commit failed',()=>{assert.equal(commitFail.commit(fa),null);assert.equal(commitFail.status().latest_committed_sequence,0);assert.equal(commitFail.status().failed_commit_count,1);});
 const gap=create('gap');record(gap,null,a);record(gap,a,b);gap.close();fs.unlinkSync(path.join(gap.dir,'000000000001.prepare.json'));pass('sequence gap',()=>assert.equal(create('gap').status().reason,'EVIDENCE_SEQUENCE_GAP'));
 const partialDir=path.join(root,'partial');fs.mkdirSync(partialDir);fs.writeFileSync(path.join(partialDir,'000000000001.prepare.json.tmp'),'partial');pass('partial evidence crash restart',()=>assert.equal(create('partial').status().reason,'EVIDENCE_PARTIAL_FILE'));
 const crash=create('crash','candle',{fault:p=>{if(p==='after_prepare')throw Error('CRASH_AFTER_PREPARE');}});crash.prepare([{merged:a}]);crash.close();pass('Collector crash after prepare',()=>assert.equal(create('crash').status().reason,'RECOVERY_REQUIRED_UNACKNOWLEDGED_BATCH'));
 const disk=create('disk','candle',{maxBytes:1});pass('disk capacity explicit blocked',()=>{assert.equal(disk.prepare([{merged:a}]),null);assert.equal(disk.status().reason,'EVIDENCE_DISK_BUDGET');});
 const mismatch=create('mismatch'),mb=mismatch.prepare([{merged:a}]);pass('cache readback mismatch',()=>{assert.equal(mismatch.persisted(mb,cache,{candles:[b]}),null);assert.equal(mismatch.status().reason,'CACHE_READBACK_HASH_MISMATCH');});
 const badHash=create('hash');record(badHash,null,a);badHash.close();const hp=path.join(badHash.dir,'000000000001.prepare.json');const corrupt=JSON.parse(fs.readFileSync(hp));corrupt.events[0].payload.close=999;fs.writeFileSync(hp,JSON.stringify(corrupt));pass('tampered payload restart blocked',()=>assert.equal(create('hash').status().reason,'PREPARE_HASH_MISMATCH'));
 const q=create('quotes','quote');let previous={};
 const trade=(serial,close=100,time='2026-10-06T01:00:00Z')=>({code:'2330',market:'TSE',quoteSource:'fugle-ws-trades',tradeSerial:serial,exchangeTime:time,quoteSeenAt:time,lastTradeTime:time,priceEventAt:time,receivedAt:time,close,tradeVolume:10,isSynthetic:false});
 function quote(incoming){const merged=mergeFugleQuoteState(previous,incoming),batch=record(q,previous,merged,'quote');previous=merged;return batch;}
 pass('new trade serial',()=>assert(quote(trade(100))));
 pass('same serial rejected no change',()=>assert.equal(quote(trade(100,999)),null));
 pass('old serial rejected no change',()=>assert.equal(quote(trade(99,999)),null));
 pass('new price',()=>assert(quote(trade(101,101,'2026-10-06T01:00:01Z')).events[0].changed_fields.market.includes('close')));
 pass('same price new serial ordering',()=>{const e=quote(trade(102,101,'2026-10-06T01:00:02Z')).events[0];assert(e.changed_fields.ordering.includes('tradeSerial'));assert(!e.changed_fields.market.includes('close'));});
 const aggregate={...trade(null,101,'2026-10-06T01:00:03Z'),quoteSource:'fugle-ws-aggregates',aggregateLastUpdated:'2026-10-06T01:00:03Z',high:102};
 pass('new aggregate',()=>assert(quote(aggregate)));
 pass('old aggregate rejected',()=>assert.equal(quote({...aggregate,exchangeTime:'2026-10-06T01:00:01Z',close:999}),null));
 pass('quote received only',()=>assert.equal(difference(previous,{...previous,receivedAt:'2026-10-06T02:00:00Z'},'quote').changed,false));
 pass('quote quality source',()=>assert.equal(record(q,previous,{...previous,isSynthetic:true},'quote').events[0].operation,'QUALITY_CHANGE'));
 const qe=q.epoch;q.close();pass('quote restart epoch',()=>assert.notEqual(create('quotes','quote').epoch,qe));
 // Original save worker baseline; asynchronous evidence integration is covered
 // by test-mother-evidence-safety.cjs, including late-prepare refusal.
 const file=path.join(root,'worker-cache.json'),dir=path.join(root,'worker-evidence');
 const store=createSpooledCandleStore({file,retentionMs:86400000,flushDelayMs:60000});stores.push(store);
 store.merge([a]);store.flush();await until(()=>store.status().savedCount===1&&store.status().queuedFiles===0);
 assert.equal(JSON.parse(fs.readFileSync(file)).candles[0].close,100);checks.push('original real worker cache baseline');
 store.merge([b]);store.flush();await until(()=>JSON.parse(fs.readFileSync(file)).candles[0].close===101);checks.push('original real worker revision baseline');
 console.log(JSON.stringify({pass:true,count:checks.length,checks}));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{for(const s of stores)await s.stop();for(const x of handles)try{x.close();}catch{};if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('UNSAFE_TEST_CLEANUP');fs.rmSync(root,{recursive:true,force:true});});
