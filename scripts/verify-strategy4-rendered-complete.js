'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..'),RUNTIME=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
function location(run){if(!/^strategy4-\d{8}-\d{14}$/.test(run))throw Error('invalid Strategy4 runId');return path.join(RUNTIME,'data/scan-receipts/strategy4-rendered',run);}
function runRendered(run,scan){
 if(scan.status!=='delivering'||scan.complete!==false)throw Error('rendered capture requires staged delivery');
 cp.execFileSync(process.execPath,['--use-system-ca',__filename,'--capture','--expect-run-id='+run],{cwd:ROOT,stdio:'inherit',windowsHide:true,timeout:600000});
 const receiptPath=path.join(location(run),'receipt.json'),r=read(receiptPath);
 const issues=require('../lib/strategy4-rendered-evidence').validateRendered(r,run,scan);
 if(hash(r.reportPath)!==r.reportSha256)issues.push('rendered_report_changed');
 for(const s of r.surfaces)if(hash(s.screenshotPath)!==s.screenshotSha256)issues.push('rendered_screenshot_changed');
 if(issues.length)throw Error(issues.join(';'));
 return {...r,receiptPath};
}
async function capture(run){
 const dir=location(run);fs.mkdirSync(dir,{recursive:true});const receiptPath=path.join(dir,'receipt.json');
 // Replace prior evidence with a non-success marker before any new attempt.
 fs.writeFileSync(receiptPath,JSON.stringify({ok:false,runId:run,status:'verifying'}));
 const scan=read(path.join(RUNTIME,'data/scan-receipts/strategy4.json'));
 if(scan.runId!==run||scan.status!=='delivering'||scan.complete!==false)throw Error('scan stage mismatch');
 const opts={root:ROOT,runtimeDir:RUNTIME},{terminalSupabaseKey,terminalSupabaseUrl}=require('../lib/server-supabase-key');
 const key=terminalSupabaseKey(opts),base=terminalSupabaseUrl(opts).replace(/\/$/,'');
 async function get(table,q){const res=await fetch(base+'/rest/v1/'+table+'?'+new URLSearchParams(q),{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(60000)});if(!res.ok)throw Error('Strategy4 DB HTTP '+res.status);return res.json();}
 const runs=await get('strategy4_scan_runs',{select:'*',run_id:'eq.'+run,limit:1});const db=runs[0];
 if(!db||db.complete!==true||db.result_count!==scan.matches||db.scanned_count!==scan.scanned||db.expected_total!==scan.total)throw Error('DB run mismatch');
 const rows=[];for(let offset=0;offset<db.result_count;offset+=1000){const page=await get('strategy4_scan_results',{select:'code,run_id,scan_date,payload',run_id:'eq.'+run,order:'rank.asc',offset,limit:1000});if(!page.length)break;rows.push(...page);}
 const issues=require('../lib/strategy4-v4-evidence').strategy4V4Issues(db.payload||{},rows);
 const symbols=rows.map(x=>String(x.code)).sort();
 if(rows.length!==scan.matches||new Set(symbols).size!==symbols.length||issues.length)throw Error('DB full readback invalid '+issues.join(';'));
 const day=run.split('-')[1];if(String(scan.tradeDate).replace(/-/g,'')!==day||rows.some(x=>String(x.run_id)!==run||String(x.scan_date).replace(/-/g,'')!==day))throw Error('DB row date/run mismatch');
 cp.execFileSync(process.execPath,['--use-system-ca',path.join(__dirname,'verify-terminal-ui-e2e.js'),'--base-url=https://fuman-terminal.vercel.app','--only=desktop-night,mobile-phone-portrait-night','--routes=strategy4','--skip-watchlist','--include-strategy4-scorecard','--require-content','--trade-date='+String(scan.tradeDate).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),'--expected-run-id='+run,'--expected-symbols='+symbols.join(','),'--out='+dir,'--route-timeout=120000','--eval-timeout=60000'],{cwd:ROOT,stdio:'inherit',windowsHide:true,timeout:540000});
 const reportPath=path.join(dir,'terminal-ui-e2e-report.json'),report=read(reportPath);
 if(report.ok!==true||report.baseUrl!=='https://fuman-terminal.vercel.app')throw Error('formal rendered report failed');
 const surfaces=report.results.filter(x=>x.routeKey==='strategy4').map(x=>({kind:x.kind,ok:x.ok===true&&x.contentAcceptance?.sameSymbols===true,runId:x.contentAcceptance?.actualRun,symbols:x.contentAcceptance?.actualSymbols,screenshotPath:x.screenshot,screenshotSha256:hash(x.screenshot)}));
 const receipt={contract:'strategy4_rendered_complete_v1',ok:true,runId:run,tradeDate:day,resultCount:symbols.length,symbols,checkedAt:new Date().toISOString(),reportPath,reportSha256:hash(reportPath),surfaces};
 const invalid=require('../lib/strategy4-rendered-evidence').validateRendered(receipt,run,scan);if(invalid.length)throw Error(invalid.join(';'));
 fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({ok:true,runId:run,renderedSurfaces:3,receiptPath}));
}
module.exports={runRendered};
if(require.main===module){const run=(process.argv.find(x=>x.startsWith('--expect-run-id='))||'').slice(16);capture(run).catch(e=>{console.error(JSON.stringify({ok:false,reason:e.message}));process.exitCode=1;});}

