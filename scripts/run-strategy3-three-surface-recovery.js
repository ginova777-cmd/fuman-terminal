"use strict";
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function execute(exe,args){cp.execFileSync(exe,args,{cwd:root,stdio:'inherit',windowsHide:true,timeout:600000});}
function node(file,args=[]){execute(process.execPath,['--use-system-ca',path.join(__dirname,file),...args]);}
function main(){
 assert(process.argv.includes('--notifications=disabled-by-user'),'explicit notification policy required');
 const run=(process.argv.find(x=>x.startsWith('--expect-run-id='))||'').slice(16);
 assert(/^strategy3v2-recovery-replay-\d{8}-\d{14}$/.test(run),'exact recovery run required');
 const compact=run.split('-')[3],date=compact.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 const receipts=path.join(runtime,'data/scan-receipts');
 fs.mkdirSync(path.join(runtime,'logs'),{recursive:true});
 process.env.FUMAN_STRATEGY3_RECOVERY_LOG=path.join(runtime,'logs','strategy3-surface-recovery.log');
 const scan=read(path.join(receipts,`strategy3-v2-recovery-replay-${compact}.json`));
 assert.equal(scan.run_id,run);
 node('verify-release-root-authority.js',['--require-production-root']);
 node('supabase-incident-guard.js',['check','--class=guard','--action=strategy3-three-surface-recovery']);
 node('verify-three-surface-complete-scans.js',['--strategy3-only','--write-receipt','--trade-date='+date]);
 node('verify-strategy3-recovery-replay-complete.js',['--trade-date='+date,'--prepare-three-surfaces']);
 const source=read(path.join(receipts,`strategy3-v2-recovery-publish-evidence-${compact}.json`));
 assert(require('../lib/strategy3-recovery-publish-evidence').valid(source,run,date),'source publication evidence invalid');
 process.env.FUMAN_SCORECARD_REFRESH_KEY='strategy3';
 process.env.FUMAN_SCORECARD_REFRESH_RUN_ID=run;
 node('generate-terminal-scorecard-source.js');
 execute('pwsh.exe',['-NoProfile','-File','scripts/run-scorecard88-terminal-collector.ps1','-Slot','13:15','-Recovery','-ExpectedRunId',run,'-RecoveryReason','user-approved-after-close-three-surface-recovery']);
 execute('pwsh.exe',['-NoProfile','-Command',`. './verify-post-scan-tri-surface.ps1'; Assert-PostScanTriSurfaceClosure -Route strategy3 -RunId '${run}' -LogPath $env:FUMAN_STRATEGY3_RECOVERY_LOG -SkipPublication | Out-Null`]);
 const tri=read(path.join(receipts,'tri-surface-closures/strategy3.json'));
 assert(tri.complete===true&&tri.status==='complete'&&tri.runId===run&&['desktopRunId','mobileRunId','scorecardRunId'].every(k=>tri[k]===run),'tri-surface closure invalid');
 const symbols=scan.results.map(x=>x.code).sort();
 const uiDir=path.join(runtime,'data/strategy3-ui');
 const uiArgs=['--only=desktop-night,mobile-phone-portrait-night','--routes=strategy3','--skip-watchlist','--require-content','--include-scorecard','--out='+uiDir,'--expected-run-id='+run,'--expected-symbols='+symbols.join(','),'--trade-date='+date,'--route-timeout=120000','--eval-timeout=60000'];
 node('verify-terminal-ui-e2e.js',uiArgs);
 const report=read(path.join(uiDir,'terminal-ui-e2e-report.json'));
 assert(report.ok===true&&['desktop','mobile','scorecard'].every(kind=>report.results.some(r=>r.kind===kind&&r.routeKey==='strategy3'&&r.ok&&r.contentAcceptance?.actualRun===run&&r.contentAcceptance?.sameSymbols===true)),'actual rendered identities missing');
 const payload={contract:'strategy-runner-verifier-receipt-v1',strategy:'strategy3',tradeDate:date,marketDate:compact,
  runId:run,status:'complete',complete:true,exitCode:0,recoveryReplay:true,naturalSlotComplete:false,fallback:false,
  completionScope:'after_close_scan_database_three_surfaces',notificationPolicy:'disabled_by_user',lineDelivered:false,lineStatus:'DISABLED_BY_USER',
  startedAt:scan.started_at||scan.checked_at,finishedAt:new Date().toISOString(),checkedAt:new Date().toISOString(),
  blockingReason:'',failed_checks:[],first_blocker:null,warnings:[],triSurfaceStatus:'complete',desktopRunId:run,mobileRunId:run,scorecardRunId:run,
  resultCount:scan.result_count,verifiedResultCount:scan.result_count,matches:scan.result_count,count:scan.result_count,
  motherPoolRows:scan.mother_pool_rows,dataReadyCount:source.scannedCount,symbolDataGapRows:scan.symbol_data_gap_rows,
  sourceCoverage:source.coverage_ratio,sourceEvidence:path.join(receipts,`strategy3-v2-recovery-publish-evidence-${compact}.json`),
  renderedEvidence:path.join(uiDir,'terminal-ui-e2e-report.json'),motherPoolMorningAdmission:'separate_previous_trading_day_contract'};
 const target=path.join(receipts,'strategy3-recovery-replay.json');
 const write=p=>{fs.writeFileSync(target+'.tmp',JSON.stringify(p,null,2)+'\n');fs.renameSync(target+'.tmp',target);};
 write(payload);
 try{node('publish-scorecard-scan-audit.js');node('verify-terminal-ui-e2e.js',[...uiArgs,'--require-strategy3-audit']);}
 catch(error){write({...payload,status:'failed',complete:false,exitCode:1,blockingReason:'final_audit_or_rendered_verification_failed',first_blocker:'final_audit_or_rendered_verification_failed'});throw error;}
 console.log(JSON.stringify({ok:true,runId:run,resultCount:scan.result_count,complete:true,notificationPolicy:'disabled_by_user'}));
}
if(require.main===module)try{main();}catch(error){console.error(JSON.stringify({ok:false,reason:error.message}));process.exitCode=1;}
