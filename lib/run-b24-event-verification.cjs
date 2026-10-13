'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const E=require('./mother-pool-event-evidence.cjs');
async function run({root,bundleRef,currentFile,directory,sink,clock=()=>new Date().toISOString(),testClock=false,fault=null}){
 const monotonicStart=performance.now();
 E.need(fs.existsSync(path.join(root,'ISOLATED_ONLY')),'ISOLATED_ROOT_REQUIRED');
 E.need(path.resolve(directory).startsWith(path.resolve(root)+path.sep),'ISOLATED_OUTBOX_PATH_REQUIRED');
 const started=clock(),receiptDirectory=path.join(root,'event-verification');fs.mkdirSync(receiptDirectory,{recursive:true});
 const args=E.save(root,{scope:'TEST_ONLY',root,bundleRef,currentFile,receiptDirectory,...(testClock?{test_now:started}:{})});
 const t=process.hrtime.bigint(),child=spawnSync(process.execPath,[path.join(__dirname,'../scripts/verify-b24-event.cjs'),args.file],{encoding:'utf8',windowsHide:true,timeout:30000});
 const processEvidence={scope:'TEST_ONLY',pid:child.pid,elapsed_ms:Number(process.hrtime.bigint()-t)/1e6,exit:child.status,error:child.error?.code||null,stdout:child.stdout,stderr:child.stderr};E.save(receiptDirectory,processEvidence);
 E.need(!child.error&&child.status===0,'EVENT_VERIFIER_FAILED:'+String(child.stderr).trim());
 const parsed=JSON.parse(child.stdout);E.need(parsed.status==='EVENT_VERIFIED','EVENT_VERIFIER_TERMINAL');
 const verifiedAt=clock();
 const verifierCompleteMs=performance.now()-monotonicStart;
 const result=await require('./mother-pool-isolated-outbox.cjs').run({directory,sink,fault,eventReceipt:parsed.receipt,evidenceRoot:root,currentFile,clock});
 return {scope:'TEST_ONLY',status:'EVENT_PATH_RETURNED',event_received:E.read(root,bundleRef).received_at,necessary_sources_ready:E.read(root,bundleRef).sources_ready_at,verifier_started:started,verifier_complete:verifiedAt,completed_at:clock(),timing:{verifier_complete_ms:verifierCompleteMs,total_ms:performance.now()-monotonicStart,outbox:result.results.map(r=>({occurrence_id:r.occurrence_id,enqueued_ms:r.enqueued_ms==null?null:verifierCompleteMs+r.enqueued_ms,sink_ack_ms:r.sink_ack_ms==null?null:verifierCompleteMs+r.sink_ack_ms}))},process:processEvidence,receipt:parsed.receipt,outbox:result,full_market_acceptance:'NOT_EVALUATED'};
}
module.exports={run};
