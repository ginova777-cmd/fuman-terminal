'use strict';
// Cooperative checkpoints in the existing lease-owning Writer. No timer,
// detached promise, retry, new process, or new publication destination.
function create({apply, tradeDate, leaseValid, run, now=Date.now,
  intervalMs=45000, operationMs=10000, maxCalls=6, maxTotalMs=60000, roundDeadline=Infinity}) {
  let lastStart=-Infinity, calls=0, spent=0, busy=false, failure=null;
  async function checkpoint(stage) {
    if (!apply) return {status:'SKIPPED_READ_ONLY'};
    if (failure) return {status:'BYPASSED_AFTER_FAILURE',error:failure.message,complete:false};
    if (busy) throw Error('QUOTE_CHECKPOINT_OVERLAP');
    const started=now();
    if (!(roundDeadline > started + operationMs)) return {status:'BYPASSED_ROUND_DEADLINE',complete:false};
    if (started-lastStart<intervalMs) return {status:'NOT_DUE'};
    if(calls>=maxCalls || spent>=maxTotalMs) return {status:'BYPASSED_BUDGET',complete:false};
    const deadline=started+Math.min(operationMs,maxTotalMs-spent);
    if(!leaseValid(deadline)) return {status:'BYPASSED_LEASE',complete:false};
    busy=true; calls++; lastStart=started;
    try {
      const result=await run({deadline,canWrite:()=>leaseValid(deadline)});
      if(now()>deadline) throw Error('QUOTE_CHECKPOINT_DEADLINE');
      if(!result || result.ok!==true || result.mode!=='apply' || result.trade_date!==tradeDate
        || result.quote_only!==true || !Number.isInteger(result.quotes_written) || result.quotes_written<1)
        throw Error('QUOTE_CHECKPOINT_NOT_ACKNOWLEDGED');
      return {status:'WRITTEN_PENDING_VERIFICATION',stage,quotes_written:result.quotes_written,
        cache_updated_at:result.quote_cache_updated_at,elapsed_ms:now()-started,calls,complete:false};
    } catch(error) { failure=error; return {status:'FAILED',stage,error:error.message,complete:false}; }
    finally { spent+=Math.max(0,now()-started); busy=false; }
  }
  return {checkpoint,status:()=>({calls,spent,busy,failed:!!failure})};
}
module.exports={create};
