'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const delta=require('./daytrade-candle-delta');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function sync({file,rows,tradeDate,target,nowMs,write,maxRows=Infinity}) {
 if(maxRows!==Infinity&&(!Number.isInteger(maxRows)||maxRows<1))throw Error('CANDLE_BATCH_LIMIT_INVALID');
 let checkpoint=null;
 try {const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.sha256===hash(saved.checkpoint))checkpoint=saved.checkpoint;} catch {}
 const selected=delta.selectDelta(rows,checkpoint,{tradeDate,target,nowMs});
 const batch=maxRows===Infinity?selected.pending:require('./daytrade-fast-write-plan.cjs').plan(selected.pending,{
  nowMs,limit:maxRows,backfillReserve:Math.min(500,Math.floor(maxRows/4)),bounded:true}).rows;
 let current=selected.checkpoint;
 const remaining=new Map(batch.map(row=>[row.symbol+'|'+row.candle_time,delta.fingerprint(row)]));
 // The callback is invoked only after the existing HTTP batch succeeds.
 // Preserve confirmed batches on a later failure; the caller still fails and
 // does not advance the seed mirror until the entire selection succeeds.
 const acknowledgeBatch=batch=>{
  if(!Array.isArray(batch)||!batch.length)throw Error('CANDLE_ACK_EMPTY_BATCH');
  const keys=new Set();
  for(const row of batch){const key=row.symbol+'|'+row.candle_time;if(keys.has(key)||remaining.get(key)!==delta.fingerprint(row))throw Error('CANDLE_ACK_IDENTITY_MISMATCH');keys.add(key);}
  const next=delta.acknowledge(current,batch);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  try {fs.writeFileSync(tmp,JSON.stringify({checkpoint:next,sha256:hash(next)}),{flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  current=next;for(const key of keys)remaining.delete(key);
 };
 if(batch.length){await write(batch,acknowledgeBatch);if(remaining.size)throw Error('CANDLE_ACK_INCOMPLETE');}
 const acknowledgedRows=rows.filter(row=>Date.parse(row.candle_time)+60000<=nowMs&&current.hashes[row.symbol+'|'+row.candle_time]===delta.fingerprint(row));
 return {written:batch.length,deferred:selected.pending.length-batch.length,acknowledgedRows,unchanged:selected.unchanged,not_due:selected.not_due};
}
module.exports={sync};
