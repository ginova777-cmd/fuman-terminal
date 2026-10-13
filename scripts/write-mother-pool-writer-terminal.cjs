'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {writeExclusive}=require('../lib/daytrade-durable-json');
const v=require('../lib/mother-pool-preopen-v11.cjs');
const {terminalEvidence}=require('../lib/mother-pool-preopen-module-evidence.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function write({runtime,stdout,wrapperRunId,completedAt=new Date().toISOString()}){
 const text=fs.readFileSync(stdout,'utf8');
 const identities=text.split(/\r?\n/).filter(line=>line.includes('"stage":"writer_round_identity"')).map(line=>JSON.parse(line));
 if(identities.length!==1)throw Error('TERMINAL_SINGLE_WRITER_REQUIRED');
 const writer=identities[0],day=writer.trade_date;
 const files={verifier:path.join(runtime,'data','scan-receipts','daytrade-mother-pool-closed-loop-'+day.replaceAll('-','')+'.json'),refresh:path.join(runtime,'state','daytrade-fast-supabase-sync.json')};
 const bytes=Object.fromEntries(Object.entries(files).map(([k,f])=>[k,fs.readFileSync(f)]));
 const proof=JSON.parse(bytes.verifier),refresh=JSON.parse(bytes.refresh),binding=proof.snapshot_binding;
 const start=Date.parse(writer.checkedAt),end=Date.parse(completedAt);
 const preopen=require('../lib/mother-pool-receipt-current.cjs').preopenNotDue(proof,end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||proof.ok!==true||proof.verifier_ok!==true||proof.closed_loop_ok!==true||proof.failed_checks?.length!==0||proof.publication?.status!=='POST_ACKNOWLEDGED'||(!preopen&&proof.candle_save_evidence?.ok!==true)||proof.trade_date!==day||proof.canonical_run_id!==writer.canonical_run_id||binding?.trade_date!==day||binding.canonical_run_id!==writer.canonical_run_id)throw Error('TERMINAL_FINAL_PROOF_REQUIRED');
 if(refresh.ok!==true||refresh.wrapper_run_id!==wrapperRunId||refresh.trade_date!==day)throw Error('TERMINAL_REFRESH_RUN_MISMATCH');
 const identity={trade_date:day,canonical_run_id:writer.canonical_run_id,writer_run_id:writer.writer_run_id,generation_id:writer.generation_id,mother_pool_run_id:binding.mother_pool_run_id,snapshot_generation:binding.generation,snapshot_sequence:binding.snapshot_sequence};
 const build=(kind,at,payload)=>({success:true,identity,completed_at:at,payload,hash:v.hash(payload)});
 const input={identity,startedAt:writer.checkedAt,completedAt,exitCode:0,status:'SUCCESS',
  verifier:build('verifier',proof.publication.acknowledged_at,{raw_sha256:sha(bytes.verifier),verification_run_id:proof.verification_run_id,snapshot_sha256:binding.snapshot_sha256,ok:proof.ok}),
  refresh:build('refresh',refresh.completed_at,{raw_sha256:sha(bytes.refresh),wrapper_run_id:wrapperRunId,ok:refresh.ok})};
 const receipt=terminalEvidence(input),directory=path.join(runtime,'data','writer-terminals',day);fs.mkdirSync(directory,{recursive:true});
 for(const data of Object.values(bytes)){const file=path.join(directory,sha(data)+'.raw');if(!fs.existsSync(file)){const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}else if(sha(fs.readFileSync(file))!==sha(data))throw Error('TERMINAL_RAW_CONFLICT');}
 const record={contract:'mother_pool_writer_terminal_v11',input,receipt,wrapper_run_id:wrapperRunId,formal_modules_complete:proof.all_modules_complete===true,realtime_status:proof.realtime_status,session_phase:proof.session_evidence?.phase,candle_persistence_required:!preopen};
 const file=path.join(directory,sha(writer.writer_run_id)+'.json');writeExclusive(file,record);return {file,writer_run_id:writer.writer_run_id,status:'WRITER_TERMINAL_SAVED'};
}
module.exports={write};
if(require.main===module){try{console.log(JSON.stringify(write({runtime:process.argv[2],stdout:process.argv[3],wrapperRunId:process.argv[4]})));}catch(error){console.error(error.message);process.exitCode=1;}}
