'use strict';
function createCatalogueRetry({refresh,readState,writeState,now=()=>Date.now()}){
 return async function attempt(options){
  const prior=readState()||{},next=Date.parse(prior.next_retry_at||'');
  if(Number.isFinite(next)&&next>now())return {status:'backoff',retry_after_ms:Math.min(300000,next-now()),receipt:prior};
  try{
   const catalogue=await refresh(options);
   writeState({status:'ready',failures:0,next_retry_at:null,checked_at:new Date(now()).toISOString(),trade_date:catalogue.trade_date});
   return {status:'ready',catalogue};
  }catch(error){
   const failures=Math.min(100,Number.isSafeInteger(prior.failures)?prior.failures+1:1),wait=[60000,120000,240000,300000][Math.min(failures-1,3)];
   const receipt={status:'blocked',failures,checked_at:new Date(now()).toISOString(),next_retry_at:new Date(now()+wait).toISOString(),expected_trade_date:options.tradeDate,provider_identity:error.providerIdentity||null,error:/^[A-Z0-9_|:]+$/.test(error.message||'')?error.message:'FUTURES_CATALOGUE_REFRESH_FAILED'};
   writeState(receipt);return {status:'blocked',retry_after_ms:wait,receipt};
  }
 };
}
module.exports={createCatalogueRetry};
