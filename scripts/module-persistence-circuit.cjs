'use strict';
const {transient}=require('./writer-database-backoff.cjs');
function createCircuit(){
 let failure=null;
 return {
  record(error){if(!failure&&transient(`${error?.name||''}: ${error?.message||error}`))failure=error;},
  get blocked(){return failure!==null;},
  assertHealthy(){if(failure)throw failure;}
 };
}
// A client timeout does not prove rollback. Accept only the existing exact ACK
// recovery; if recovery fails, preserve the timeout for the wrapper's cooldown.
async function recoverTimedOutWrite(recover){
 try{return await recover();}
 catch(cause){const error=new Error('TimeoutError: MODULE_ACK_UNCONFIRMED',{cause});error.name='TimeoutError';throw error;}
}
module.exports={createCircuit,recoverTimedOutWrite};
