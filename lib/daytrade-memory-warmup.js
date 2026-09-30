'use strict';
function createWarmupLoader(){
 let scope=null,pending=null;
 async function load({tradeDate,revision,identity,calendar,loaders,readMemoryJson,allowPartialSources=false}){
  if(!revision||identity?.trade_date!==tradeDate||calendar?.tradeDate!==tradeDate||calendar?.isTradingDay!==true)throw Error('WARMUP_SCOPE_INVALID');
  if(typeof readMemoryJson!=='function')throw Error('WARMUP_MEMORY_INPUT_READER_REQUIRED');
  const key=JSON.stringify([tradeDate,revision,identity.canonical_run_id,allowPartialSources]);
  if(scope===key&&pending)return pending;
  const names=['activeSymbols','dailyVolumeMap','capitalMap','chipMap','marginChangeMap','stockGroupContractMap','preopenReferencePriceMap'];
  if(names.some(name=>typeof loaders?.[name]!=='function'))throw Error('WARMUP_LOADER_MISSING');
  scope=key;
  const attempt=(async()=>{
   const values={},failures=[];let cursor=0;
   const consume=async()=>{
    while(cursor<names.length){const name=names[cursor++];try{values[name]=await loaders[name]();}catch(error){failures.push({source:name,reason:String(error.message||error)});}}
   };
   await Promise.all([consume(),consume()]);
   if(failures.length&&(!allowPartialSources||failures.some(f=>f.source==='activeSymbols')))throw Object.assign(Error('WARMUP_SOURCE_READ_FAILED'),{failures});
   if(allowPartialSources){for(const name of names.slice(1)){if(!(values[name] instanceof Map)){if(!failures.some(f=>f.source===name))failures.push({source:name,reason:'WARMUP_MAP_INVALID'});values[name]=new Map();}}if(!values.dailyVolumeMap.size&&!failures.some(f=>f.source==='dailyVolumeMap'))failures.push({source:'dailyVolumeMap',reason:'DAILY_BASELINE_EMPTY'});}
   if(!Array.isArray(values.activeSymbols)||!values.activeSymbols.length||!(values.dailyVolumeMap instanceof Map)||(!allowPartialSources&&!values.dailyVolumeMap.size))throw Error('WARMUP_UNIVERSE_OR_DAILY_BASELINE_MISSING');
   for(const name of names.slice(2))if(!(values[name] instanceof Map))throw Error('WARMUP_MAP_INVALID:'+name);
   const {activeSymbols,dailyVolumeMap,...supplementalMaps}=values;
   return {tradeDate,identity,calendar,activeSymbols,dailyVolumeMap,supplementalMaps,readMemoryJson,baseline_revision:revision,warmup_failures:failures,baseline_complete:failures.length===0};
  })();
  pending=attempt;
  attempt.catch(()=>{if(pending===attempt){pending=null;scope=null;}});
  return attempt;
 }
 return {load,invalidate(){scope=null;pending=null;}};
}
module.exports={createWarmupLoader};
