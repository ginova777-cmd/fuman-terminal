'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{Worker}=require('node:worker_threads'),{EventEmitter}=require('node:events');
const {createAsyncCandleStore}=require('../lib/daytrade-async-candle-store');
async function main(){
 const row=(symbol,volume)=>({symbol,candleTime:new Date().toISOString(),candleSeenAt:new Date().toISOString(),volume,extra:{preserved:true}});
 const a=row('1101',1),b=row('1102',2),revision={...b,volume:3};
 const sent=[],fake=new EventEmitter();fake.postMessage=x=>sent.push(x);fake.terminate=()=>{};fake.unref=()=>{};
 let alarm;const queue=createAsyncCandleStore({file:'unused',spawn:()=>fake,setTimer:callback=>{alarm=callback;},clearTimer:()=>{}});
 queue.merge([a]);queue.merge([b]);queue.merge([revision]);assert.equal(sent.length,1);
 fake.emit('message',{sequence:1,ok:true,count:1});assert.deepEqual(sent[1].rows,[revision]);
 alarm();assert.equal(queue.status().reason,'CANDLE_SAVE_TIMEOUT');
 fake.emit('message',{sequence:2,ok:true,count:2});queue.merge([a]);assert.equal(sent.length,2);assert.equal(queue.status().persistenceGap,true);
 const capWorker=new EventEmitter();capWorker.postMessage=()=>{};capWorker.unref=()=>{};
 const capped=createAsyncCandleStore({file:'unused',maxPendingRows:1,spawn:()=>capWorker,setTimer:()=>null,clearTimer:()=>{}});
 capped.merge([a]);capped.merge([b,{...a,symbol:'1103'}]);assert.equal(capped.status().reason,'CANDLE_SAVE_QUEUE_CAPACITY');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mother-candle-save-')),file=path.join(root,'candles.json');
 let store;
 try{
  await new Promise((resolve,reject)=>{
   const deadline=setTimeout(()=>reject(Error('ROUNDTRIP_TIMEOUT')),5000);
   store=createAsyncCandleStore({file,retentionMs:8*3600000,onStatus:s=>{if(!s.ok){clearTimeout(deadline);reject(Error(s.reason));}else if(s.savedCount===2){clearTimeout(deadline);resolve();}}});
   store.merge([a,b]);
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).candles,[a,b]);
 }finally{await store?.stop();assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
 let ticks=0,slow;const heartbeat=setInterval(()=>ticks++,5);
 try{
  await new Promise((resolve,reject)=>{
   slow=createAsyncCandleStore({file:'unused',saveTimeoutMs:150,spawn:()=>new Worker("const {parentPort}=require('node:worker_threads');parentPort.on('message',m=>{const until=Date.now()+500;while(Date.now()<until){};parentPort.postMessage({sequence:m.sequence,ok:true,count:1});});",{eval:true}),onStatus:s=>{if(s.reason==='CANDLE_SAVE_TIMEOUT')resolve();else if(!s.ok)reject(Error(s.reason));}});
   slow.merge([a]);
  });
  assert(ticks>=5,'Main event loop blocked by persistence');assert.equal(slow.status().persistenceGap,true);
 }finally{clearInterval(heartbeat);await slow?.stop();}
 console.log(JSON.stringify({pass:true,scope:'isolated_candle_persistence',checks:['one_inflight','latest_revision_all_fields','late_ack_no_false_recovery','bounded_queue','actual_disk_readback','blocked_worker_main_loop_alive'],heartbeat_ticks:ticks,production_active:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});

