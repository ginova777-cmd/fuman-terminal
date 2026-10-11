'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const origin=require('../lib/strategy-natural-evidence');
function ready(r,run){
 return !!run&&r?.runId===run&&r.status==='complete'&&r.complete===true&&r.exitCode===0&&!r.blockingReason&&!r.first_blocker&&!r.firstBlocker&&r.fallback!==true&&r.fallbackUsed!==true&&!(r.failed_checks||[]).length&&Number.isSafeInteger(r.total)&&r.total>0&&r.scanned===r.total&&r.triSurfaceStatus==='complete'&&['desktopRunId','mobileRunId','scorecardRunId'].every(k=>r[k]===run);
}
function finalize({file,run,root,runtime,collect=origin.collect}){
 const before=fs.readFileSync(file,'utf8'),r=JSON.parse(before.replace(/^\uFEFF/,''));
 if(!ready(r,run))throw Error('institution_completion_not_verified_same_run');
 const proof=collect({strategy:'institution',scan:r,formalComplete:true,recovery:r.recoveryReplay===true,root,runtime});
 if(fs.readFileSync(file,'utf8')!==before)throw Error('institution_receipt_changed_during_origin_verification');
 // Separate observed origin from business completion. Missing scheduler evidence never becomes natural.
 const out={...r,...proof,executionMode:proof.recoveryReplay?'recovery_replay':proof.naturalSlotComplete?'natural':'manual_or_unknown'};
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(out,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,file);
 return {ok:true,runId:run,naturalSlotComplete:out.naturalSlotComplete,recoveryReplay:out.recoveryReplay,naturalEvidenceStatus:out.naturalEvidenceStatus};
}
if(require.main===module){try{
 const run=process.argv.find(x=>x.startsWith('--expect-run-id='))?.slice(16);
 const runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
 console.log(JSON.stringify(finalize({file:path.join(runtime,'data/scan-receipts/institution.json'),run,root:path.resolve(__dirname,'..'),runtime})));
}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={ready,finalize};
