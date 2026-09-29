'use strict';
const journal=require('./daytrade-source-status-journal');
const {acknowledgeStored}=require('./daytrade-source-status-ack');
const checkpoint=require('./mother-pool-module-input-checkpoint');
// No write adapter is accepted. A recovered plan is not a completed round.
async function inspect({sourceIntent,identity,guard,readSource}) {
 const row=journal.read(sourceIntent);
 if(row.source_name!=='fugle_daytrade_source')throw Error('RECOVERY_SOURCE_INVALID');
 for(const k of ['trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id'])if(row.payload?.[k]!==identity[k])throw Error('RECOVERY_SOURCE_IDENTITY:'+k);
 if(row.payload.mother_pool_snapshot_sequence!==identity.snapshot_sequence)throw Error('RECOVERY_SNAPSHOT_IDENTITY');
 const ref=row.payload.module_input_checkpoint;
 if(!ref?.file||!ref.content_sha256)throw Error('RECOVERY_ORIGINAL_INPUT_CHECKPOINT_MISSING');
 const plan=checkpoint.load(ref,identity);
 await guard();
 const ack=await acknowledgeStored({row,read:readSource});
 return {mode:'same_batch_recovery_preflight',read_only:true,source_ack:ack,identity:plan.identity,observed_at:plan.observed_at,inputs:plan.inputs,deferred_modules:plan.deferred_modules,complete:false};
}
module.exports={inspect};
