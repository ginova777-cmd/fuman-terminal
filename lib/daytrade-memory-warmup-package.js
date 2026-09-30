'use strict';
const fs=require('fs');
const {createWarmupLoader}=require('./daytrade-memory-warmup');
const {createBaselineReadCache}=require('./daytrade-baseline-read-cache');
async function buildWarmupPackage({detector,tradeDate,revision,identity,calendar,historyCalendar,rawQuotes,readFile=file=>fs.readFileSync(file,'utf8')}){
 const jsonInputs=new Map();
 function readMemoryJson(file,fallback){
  if(!jsonInputs.has(file)){
   try{jsonInputs.set(file,{present:true,value:JSON.parse(readFile(file).replace(/^\uFEFF/,''))});}
   catch{jsonInputs.set(file,{present:false});}
  }
  const record=jsonInputs.get(file);return record.present?structuredClone(record.value):fallback;
 }
 const input=await detector.prepareMemoryWarmup({tradeDate,revision,identity,calendar,historyCalendar,cache:createBaselineReadCache(),warmupLoader:createWarmupLoader(),readMemoryJson});
 const quoteMap=detector.normalizeMemoryQuotes(rawQuotes,tradeDate);
 // Resolve the existing synchronous rule inputs once, before starting the worker.
 // This is an input prefetch, never a production publication or acceptance run.
 detector.evaluateMemoryPool({...input,quoteMap,readMemoryJson});
 if(typeof detector.evaluateMemoryState==='function')detector.evaluateMemoryState({...input,quoteMap,readMemoryJson});
 const {readMemoryJson:ignored,...baseline}=input;
 return {baseline,jsonInputs:[...jsonInputs],prefetch:{scope:'memory_input_prefetch',published:false,quotes:quoteMap.size,json_inputs:jsonInputs.size}};
}
module.exports={buildWarmupPackage};
