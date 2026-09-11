"use strict";
const fs=require('fs'),path=require('path');
function scanReady(s,run){return !!run&&s.runId===run&&s.scanComplete===true&&s.status==='delivering'&&s.complete===false&&s.exitCode===0&&!s.blockingReason&&s.fallback===false&&s.total>=1500&&s.scanned===s.total&&s.triSurfaceStatus==='complete'&&[s.desktopRunId,s.mobileRunId,s.scorecardRunId].every(x=>x===run);}
function validate(e,run){
 const {scan:s,daily:d,line:l,wrapper:w,verifier:v,canonical:c}=e,fail=[];
 if(!scanReady(s,run))fail.push('scan_not_ready');
 for(const [name,obj,key] of [['daily',d,'runId'],['line',l,'runId'],['wrapper',w,'run_id'],['verifier',v,'run_id'],['canonical',c,'runId']])if(!obj||obj.ok!==true||obj[key]!==run)fail.push(name+'_not_verified_same_run');
 if(d?.issues?.length||c?.issues?.length||d?.count!==s.matches||d?.scan?.complete!==true)fail.push('daily_or_canonical_invalid');
 const norm=a=>JSON.stringify([...a].sort());
 if(l?.dry_run!==false||l?.line_push_ok!==true||l?.count!==Math.min(s.matches,70)||l?.rendered_count!==l?.count||!Array.isArray(l?.rendered_symbols)||!Array.isArray(l?.accepted_symbols)||norm(l.rendered_symbols)!==norm(l.accepted_symbols))fail.push('line_not_rendered_and_delivered');
 if(w?.status!=='complete'||w?.first_blocker!=null||v?.status!=='complete')fail.push('wrapper_or_verifier_incomplete');
 return fail;
}
function main(){
 const run=(process.argv.find(x=>x.startsWith('--expect-run-id='))||'').slice(16),root=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
 const scanPath=path.join(root,'data/scan-receipts/strategy4.json'),scan=read(scanPath),day=String(scan.tradeDate).replace(/-/g,'');
 const e={scan,daily:read(path.join(root,`data/scan-receipts/strategy4-daily-publish-${day}.json`)),canonical:read(path.join(root,`data/scan-receipts/strategy4-canonical-closure-${day}.json`)),line:read(path.join(root,`data/line-cards/strategy4-line-card-${day}.json`)),wrapper:read(path.join(root,`data/line-cards/strategy4-line-card-wrapper-receipt-${day}.json`)),verifier:read(path.join(root,`data/line-cards/strategy4-line-card-canonical-verifier-receipt-${day}.json`))};
 const issues=validate(e,run);if(issues.length)throw Error(issues.join(';'));
 const final={...scan,status:'complete',complete:true,qualityStatus:'complete',finishedAt:new Date().toISOString(),completionContract:'strategy4_delivery_before_complete_v1',deliveryVerifiedRunId:run};
 const tmp=scanPath+'.finalizing';fs.writeFileSync(tmp,JSON.stringify(final,null,2)+'\n');fs.renameSync(tmp,scanPath);
 try { require('child_process').execFileSync(process.execPath,['--use-system-ca',path.join(__dirname,'publish-scorecard-scan-audit.js')],{cwd:path.resolve(__dirname,'..'),stdio:'pipe',windowsHide:true,timeout:90000}); } catch(error) { fs.writeFileSync(scanPath,JSON.stringify({...scan,status:'failed',complete:false,exitCode:1,blockingReason:'final_scan_audit_publish_failed'},null,2)+'\n'); throw error; }
 console.log(JSON.stringify({ok:true,runId:run,status:'complete'}));
}
module.exports={scanReady,validate};if(require.main===module)main();
