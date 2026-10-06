'use strict';
const fields=['verification_run_id','trade_date','canonical_run_id','mother_pool_run_id','generation','snapshot_sequence','verified_at','complete','symbols_sha256','snapshot_sha256','snapshot_readback_sha256','receipt_generation_verified'];
async function confirm(expected,readOnce){
 const result={contract:'mother-pool-publication-confirmation-v1',verification_run_id:expected.verification_run_id,checked_at:new Date().toISOString(),status:'UNKNOWN',read_attempts:1,resend_allowed:false,original_process_exit_preserved:true};
 try{
  const rows=await readOnce(fields.concat(['failed_checks','first_blocker']).join(','));
  if(!Array.isArray(rows))throw Error('INVALID_READBACK');
  if(!rows.length)return {...result,status:'NOT_FOUND_AT_READ_TIME'};
  if(rows.length!==1)return {...result,status:'MISMATCH',mismatch_fields:['row_count']};
  const row=rows[0],bad=fields.filter(k=>k==='verified_at'?Date.parse(row[k])!==Date.parse(expected[k]):row[k]!==expected[k]);
  for(const k of ['failed_checks','first_blocker'])if(JSON.stringify(row[k])!==JSON.stringify(expected[k]))bad.push(k);
  return {...result,status:bad.length?'MISMATCH':'COMMITTED',mismatch_fields:bad,readback:row};
 }catch(e){return {...result,error_type:e.name||'Error'};}
}
module.exports={confirm};
