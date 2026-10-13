'use strict';
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
if(!isMainThread){
 require(workerData.segmentBinding?'./mother-pool-verified-trade-window.cjs':'./mother-pool-trade-input').collect(workerData).then(async result=>{
  parentPort.postMessage({...result,worker_memory_at_finish:process.memoryUsage()});
 }).catch(error=>parentPort.postMessage({worker_error:error.message}));
}
async function collect(args){
 if(!Number.isSafeInteger(args.maxElapsedMs)||args.maxElapsedMs<1)throw Error('TRADE_INPUT_DEADLINE_REQUIRED');
 const started=performance.now();
 const worker=new Worker(__filename,{workerData:args,resourceLimits:{maxOldGenerationSizeMb:128}});
 let timer;
 try{
  return await new Promise(resolve=>{
   let settled=false;
   const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};
   const gap=reason=>({tradesBySymbol:{},receipts:{},gaps:Object.fromEntries(args.symbols.map(s=>[s,reason])),continuity_verified:false,resources:{elapsed_ms:performance.now()-started}});
   timer=setTimeout(()=>finish(gap('TRADE_INPUT_HARD_TIMEOUT')),args.maxElapsedMs);
   worker.once('message',r=>finish(r.worker_error?gap('TRADE_INPUT_WORKER_ERROR:'+r.worker_error):r));
   worker.once('error',e=>finish(gap('TRADE_INPUT_WORKER_FAILED:'+e.code)));
   worker.once('exit',()=>finish(gap('TRADE_INPUT_WORKER_EXIT_WITHOUT_RESULT')));
  });
 }finally{clearTimeout(timer);await worker.terminate();}
}
module.exports={collect};
