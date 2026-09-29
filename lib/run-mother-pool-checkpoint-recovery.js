'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const journal=require('./daytrade-source-status-journal'),checkpoint=require('./mother-pool-module-input-checkpoint');
const {resumeCheckpoint}=require('./mother-pool-resume-checkpoint');
const {create}=require('./mother-pool-module-recovery-adapter');
const {atomic}=require('./mother-pool-a16-io');
async function run({sourceIntent,runtime,url,key,hostId,instanceId,tradeDate,guard,calendar,read,invoke}){
 const row=journal.read(sourceIntent),reference=row.payload?.module_input_checkpoint;
 if(!reference?.file)throw Error('RECOVERY_ORIGINAL_INPUT_CHECKPOINT_MISSING');
 const original=JSON.parse(fs.readFileSync(reference.file,'utf8'));
 const plan=checkpoint.load(reference,original.identity),identity=plan.identity;
 if(identity.trade_date!==tradeDate)throw Error('RECOVERY_CROSS_DAY');
 await calendar(tradeDate);await guard();
 const lock=path.join(runtime,'state','daytrade-source-writer.cross-session.lock');
 const fd=fs.openSync(lock,'wx');
 try{
  const directory=path.join(runtime,'data','module-write-sets');fs.mkdirSync(directory,{recursive:true});
  const recoveryId=crypto.randomUUID(),progressFile=path.join(directory,'recovery-'+recoveryId+'.json');
  const assertLease=async()=>{await guard();const rows=await read('fugle_daytrade_source_writer_lease',{source_name:'eq.'+row.source_name,select:'source_name,writer_host_id,writer_instance_id,trade_date,lease_expires_at',limit:'2'});
   require('./mother-pool-recovery-lease').verify(rows,{sourceName:row.source_name,hostId,instanceId,tradeDate,now:new Date().toISOString()});};
  const readSource=async expected=>read('source_status',{source_name:'eq.'+expected.source_name,trade_date:'eq.'+expected.trade_date,'payload->>canonical_run_id':'eq.'+identity.canonical_run_id,'payload->>writer_run_id':'eq.'+identity.writer_run_id,'payload->>generation_id':'eq.'+identity.generation_id,select:Object.keys(expected).join(','),limit:'2'});
  const progress=await resumeCheckpoint({sourceIntent,identity,guard,assertLease,readSource,adapterFor:async()=>create({url,key,directory,guard,assertLease}),saveProgress:async p=>atomic(progressFile,p)});
  const modules=Object.fromEntries(progress.written_modules.map(m=>[m.module_id,m]));
  if(Object.keys(modules).length){
   const index=path.join(directory,'recovery-'+recoveryId+'-index.json');require('./daytrade-durable-json').writeExclusive(index,{modules});
   try{
   await guard();
   progress.capture=await invoke('capture-daytrade-module-readbacks.js',[
    '--trade-date='+identity.trade_date,'--canonical='+identity.canonical_run_id,'--writer-run-id='+identity.writer_run_id,'--writer-generation-id='+identity.generation_id,'--mother-pool-run-id='+identity.mother_pool_run_id,'--snapshot-generation='+identity.snapshot_generation,'--snapshot-sequence='+identity.snapshot_sequence,'--modules='+Object.keys(modules).join(','),'--write-set-index='+index]);
   if(progress.capture.exit_code!==0&&!progress.first_blocker)progress.first_blocker={error:'RECOVERY_INDEPENDENT_CAPTURE_FAILED'};
   atomic(progressFile,progress);
   await guard();
   progress.verification=await invoke('run-daytrade-module-verifiers.js',[],{TRADE_DATE:identity.trade_date,MOTHER_POOL_CANONICAL:identity.canonical_run_id,MOTHER_POOL_REQUIRED_WRITER_RUN_ID:identity.writer_run_id});
   if(progress.verification.exit_code!==0&&!progress.first_blocker)progress.first_blocker={error:'RECOVERY_TWO_ROUND_VERIFICATION_INCOMPLETE'};
   }catch(error){progress.capture_or_verification_error=String(error.message||error);if(!progress.first_blocker)progress.first_blocker={error:'RECOVERY_CAPTURE_OR_VERIFICATION_FAILED'};}
  }
  progress.progress_file=progressFile;atomic(progressFile,progress);return progress;
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
module.exports={run};
