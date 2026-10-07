'use strict';
const fs=require('node:fs'),path=require('node:path'),{Worker}=require('node:worker_threads');
const c=JSON.parse(fs.readFileSync(process.argv[2])),events=[],heapSamples=[];const start=performance.now();let error=null,sampling=false;
const w=new Worker(path.join(__dirname,'mother-evidence-capacity-probe-worker.cjs'),{workerData:c,resourceLimits:{maxOldGenerationSizeMb:128}});
const limits=w.resourceLimits;
const timer=setInterval(async()=>{if(sampling)return;sampling=true;try{const h=await w.getHeapStatistics();heapSamples.push({ms:performance.now()-start,...h});}catch{}finally{sampling=false;}},10);
w.on('message',e=>events.push(e));w.on('error',e=>{error={code:e.code,message:e.message};});
w.on('exit',code=>{clearInterval(timer);const heapValues=[...heapSamples.map(h=>h.used_heap_size),...events.map(e=>e.memory.heap.heapUsed)];const result={case:c,worker_resource_limits:limits,elapsed_ms:performance.now()-start,worker_exit_code:code,error,status:error||!events.some(e=>e.stage==='complete'&&e.status==='PASS')?'BLOCKED':'PASS',peak_heap_observed_bytes:Math.max(0,...heapValues),heap_peak_scope:'maximum observed via Worker.getHeapStatistics and phase boundaries; lower bound, not guaranteed instantaneous peak',heap_samples:heapSamples,events,process_peak_rss_bytes:process.resourceUsage().maxRSS*1024,process_peak_rss_scope:'isolated runner + capacity worker + optional evidence worker, not production Collector'};fs.writeFileSync(path.join(c.dir,'result.json'),JSON.stringify(result,null,2));});
