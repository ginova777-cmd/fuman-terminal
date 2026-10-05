'use strict';
const fs=require('node:fs'),path=require('node:path');
async function run({root,tradeDate,writerRunId,apply,leaseValid,writeJson,operation,now=Date.now}){
 if(!apply)return {status:'dry_run',publication_ok:false,complete:false};
 if(!leaseValid())throw Error('CANDIDATE_WRITER_LEASE_REQUIRED');
 const file=path.join(root,'state','stock-future-candidate-module-status.json');let prior=null;
 try{prior=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const stamp=now();if(prior?.trade_date!==tradeDate)prior=null;
 if(prior?.next_retry_at&&Date.parse(prior.next_retry_at)>stamp)return {...prior,status:'backoff',publication_ok:false,complete:false,checked_at:new Date(stamp).toISOString(),writer_run_id:writerRunId};
 const base={contract:'stock-future-candidate-module-v1',trade_date:tradeDate,writer_run_id:writerRunId,checked_at:new Date(stamp).toISOString(),complete:false,natural_verified:false};
 let result;
 try{result=await operation();}catch(e){
  // Lease failures remain core stop conditions. Do not keep writing without authority.
  if(/CANDIDATE_WRITER_LEASE/.test(e?.message||''))throw e;
  result={status:'publication_unconfirmed',reason:/^CANDIDATE_[A-Z_]+$/.test(e?.message||'')?e.message:'CANDIDATE_PUBLICATION_FAILED',error_name:/^[A-Za-z]+$/.test(e?.name||'')?e.name:'Error',execution_outcome:'unknown'};
 }
 if(!result||!['unchanged','published_not_natural_verified'].includes(result.status)){
  const failures=(prior?.failures||0)+1,delay=[60000,120000,240000,300000][Math.min(failures-1,3)];
  const supplied=Date.parse(result?.next_retry_at);
  const failed={...base,...result,publication_ok:false,complete:false,failures,next_retry_at:new Date(Number.isFinite(supplied)&&supplied>stamp?supplied:stamp+delay).toISOString(),pending_reconciliation_required:true};
  // Keep pending payload/cursor owned by publisher intact. On the next due round,
  // publisher must reconcile the exact revision before any resend.
  writeJson(file,failed);return failed;
 }
 const success={...base,...result,publication_ok:true,complete:false,failures:0,next_retry_at:null,pending_reconciliation_required:false};writeJson(file,success);return success;
}
module.exports={run};
