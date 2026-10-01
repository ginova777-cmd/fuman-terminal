'use strict';
const {encodeBaseline}=require('./daytrade-baseline-transfer');
const path=require('path');
const {fork}=require('child_process');
const {createDetectionBridge}=require('./daytrade-detection-bridge');
function createCollectorDetectionHost({loadWarmup,mergeQuote,spawn=fork,setEvery=setInterval,clearEvery=clearInterval,setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,onStatus=()=>{},workerPath=path.join(__dirname,'../scripts/run-daytrade-memory-worker.js')}){
 let worker=null,bridge=null,timer=null,starting=null,stopped=false,ready=false,failed=false,startupTimer=null;
 const buffer=require('./daytrade-warmup-buffer').createWarmupBuffer({mergeQuote});
 let transportStatus=null;
 let stage='NOT_STARTED',startedAt=null,stageAt=null;const stages=[];let sizes={};
 function diagnostics(){return {startup_stage:stage,startup_elapsed_ms:startedAt===null?null:now()-startedAt,stage_elapsed_ms:stageAt===null?null:now()-stageAt,startup_stages:[...stages],warmup_counts:{...sizes}};}
 function progress(next){stage=next;stageAt=now();stages.push({stage:next,elapsed_ms:now()-startedAt});if(stages.length>12)stages.shift();onStatus({ok:false,reason:'DETECTION_STARTING',...diagnostics()});}
 function fail(reason){if(failed||stopped)return;failed=true;ready=false;clearTimer(startupTimer);buffer.clear();bridge?.stop();if(timer){clearEvery(timer);timer=null;}onStatus({ok:false,reason,...diagnostics()});if(worker?.connected)worker.disconnect();}
 function start(){
  if(starting)return starting;
  starting=(async()=>{
   startedAt=now();progress('LOAD_WARMUP');
   const warmup=await loadWarmup();if(stopped||failed)return;
   if(!warmup?.baseline||!Array.isArray(warmup.jsonInputs))throw Error('COLLECTOR_WARMUP_INVALID');
   sizes={symbols:warmup.baseline.activeSymbols.length,json_inputs:warmup.jsonInputs.length,history_rows:warmup.baseline.history?.rows?.length||0,initial_quotes:warmup.initialQuotes?.length||0,initial_candles:warmup.initialCandles?.length||0};
   progress('WORKER_BOOT');
   worker=spawn(workerPath,[],{windowsHide:true,serialization:'advanced',stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,FUGLE_COLLECTOR_ROLE:'daytrade'}});
   // Drain diagnostics so a full stderr pipe cannot block detection. Report only
   // bounded structured status; raw rows and credentials are never logged here.
   worker.stderr?.resume();
   startupTimer=setTimer(()=>fail('DETECTION_WORKER_START_TIMEOUT'),30000);
   worker.once('error',()=>fail('DETECTION_WORKER_START_FAILED'));
   worker.once('exit',()=>fail('DETECTION_WORKER_EXITED'));
   bridge=createDetectionBridge({send:(batch,callback)=>worker.send(batch,callback),mergeQuote,onFault:fail});
   bridge.configure({tradeDate:warmup.baseline.tradeDate,symbols:warmup.baseline.activeSymbols.map(row=>row.symbol)});
   bridge.updateTransport(transportStatus);
   const buffered=buffer.drain({initialCandles:warmup.initialCandles||[]});
   bridge.ingest(warmup.initialQuotes||[]);bridge.ingest(buffered.quotes);bridge.ingestCandles(buffered.candles);
   worker.on('message',message=>{
    if(stopped||failed)return;
    if(message?.type==='daytrade_detection_ready'){
     progress('ENCODE_WARMUP');
     const {initialQuotes,initialCandles,...workerWarmup}=warmup;
     const baseline=encodeBaseline(workerWarmup.baseline);progress('SEND_WARMUP');
     worker.send({type:'daytrade_detection_warmup',...workerWarmup,baseline,baselineEncoding:'map-metadata-v1'},error=>{if(error)fail('DETECTION_WARMUP_SEND_FAILED');});
    }else if(message?.type==='daytrade_detection_warmup_stage'){
     if(['DECODE_BASELINE','APPLY_BASELINE'].includes(message.stage))progress(message.stage);
    }else if(message?.type==='daytrade_detection_warmup_ack'){
     if(message.tradeDate!==warmup.baseline.tradeDate){fail('DETECTION_WARMUP_ACK_DATE_MISMATCH');return;}
     if(ready)return;clearTimer(startupTimer);ready=true;progress('FEED_CONNECTED');timer=setEvery(()=>bridge.flush(),1000);bridge.flush();onStatus({ok:true,status:'MEMORY_FEED_CONNECTED',...diagnostics()});
    }else if(message?.type==='daytrade_detection_ack')bridge.acknowledge(message);
    else if(message?.type==='daytrade_detection_error')fail(message.error||'DETECTION_WORKER_INPUT_FAILED');
   });
  })().catch(error=>{fail(error.message||'MEMORY_WARMUP_FAILED');throw error;});
  return starting;
 }
 function ingest(rows,kind){if(stopped||failed)return;try{(bridge||buffer)[kind](rows);}catch(error){fail(error.message);}}
 return {start,updateTransport(status){transportStatus=structuredClone(status);bridge?.updateTransport(status);},ingest:rows=>ingest(rows,'ingest'),ingestCandles:rows=>ingest(rows,'ingestCandles'),status:()=>({ready,failed,warmup_buffer:buffer.status(),bridge:bridge?.status()||null}),stop(){stopped=true;ready=false;clearTimer(startupTimer);buffer.clear();bridge?.stop();if(timer)clearEvery(timer);timer=null;if(worker?.connected)worker.disconnect();}};
}
module.exports={createCollectorDetectionHost};
