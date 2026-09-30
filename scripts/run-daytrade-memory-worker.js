'use strict';
const {decodeBaseline}=require('../lib/daytrade-baseline-transfer');
const {createMemoryService}=require('../lib/daytrade-memory-service');
const {mergeFugleQuoteState}=require('../lib/fugle-websocket-quotes');
const detector=require('./run-daytrade-source-writer');
async function runWorker({channel=process,endpoint=process.env.FUMAN_MOTHER_POOL_PIPE||'\\\\.\\pipe\\fuman-mother-pool-v1'}={}){
 const service=createMemoryService({endpoint,mergeQuote:mergeFugleQuoteState,normalizeQuotes:detector.normalizeMemoryQuotes,evaluate:detector.evaluateMemoryState,buildIndicators:detector.buildMemoryIntradayIndicators,requireFeedLease:true});
 let initialized=false,tradeDate=null,symbols=[],lastSequence=0;
 const reply=message=>{if(channel.connected)channel.send(message);};
 const onMessage=message=>{
  try{
   if(message?.type==='daytrade_detection_warmup'){
    if(!Array.isArray(message.jsonInputs)||message.jsonInputs.length>300)throw Error('WARMUP_JSON_INPUTS_INVALID');
    if(message.baselineEncoding!=='map-metadata-v1')throw Error('WARMUP_ENCODING_REQUIRED');
    const baseline=decodeBaseline(message.baseline);
    const inputs=new Map(message.jsonInputs);
    service.warmup({...baseline,readMemoryJson:(file,fallback)=>{
     if(!inputs.has(file))throw Error('MEMORY_INPUT_NOT_PREFETCHED');
     const record=inputs.get(file);
     if(typeof record?.present!=='boolean')throw Error('MEMORY_INPUT_RECORD_INVALID');
     return record.present?structuredClone(record.value):fallback;
    }});
    tradeDate=baseline.tradeDate;symbols=baseline.activeSymbols.map(row=>row.symbol).sort();initialized=true;
    reply({type:'daytrade_detection_warmup_ack',tradeDate});return;
   }
   if(!['daytrade_detection_state','daytrade_detection_heartbeat'].includes(message?.type))return;
   if(!initialized)throw Error('WARMUP_BASELINE_NOT_AVAILABLE');
   if(!Number.isSafeInteger(message.sequence)||message.sequence<=lastSequence)throw Error('DETECTION_STATE_SEQUENCE_INVALID');
   service.updateTransport(message.transportStatus);
   if(message.type==='daytrade_detection_heartbeat'){
    service.touchFeed(message.tradeDate);lastSequence=message.sequence;
    reply({type:'daytrade_detection_ack',sequence:message.sequence});return;
   }
   if(message.tradeDate!==tradeDate||!Array.isArray(message.universe)||JSON.stringify([...message.universe].sort())!==JSON.stringify(symbols))throw Error('DETECTION_STATE_UNIVERSE_MISMATCH');
   if(!Array.isArray(message.rows)||message.rows.length>symbols.length)throw Error('DETECTION_STATE_SIZE_INVALID');
   const seen=new Set();for(const row of message.rows){const symbol=String(row.code||row.symbol||'');if(seen.has(symbol)||!symbols.includes(symbol))throw Error('DETECTION_STATE_SYMBOL_INVALID');seen.add(symbol);}
   service.ingestCandles(message.candles||[]);
   service.replaceState(message.rows);lastSequence=message.sequence;
   reply({type:'daytrade_detection_ack',sequence:message.sequence});
  }catch(error){service.invalidate();reply({type:'daytrade_detection_error',error:error.message});}
 };
 channel.on('message',onMessage);
 channel.once('disconnect',()=>service.stop().catch(()=>{}));
 await service.start();reply({type:'daytrade_detection_ready'});
 return {service,stop:async()=>{channel.removeListener('message',onMessage);await service.stop();}};
}
if(require.main===module)runWorker().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;});
module.exports={runWorker};
