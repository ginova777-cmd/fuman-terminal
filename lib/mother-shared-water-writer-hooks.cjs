'use strict';
const {readScope}=require('./mother-shared-water-priority-scope.cjs');
// Attach only to the existing final quote sync. Evidence failure must remain
// visible while leaving that existing quote/candle publication path running.
function createHooks(options,{capture,run,now=Date.now} = require('./mother-shared-water-writer-round.cjs')){
 const frozen=structuredClone(options.priorityScope);
 const blocked=(stage,error)=>({status:'BLOCKED',water_gate_pass:false,formal_entry_authorization:false,
  first_blocker:'SHARED_WATER_'+stage+'_FAILED',error_code:/^[A-Z0-9_:]+$/.test(error?.message||'')?error.message:error?.code||error?.name||'Error'});
 return {
  async beforeQuoteRead(){
   try {
    if(options.canPublish&&await options.canPublish()!==true)throw Error('WRITER_GUARD_REJECTED');
    const prioritySymbols=readScope(frozen,{tradeDate:options.writerIdentity.trade_date,writerRunId:options.writerIdentity.writer_run_id,expectedCount:options.priorityCount});
    const initialCapture=await capture({runtimeRoot:options.runtimeRoot,prioritySymbols,deadline:now()+10000});
    return {prioritySymbols,initialCapture};
   }catch(error){return {failure:blocked('PRE_WRITE_CAPTURE',error)};}
  },
  async afterQuoteWrite({context,trade_date,quotes_written,write_completed_at,written_symbols}){
   if(context?.failure)return context.failure;
   try {
    if(options.canPublish&&await options.canPublish()!==true)throw Error('WRITER_GUARD_REJECTED');
    if(!context?.initialCapture||trade_date!==options.writerIdentity.trade_date||!Number.isInteger(quotes_written)||quotes_written<1)throw Error('QUOTE_WRITE_NOT_ACKNOWLEDGED');
    if(!Array.isArray(written_symbols)||written_symbols.length!==quotes_written||new Set(written_symbols).size!==quotes_written||written_symbols.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s)))throw Error('QUOTE_WRITE_SET_INVALID');
    return await run({...options,prioritySymbols:context.prioritySymbols,initialCapture:context.initialCapture,writeCompletedAt:write_completed_at,writtenSymbols:[...written_symbols]});
   }catch(error){
    if(options.onVerificationFailure)await options.onVerificationFailure(error);
    return blocked('POST_WRITE_VERIFICATION',error);
   }
  },
 };
}
module.exports={createHooks};
