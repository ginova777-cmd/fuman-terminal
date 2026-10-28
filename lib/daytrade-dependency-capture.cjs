'use strict';
const fs=require('fs'),path=require('path'),{randomUUID}=require('crypto'),{spawnSync}=require('child_process');
const shared=require('./daytrade-shared-evidence.cjs');
const {verifyParent}=require('./daytrade-dependency-readback.cjs');
function capture({moduleId,writeSet,identity,runtime,script,env,now=()=>new Date().toISOString()}){
 const index=path.join(runtime,'data','scan-receipts','modules','dependency-index-'+randomUUID()+'.json');
 shared.write(index,{modules:{[moduleId]:writeSet}},runtime);
 const args=[script,'--modules='+moduleId,'--write-set-index='+index,'--trade-date='+identity.trade_date,'--canonical='+identity.canonical_run_id,'--writer-run-id='+identity.writer_run_id,'--writer-generation-id='+identity.generation_id,'--mother-pool-run-id='+identity.mother_pool_run_id,'--snapshot-generation='+identity.snapshot_generation,'--snapshot-sequence='+identity.snapshot_sequence];
 const child=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,timeout:120000,env,maxBuffer:1024*1024});
 if(child.error||child.status!==0)throw Error('PARENT_CAPTURE_FAILED:'+moduleId);
 const report=JSON.parse(child.stdout),result=report.results?.find(r=>r.module_id===moduleId);
 if(report.trade_date!==identity.trade_date||report.results?.length!==1||result?.status!=='verified'||typeof result.file!=='string')throw Error('PARENT_CAPTURE_NOT_VERIFIED:'+moduleId);
 const expected=path.resolve(runtime,'data','scan-receipts','modules')+path.sep;
 if(!path.resolve(result.file).toLowerCase().startsWith(expected.toLowerCase()))throw Error('PARENT_CAPTURE_PATH_INVALID');
 const artifact=shared.read(result.file,runtime);
 verifyParent({moduleId,artifact,identity,asOf:now()});
 if(artifact.writer_write_set?.plan_hash!==writeSet.plan_hash)throw Error('PARENT_CAPTURE_PLAN_MISMATCH:'+moduleId);
 return {file:result.file,artifact};
}
module.exports={capture};
