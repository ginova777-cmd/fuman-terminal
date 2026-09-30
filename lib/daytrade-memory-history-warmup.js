'use strict';
async function completeHistoryWarmup(baseline,load){
 try{return {...baseline,history:await load()};}
 catch(error){
  const reason=/^HISTORY_[A-Z0-9_]+$/.test(String(error?.message||''))?error.message:'HISTORY_LOAD_FAILED';
  return {...baseline,history:null,baseline_complete:false,warmup_failures:[...(baseline.warmup_failures||[]),{source:'historicalMinuteCandles',reason}]};
 }
}
module.exports={completeHistoryWarmup};
