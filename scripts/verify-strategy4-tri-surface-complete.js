'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..');
const runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
function validate({scan,tri,audit,db,rendered},run){
 const issues=[];
 if(!require('./verify-strategy4-complete').scanReady(scan,run))issues.push('scan_not_ready');
 if(tri?.complete!==true||tri.status!=='complete'||tri.runId!==run||[tri.desktopRunId,tri.mobileRunId,tri.scorecardRunId].some(id=>id!==run))issues.push('tri_surface_not_verified');
 const row=audit?.results?.find(r=>r.key==='strategy4');
 if(audit?.ok!==true||row?.ok!==true||row.supabase?.runId!==run||row.supabase?.count!==scan.matches)issues.push('tri_surface_audit_mismatch');
 if(db?.ok!==true||db.runId!==run||db.complete!==true||db.resultCount!==scan.matches||db.readbackCount!==scan.matches||db.scannedCount!==scan.scanned||db.expectedTotal!==scan.total)issues.push('independent_db_readback_failed');
 issues.push(...require('../lib/strategy4-rendered-evidence').validateRendered(rendered,run,scan));
 return issues;
}
function main(){
 const run=(process.argv.find(a=>a.startsWith('--expect-run-id='))||'').slice(16);
 if(!process.argv.includes('--notifications=disabled-by-user'))throw Error('explicit_user_notification_policy_required');
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
 const file=path.join(runtime,'data/scan-receipts/strategy4.json'),scan=read(file);
 const tri=read(path.join(runtime,'data/scan-receipts/tri-surface-closures/strategy4.json'));
 const audit=read(tri.reportPath);
 const db=JSON.parse(cp.execFileSync(process.execPath,['--use-system-ca',path.join(__dirname,'verify-strategy4-db-latest-run.js')],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,env:{...process.env,EXPECTED_STRATEGY4_RUN_ID:run}}));
 const rendered=require('./verify-strategy4-rendered-complete').runRendered(run,scan);
 const issues=validate({scan,tri,audit,db,rendered},run);if(issues.length)throw Error(issues.join(';'));
 const final={...scan,status:'complete',complete:true,qualityStatus:'complete',exitCode:0,blockingReason:'',failed_checks:[],first_blocker:null,finishedAt:new Date().toISOString(),completionContract:'strategy4_tri_surface_user_scope_v1',acceptanceScope:['desktop','mobile','scorecard88'],notificationPolicy:'disabled_by_user',lineDelivery:{status:'DISABLED_BY_USER',delivered:false},renderedVerifiedRunId:run,renderedReceipt:rendered.receiptPath,renderedVerifiedAt:rendered.checkedAt};
 const tmp=file+'.finalizing';fs.writeFileSync(tmp,JSON.stringify(final,null,2)+'\n');fs.renameSync(tmp,file);
 try {
  cp.execFileSync(process.execPath,['--use-system-ca',path.join(__dirname,'publish-scorecard-scan-audit.js')],{cwd:root,stdio:'inherit',windowsHide:true,timeout:120000});
 } catch(error) {
  const failed={...final,status:'failed',complete:false,exitCode:1,blockingReason:'final_scorecard_audit_publish_failed',first_blocker:'final_scorecard_audit_publish_failed'};
  fs.writeFileSync(file,JSON.stringify(failed,null,2)+'\n');
  throw error;
 }
 console.log(JSON.stringify({ok:true,runId:run,status:'complete',acceptanceScope:final.acceptanceScope,notificationPolicy:final.notificationPolicy}));
}
module.exports={validate};
if(require.main===module){try{main();}catch(e){console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}}
