'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const origin=require('../lib/strategy-natural-evidence');
const link=require('../lib/institution-origin-link.cjs');
function ready(r,run){
 return !!run&&r?.runId===run&&link.receiptComplete(r);
}
function finalize({file,run,root,runtime,collect=origin.collect,authority}){
 const before=fs.readFileSync(file,'utf8'),r=JSON.parse(before.replace(/^\uFEFF/,''));
 if(!ready(r,run))throw Error('institution_completion_not_verified_same_run');
 const existing=link.read(file,r,{authority});
 if(existing.naturalSlotComplete===true)return {ok:true,runId:run,evidencePath:link.proofPath(file,r),naturalSlotComplete:true,recoveryReplay:false,naturalEvidenceStatus:existing.naturalEvidenceStatus,reused:true};
 const proof=collect({strategy:'institution',scan:r,formalComplete:true,recovery:r.recoveryReplay===true,root,runtime});
 if(fs.readFileSync(file,'utf8')!==before)throw Error('institution_receipt_changed_during_origin_verification');
 // Publish immutable evidence only. Never replace the shared latest receipt.
 let success=false;
 try{link.verifyProof(file,r,proof,{authority});success=true;}catch{}
 const evidencePath=success?link.proofPath(file,r):path.join(path.dirname(file),'institution-origin-attempts',crypto.randomUUID()+'.json');
 fs.mkdirSync(path.dirname(evidencePath),{recursive:true});
 const payload={contract:'institution-origin-link-v1',runId:run,receiptSha256:link.hash(r),proof};
 const tmp=evidencePath+'.'+crypto.randomUUID()+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(payload,null,2)+'\n',{flag:'wx'});
 try{fs.linkSync(tmp,evidencePath);}catch(e){
  if(e.code!=='EEXIST'||!success||link.read(file,r,{authority}).naturalSlotComplete!==true)throw e;
 }finally{fs.unlinkSync(tmp);}
 return {ok:success,runId:run,evidencePath,naturalSlotComplete:success,recoveryReplay:proof.recoveryReplay===true,naturalEvidenceStatus:success?proof.naturalEvidenceStatus:(proof.naturalSlotComplete===true?'ORIGIN_PROOF_UNVERIFIED':proof.naturalEvidenceStatus)};
}
if(require.main===module){try{
 const run=process.argv.find(x=>x.startsWith('--expect-run-id='))?.slice(16);
 const runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
 const result=finalize({file:path.join(runtime,'data/scan-receipts/institution.json'),run,root:path.resolve(__dirname,'..'),runtime});
 console.log(JSON.stringify(result));
 if(result.ok!==true || result.naturalSlotComplete!==true) process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={ready,finalize};
