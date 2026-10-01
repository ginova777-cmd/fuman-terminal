const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createCollectorDetectionHost}=require('../lib/daytrade-collector-detection-host');
(async()=>{
for(const target of ['WORKER_BOOT','SEND_WARMUP','DECODE_BASELINE','APPLY_BASELINE']){
 const worker=new EventEmitter();worker.connected=true;worker.stderr={resume(){}};worker.disconnect=()=>worker.connected=false;worker.send=()=>{};
 let clock=0;const statuses=[],timers=[];
 const host=createCollectorDetectionHost({loadWarmup:async()=>({baseline:{tradeDate:'2026-10-01',activeSymbols:[{symbol:'2330'}],history:{rows:[]}},jsonInputs:[],initialQuotes:[],initialCandles:[]}),mergeQuote:(a,b)=>({...a,...b}),spawn:()=>worker,now:()=>clock,setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimer(){},onStatus:s=>statuses.push(s)});
 await host.start();assert.equal(timers[0].ms,30000);
 if(target!=='WORKER_BOOT')worker.emit('message',{type:'daytrade_detection_ready'});
 if(['DECODE_BASELINE','APPLY_BASELINE'].includes(target))worker.emit('message',{type:'daytrade_detection_warmup_stage',stage:target});
 clock=30000;timers[0].fn();const failure=statuses.at(-1);
 assert.equal(failure.reason,'DETECTION_WORKER_START_TIMEOUT');assert.equal(failure.startup_stage,target);assert.equal(failure.startup_elapsed_ms,30000);assert.equal(failure.warmup_counts.symbols,1);assert.equal(worker.connected,false);
 assert(!JSON.stringify(statuses).includes('2330'));host.stop();
}
const channel=new EventEmitter(),messages=[];channel.connected=true;channel.send=m=>messages.push(m);
const endpoint=process.platform==='win32'?'\\\\.\\pipe\\fuman-startup-test-'+process.pid:require('node:path').join(require('node:os').tmpdir(),'fuman-startup-'+process.pid+'.sock');
const worker=await require('./run-daytrade-memory-worker').runWorker({channel,endpoint});
try{
 const baseline={tradeDate:'2026-10-01',calendar:{tradeDate:'2026-10-01',isTradingDay:true},identity:{trade_date:'2026-10-01',canonical_run_id:'isolated'},activeSymbols:[{symbol:'2330'}],dailyVolumeMap:new Map(),supplementalMaps:{}};
 channel.emit('message',{type:'daytrade_detection_warmup',baselineEncoding:'map-metadata-v1',baseline:require('../lib/daytrade-baseline-transfer').encodeBaseline(baseline),jsonInputs:[]});
 assert.deepEqual(messages.map(m=>m.stage||m.type),['daytrade_detection_ready','DECODE_BASELINE','APPLY_BASELINE','daytrade_detection_warmup_ack']);
}finally{await worker.stop();}
console.log('PASS: startup timeout retains exact phase and bounded counts; deadline unchanged; no quote payload logged');
})().catch(e=>{console.error(e);process.exitCode=1;});
