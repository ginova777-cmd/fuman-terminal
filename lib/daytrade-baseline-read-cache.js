'use strict';
const {cloneBaseline}=require('./daytrade-baseline-transfer');
// One in-flight read per immutable source scope. Failed reads are not cached.
// Callers must change revision when the upstream source changes.
function createBaselineReadCache({maxEntries=16}={}){
 const entries=new Map();let currentDate=null;
 function read({tradeDate,source,revision,load}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||!source||!revision||typeof load!=='function')throw Error('BASELINE_SCOPE_REQUIRED');
  if(currentDate!==tradeDate){entries.clear();currentDate=tradeDate;}
  const key=JSON.stringify([tradeDate,source,revision]);
  if(!entries.has(key)){
   if(entries.size>=maxEntries)entries.delete(entries.keys().next().value);
   const promise=Promise.resolve().then(load).then(value=>cloneBaseline(value));
   entries.set(key,promise);
   promise.catch(()=>{if(entries.get(key)===promise)entries.delete(key);});
  }
  return entries.get(key).then(value=>cloneBaseline(value));
 }
 return {read,invalidate:()=>{entries.clear();currentDate=null;}};
}
function marginQuery(dates){
 if(!Array.isArray(dates)||dates.length!==5||new Set(dates).size!==5||dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d))||dates.some((d,i)=>i&&d<=dates[i-1]))throw Error('FIVE_ORDERED_SESSIONS_REQUIRED');
 return 'select=symbol,trade_date,margin_balance,short_balance,updated_at&trade_date=in.('+dates.join(',')+')&order=trade_date.desc,symbol.asc';
}
module.exports={createBaselineReadCache,marginQuery};
