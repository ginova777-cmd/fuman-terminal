'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createBridge,resumeBridge,ns}=require('../lib/mother-evidence-bridge.cjs');
const {createSpooledCandleStore}=require('../lib/daytrade-spooled-candle-store');
const {recover}=require('../lib/mother-evidence-recovery.cjs');
const {audit}=require('../lib/mother-change-evidence-audit.cjs');
const out=path.resolve(process.argv[2]||'outputs/safety-test-'+Date.now());fs.mkdirSync(out,{recursive:true});
const bridges=[],stores=[],checks=[],measurements=[];const pid=process.pid;
const limits={maxEvents:1024,maxBytes:4*1024*1024,maxBatchEvents:128,maxBatchBytes:512*1024,maxAgeMs:15000,minFreeBytes:1024*1024,maxDiskBytes:64*1024*1024};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=10000){const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw Error('TEST_TIMEOUT');await sleep(5);}}
function config(name,opts={}){const c={dir:path.join(out,name),kind:'quote',epoch:crypto.randomUUID(),producerVersion:'c2-isolation',limits,...opts};const cache=path.join(out,name+'-baseline.json');fs.writeFileSync(cache,JSON.stringify(c.kind==='quote'?{quotes:[]}:{candles:[]}));c.recovery=recover({cacheFile:cache,kind:c.kind,targetEpoch:c.epoch,targetDir:c.dir,out:path.join(out,name+'-recovery'),previousDir:c.previousDir||null,bootstrap:!c.previousDir});return c;}
function create(name,opts={}){const b=createBridge(config(name,opts));bridges.push(b);return b;}
const row=(i=1)=>({code:'2330',market:'TSE',exchangeTime:'2026-10-06T01:00:00Z',quoteSeenAt:'2026-10-06T01:00:00Z',tradeSerial:i,close:100+i,tradeVolume:i,receivedAt:'2026-10-06T01:00:01Z',quoteSource:'fugle-ws-trades'});
const candle=i=>({symbol:String(1000+i),market:'TSE',tradeDate:'2026-10-06',candleTime:'2026-10-06T01:00:00Z',candleSeenAt:new Date().toISOString(),open:100,high:101,low:99,close:100,volume:i,source:'websocket:candles',synthetic:false});
let primarySaves=0,heartbeats=0;
const heartbeat=setInterval(()=>heartbeats++,5);
function originalSave(b,token,rows,name='primary',overrides={}){
 const file=path.join(out,name+'.json'),start=ns();fs.writeFileSync(file,JSON.stringify(b.status().kind==='candle'?{candles:rows}:{quotes:rows}));const end=ns();primarySaves++;
 b.confirm(token,{ok:true,original_ack:true,cache_file:file,cache_started_ns:start,cache_finished_ns:end,rows_json:JSON.stringify(rows),...overrides});
}
async function main(){
 // C2: original cache save never waits for evidence durable prepare.
 const a=create('normal');await until(()=>a.status().ready);const token=a.begin([{merged:row()}]);originalSave(a,token,[row()]);await until(()=>a.status().committed_count===1);assert.equal(audit(path.join(out,'normal')).events,1);checks.push('A volatile intent before cache; durable committed later');
 assert.equal(process.pid,pid);checks.push('A main process unchanged');
 const slow=create('slow',{testOnly:{delayMs:800}});await until(()=>slow.status().ready);const ticks=heartbeats,t=Date.now();const st=slow.begin([{merged:row()}]);originalSave(slow,st,[row()],'slow-primary');
 for(let i=0;i<12;i++){fs.writeFileSync(path.join(out,'ws-quote-cache.json'),JSON.stringify(row(i)));primarySaves++;await sleep(10);}
 assert(heartbeats>ticks+5);assert(Date.now()-t<800);await until(()=>slow.status().committed_count===1);assert.equal(slow.status().state,'RUNNING');assert.equal(audit(path.join(out,'slow')).events,1);checks.push('B delayed durable prepare allowed only from original pre-cache intent; primary continues');
 const full=create('full',{limits:{...limits,maxEvents:1},testOnly:{delayMs:500}});full.begin([{merged:row()}]);assert.equal(full.begin([{merged:row(2)}]),null);await until(()=>full.status().state==='BLOCKED');originalSave(full,null,[row(3)],'full-primary');assert.equal(full.status().reason,'EVIDENCE_QUEUE_COUNT');assert.equal(full.status().dropped_count,0);assert(full.status().stop_receipt_saved);checks.push('C queue full explicit stop with pending retained');
 const disk=create('disk',{testOnly:{diskFailure:true}});const dt=disk.begin([{merged:row()}]);originalSave(disk,dt,[row()],'disk-primary');await until(()=>disk.status().state==='BLOCKED');assert.equal(disk.status().reason,'ENOSPC_INJECTED');checks.push('D injected disk error does not fail original save');
 const hash=create('hash');await until(()=>hash.status().ready);const ht=hash.begin([{merged:row()}]);await until(()=>hash.status().prepared_token===ht);originalSave(hash,ht,[row()],'hash-primary',{rows_json:JSON.stringify([row(9)])});await until(()=>hash.status().state==='BLOCKED');assert.equal(hash.status().reason,'CONFIRMED_CONTENT_HASH_MISMATCH');checks.push('E changed payload mismatch no commit');
 const sequence=create('sequence');sequence.begin([{merged:row()}]);sequence.confirm('wrong-token',{ok:true});await until(()=>sequence.status().state==='BLOCKED');assert.equal(sequence.status().reason,'UNKNOWN_CACHE_ACK');checks.push('E unknown sequence no commit');
 const cf=path.join(out,'control.json'),control=create('control',{controlFile:cf});await until(()=>control.status().ready);fs.writeFileSync(cf,JSON.stringify({command:'STOP',epoch:control.status().epoch}));await until(()=>control.status().state==='BYPASSED');assert.equal(control.begin([{merged:row()}]),null);originalSave(control,null,[row()],'control-primary');assert.equal(process.pid,pid);assert(control.status().stop_receipt_saved);checks.push('F runtime STOP no Collector restart');
 assert.throws(()=>resumeBridge(control,config('invalid-resume',{epoch:control.status().epoch})),/NEW_EPOCH/);
 const resumed=resumeBridge(control,config('resumed',{previousDir:path.join(out,'control')}));bridges.push(resumed);await until(()=>resumed.status().ready);const continuity=JSON.parse(fs.readFileSync(path.join(out,'resumed','continuity.json')));assert.equal(continuity.continuous,false);assert.equal(continuity.previous_epoch,control.status().epoch);checks.push('G re-enable new epoch explicit gap, old evidence preserved');
 const aged=create('aged',{limits:{...limits,maxAgeMs:60},testOnly:{delayMs:1000}});aged.begin([{merged:row()}]);await until(()=>aged.status().state==='BLOCKED');assert.equal(aged.status().reason,'EVIDENCE_BACKLOG_AGE');checks.push('oldest backlog safety bound');
 const crashed=create('crashed',{testOnly:{crashBeforePrepare:true}});crashed.begin([{merged:row()}]);await until(()=>crashed.status().state==='FAILED');assert(crashed.status().stop_receipt_saved);originalSave(crashed,null,[row()],'crash-primary');checks.push('worker exit FAILED and primary continues');
 const bytes=create('bytes',{limits:{...limits,maxBytes:50}});assert.equal(bytes.begin([{merged:row()}]),null);await until(()=>bytes.status().state==='BLOCKED');checks.push('bounded serialized queue bytes');
 const cannotReceipt=create('receipt-failure');await until(()=>cannotReceipt.status().ready);fs.writeFileSync(path.join(out,'receipt-failure.stops'),'not a directory');const failedStop=cannotReceipt.stop('OPERATOR_STOP');assert.equal(cannotReceipt.status().state,'STOPPING');await failedStop;assert.equal(cannotReceipt.status().state,'FAILED');assert.equal(cannotReceipt.status().stop_receipt_saved,false);assert(cannotReceipt.status().stop_receipt_error);originalSave(cannotReceipt,null,[row()],'receipt-failure-primary');checks.push('STOPPING observable; stop receipt failure FAILED not false durable success');
 const many=create('many',{limits:{...limits,maxBatchEvents:1}});assert.equal(many.begin([{merged:row()},{merged:row(2)}]),null);await until(()=>many.status().state==='BLOCKED');checks.push('bounded batch count before serialization');
 // Actual save worker + spool. Slow evidence cannot delay original ACK.
 const cfile=path.join(out,'real-candle-cache.json'),cc=config('candle-worker',{kind:'candle',controlFile:path.join(out,'candle-control.json'),testOnly:{delayMs:1500}});
 const store=createSpooledCandleStore({file:cfile,retentionMs:86400000,evidence:cc,flushDelayMs:60000});stores.push(store);
 const cs=Date.now();store.merge([candle(1)]);store.flush();await until(()=>store.status().savedCount===1&&store.status().queuedFiles===0);
 const ackMs=Date.now()-cs;assert(ackMs<1500);assert.equal(store.status().persistenceGap,false);assert.equal(JSON.parse(fs.readFileSync(cfile)).candles.length,1);
 store.merge([candle(2)]);store.flush();await until(()=>store.status().savedCount===2);await until(()=>store.status().changeEvidence?.committed_count===2);fs.writeFileSync(cc.controlFile,JSON.stringify({command:'STOP',epoch:cc.epoch}));await until(()=>store.status().changeEvidence?.state==='BYPASSED');assert.equal(store.status().persistenceGap,false);checks.push('real Candle ACK precedes slow evidence; subsequent K saved');measurements.push({case:'slow candle evidence',injected_delay_ms:1500,original_ack_ms:ackMs});
 store.merge([candle(3)]);store.flush();await until(()=>store.status().savedCount===3);assert.equal(store.status().persistenceGap,false);checks.push('Candle main cache continues after independent evidence STOP');
 // Throughput/capacity experiment; no claim of natural throughput or SLA.
 for(const kind of ['quote','candle']){
  const b=create('bench-'+kind,{kind});await until(()=>b.status().ready);const begin=Date.now();let last=null;
  for(let batch=0;batch<12;batch++){
   const rows=Array.from({length:32},(_,i)=>kind==='quote'?{...row(batch*32+i+1),code:String(1000+i)}:candle(batch*32+i));
   const changes=rows.map((merged,i)=>({previous:kind==='quote'?last?.[i]:undefined,merged}));const tok=b.begin(changes);assert(tok);originalSave(b,tok,rows,'bench-'+kind);await until(()=>!b.status().worker_busy);last=rows;
  }
  const elapsed=Date.now()-begin,dir=path.join(out,'bench-'+kind),files=fs.readdirSync(dir);const sums={prepare:0,saved:0,commit:0};for(const name of files)for(const type of Object.keys(sums))if(name.endsWith('.'+type+'.json'))sums[type]+=fs.statSync(path.join(dir,name)).size;
  assert.equal(b.status().committed_count,384);measurements.push({kind,events:384,elapsed_ms:elapsed,events_per_second:384/(elapsed/1000),evidence_bytes:sums,average_event_bytes:Object.values(sums).reduce((a,b)=>a+b,0)/384,average_batch_bytes:Object.fromEntries(Object.entries(sums).map(([k,v])=>[k,v/12])),worker:b.status().worker_metrics});checks.push(kind+' bounded worker benchmark/replay');assert.equal(audit(dir).events,384);
 }
 const savedNatural=process.argv[3];
 if(savedNatural)for(const kind of ['quote','candle']){
  const file=path.join(savedNatural,kind+'-cache.json'),bytes=fs.readFileSync(file);
  if(bytes.length>8*1024*1024)throw Error('NATURAL_FIXTURE_LIMIT');
  const rows=JSON.parse(bytes)[kind==='quote'?'quotes':'candles'].slice(0,128),b=create('natural-'+kind,{kind});await until(()=>b.status().ready);const start=Date.now();
  for(let offset=0;offset<rows.length;offset+=32){const part=rows.slice(offset,offset+32),tok=b.begin(part.map(merged=>({merged})));assert(tok);originalSave(b,tok,part,'natural-'+kind);await until(()=>!b.status().worker_busy);}
  const dir=path.join(out,'natural-'+kind),sizes={prepare:0,saved:0,commit:0};for(const name of fs.readdirSync(dir))for(const type of Object.keys(sizes))if(name.endsWith('.'+type+'.json'))sizes[type]+=fs.statSync(path.join(dir,name)).size;
  assert.equal(audit(dir).events,rows.length);measurements.push({kind:'saved-natural-'+kind,mode:'offline sampled payload; not live WS',source_file:file,source_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),events:rows.length,elapsed_ms:Date.now()-start,evidence_bytes:sizes,average_event_bytes:Object.values(sizes).reduce((a,b)=>a+b,0)/rows.length,average_batch_bytes:Object.fromEntries(Object.entries(sizes).map(([k,v])=>[k,v/(rows.length/32)])),worker:b.status().worker_metrics});checks.push('saved natural '+kind+' bounded payload capacity');
 }
 const report={status:'PHASE1_C2_SAFETY_OFFLINE_VERIFIED',formal_shadow:'NO_GO',phase2:'NOT_AUTHORIZED',mode:'ISOLATED_SYNTHETIC_EVENTS_AND_REAL_FILE_WORKERS',checks,measurements,primary_saves:primarySaves,heartbeat_ticks:heartbeats,pid_unchanged:pid===process.pid,intent_order:'PRE_CACHE_INTENT_VOLATILE before original save; durability later without primary wait',natural_acceptance:false};
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{clearInterval(heartbeat);for(const b of bridges)await b.stop('TEST_FINISHED');for(const s of stores)await s.stop();});
