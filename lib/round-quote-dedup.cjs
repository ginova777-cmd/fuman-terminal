'use strict';
// Isolated draft. No DB, environment switch, persistent checkpoint or authority.
// Only the caller's explicit successful batch acknowledgement enables reuse.
const {AsyncLocalStorage}=require('node:async_hooks');
const crypto=require('node:crypto');
const scopes=new AsyncLocalStorage();
function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 throw Error('QUOTE_DEDUP_JSON_REQUIRED');
}
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
async function run(identity,work){
 if(scopes.getStore())throw Error('QUOTE_DEDUP_NESTED_SCOPE');
 if(!identity?.runId||!/^\d{4}-\d{2}-\d{2}$/.test(identity.tradeDate)||!identity.sink)throw Error('QUOTE_DEDUP_IDENTITY');
 const s={identity:{...identity},active:true,known:new Map(),queue:Promise.resolve(),counts:{requested:0,submitted:0,duplicate:0,acknowledged:0,failed_batches:0}};
 return scopes.run(s,async()=>{try{return await work(()=>({...s.counts}));}finally{s.active=false;s.known.clear();}});
}
async function batch({sink,tradeDate,rows,guard,write}){
 const s=scopes.getStore();
 if(!s?.active)throw Error('QUOTE_DEDUP_SCOPE_REQUIRED');
 if(sink!==s.identity.sink||tradeDate!==s.identity.tradeDate||!Array.isArray(rows)||typeof guard!=='function'||typeof write!=='function')throw Error('QUOTE_DEDUP_BINDING');
 // Snapshot input before the asynchronous queue; no caller mutation can change it.
 const copy=JSON.parse(canonical(rows)),keys=new Set();
 const entries=copy.map(row=>{if(typeof row.symbol!=='string'||!row.symbol||row.trade_date!==tradeDate||keys.has(row.symbol))throw Error('QUOTE_DEDUP_ROW_IDENTITY');keys.add(row.symbol);return {row,key:row.symbol,digest:hash(row)};});
 const task=s.queue.then(async()=>{
  if(!s.active)throw Error('QUOTE_DEDUP_CLOSED');
  if(await guard()!==true)throw Error('QUOTE_DEDUP_GUARD');
  s.counts.requested+=entries.length;
  const pending=entries.filter(e=>s.known.get(e.key)!==e.digest);
  s.counts.duplicate+=entries.length-pending.length;
  if(!pending.length)return {submitted:0,duplicate:entries.length,acknowledged:0};
  // Invalidate before a write: ambiguous failure cannot leave an old value trusted.
  for(const e of pending)s.known.delete(e.key);
  s.counts.submitted+=pending.length;
  try{
   const sent=pending.map(e=>e.row),expected=hash(sent);
   const ack=await write(sent,expected);
   if(!s.active||hash(sent)!==expected||ack?.confirmed!==true||ack?.rows!==pending.length||ack?.digest!==expected)throw Error('QUOTE_DEDUP_ACK_REQUIRED');
   if(await guard()!==true)throw Error('QUOTE_DEDUP_GUARD');
   for(const e of pending)s.known.set(e.key,e.digest);
   s.counts.acknowledged+=pending.length;
   return {submitted:pending.length,duplicate:entries.length-pending.length,acknowledged:pending.length};
  }catch(e){s.counts.failed_batches++;for(const item of pending)s.known.delete(item.key);throw e;}
 });
 s.queue=task.catch(()=>{});return task;
}
module.exports={run,batch};
