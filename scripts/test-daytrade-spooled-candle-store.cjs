'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createSpooledCandleStore}=require('../lib/daytrade-spooled-candle-store');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+30000;while(!fn()){if(Date.now()>end)throw Error('TEST_TIMEOUT');await sleep(20);}}
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'candle-spool-test-')),stores=[];
 const row=i=>({symbol:String(1000+Math.floor(i/180)),candleTime:new Date(Date.UTC(2026,9,2,1)+i%180*60000).toISOString(),candleSeenAt:new Date().toISOString(),close:100,volume:i,raw:{provider:'fixture',retained:true}});
 const fake=()=>{const w=new EventEmitter();w.sent=[];w.postMessage=m=>w.sent.push(m);w.unref=()=>{};w.terminate=()=>{};return w;};
 const create=opts=>{const s=createSpooledCandleStore({retentionMs:8*3600000,...opts});stores.push(s);return s;};
 try{
  const w=fake(),file=path.join(root,'replay.json'),s=create({file,spawn:()=>w,saveTimeoutMs:60000});
  const rows=Array.from({length:30001},(_,i)=>row(i));
  const started=Date.now();s.merge(rows);s.flush();
  assert.equal(s.status().ok,true);assert.equal(s.status().pendingRows,0);assert.equal(s.status().queuedRows,30001);assert.equal(w.sent.length,1);
  const revision={...rows[0],volume:999999,raw:{provider:'fixture',retained:'revision'}};s.merge([revision]);s.flush();
  assert.equal(s.status().queuedRows,30002);
  const receiveMs=Date.now()-started;
  // Stop with every worker batch unacknowledged. A new real worker must recover
  // the entire snapshot and the later revision, then remove only saved files.
  await s.stop();
  // Simulate a committed cache write whose ACK was lost before restart.
  fs.writeFileSync(file,JSON.stringify({updatedAt:new Date().toISOString(),candles:rows.slice(0,5000)}));
  const recovered=create({file});
  await until(()=>recovered.status().savedCount===30001&&recovered.status().queuedFiles===0);
  assert.equal(recovered.status().persistenceGap,false);
  const saved=JSON.parse(fs.readFileSync(file)).candles;
  assert.equal(saved.length,30001);assert.deepEqual(saved.find(r=>r.symbol===revision.symbol&&r.candleTime===revision.candleTime),revision);
  const expected=new Map(rows.map(r=>[r.symbol+'|'+r.candleTime,r]));expected.set(revision.symbol+'|'+revision.candleTime,revision);
  for(const r of saved)assert.deepEqual(r,expected.get(r.symbol+'|'+r.candleTime));
  assert.equal(fs.readdirSync(file+'.pending').length,0);
  const tw=fake(),t=create({file:path.join(root,'timeout.json'),spawn:()=>tw,batchRows:1,saveTimeoutMs:20});
  t.merge([row(0),row(1)]);await sleep(40);assert.equal(t.status().reason,'CANDLE_SAVE_TIMEOUT');
  tw.emit('message',{sequence:tw.sent[0].sequence,ok:true,count:1});assert.equal(t.status().persistenceGap,true);
  tw.emit('message',{sequence:tw.sent[1].sequence,ok:true,count:2});assert.equal(t.status().persistenceGap,false);
  const bw=fake(),barrier=create({file:path.join(root,'barrier.json'),spawn:()=>bw,batchRows:5,saveTimeoutMs:20});
  barrier.merge([row(0)]);barrier.flush();barrier.merge([row(1)]);
  await sleep(40);assert.equal(barrier.status().timeoutBarrier,2);
  barrier.merge([row(2)]); // New traffic must not keep an old resolved timeout latched.
  bw.emit('message',{sequence:bw.sent[0].sequence,ok:true,count:1});assert.equal(barrier.status().persistenceGap,true);
  bw.emit('message',{sequence:bw.sent[1].sequence,ok:true,count:2});assert.equal(barrier.status().persistenceGap,false);assert.equal(barrier.status().pendingRows,1);
  const cw=fake(),c=create({file:path.join(root,'cap.json'),spawn:()=>cw,batchRows:1,maxSpoolFiles:1});
  c.merge([row(0),row(1)]);assert.equal(c.status().reason,'CANDLE_SPOOL_CAPACITY');assert.equal(c.status().persistenceGap,true);assert.equal(fs.readdirSync(path.join(root,'cap.json.pending')).length,1);
  const mw=fake(),m=create({file:path.join(root,'mismatch.json'),spawn:()=>mw,batchRows:1});m.merge([row(0)]);mw.emit('message',{sequence:999,ok:true,count:1});assert.equal(m.status().reason,'CANDLE_SAVE_ACK_MISMATCH');assert.equal(fs.readdirSync(path.join(root,'mismatch.json.pending')).length,1);
  const corrupt=path.join(root,'corrupt.json');fs.mkdirSync(corrupt+'.pending');fs.writeFileSync(path.join(corrupt+'.pending','000000000001-1.json.tmp'),'partial');
  assert.equal(create({file:corrupt}).status().reason,'CANDLE_SPOOL_INCOMPLETE_FILE');
  const broken=path.join(root,'broken.json');fs.mkdirSync(broken+'.pending');fs.writeFileSync(path.join(broken+'.pending','000000000001-1.json'),'{bad');
  const brokenStore=create({file:broken});await until(()=>brokenStore.status().persistenceGap);assert.equal(brokenStore.status().reason,'CANDLE_SAVE_FAILED');assert.equal(fs.readdirSync(broken+'.pending').length,1);
  console.log(JSON.stringify({pass:true,burst_rows:30001,receive_ms:receiveMs,checks:['busy_worker_bounded_memory','restart_replays_all_rows_and_revision','real_worker_disk_readback','successful_ack_removes_only_saved_batches','late_ack_drains_timeout','disk_capacity_explicit_failure','wrong_ack_retains_evidence','incomplete_spool_fails_closed']}));
 }finally{for(const s of stores)await s.stop();assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
