'use strict';
// Shared adapter for the existing main Writer and fast-sync callbacks.
// Does not issue HTTP, acquire a lease, alter data or claim independent readback.
const dedup=require('./round-quote-dedup.cjs');
async function write({sink,tradeDate,rows,guard,send}){
 const outcome=await dedup.batch({sink,tradeDate,rows,guard,write:async(batch,digest)=>{
  // send must resolve only after the existing HTTP success and batch callbacks.
  const result=await send(batch);
  const count=typeof result==='number'?result:result?.written;
  if(count!==batch.length)throw Error('QUOTE_ADAPTER_INCOMPLETE_WRITE');
  return {confirmed:true,rows:count,digest};
 }});
 return {written:outcome.submitted,reused:outcome.duplicate,
  acknowledged:outcome.acknowledged+outcome.duplicate,
  confirmation_scope:'SAME_ROUND_HTTP_ACK',independent_readback_pending:true};
}
module.exports={run:dedup.run,write};
