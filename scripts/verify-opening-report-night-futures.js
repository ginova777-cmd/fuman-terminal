"use strict";
const fs=require('fs'),path=require('path'),m=require('../lib/opening-report-night-futures'),recovery=require('../lib/opening-report-recovery');
const value=(key,defaultValue)=>process.argv.find(a=>a.startsWith(key+'='))?.slice(key.length+1)||defaultValue;
async function main(){
 const date=value('--date',new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 const diagnostic=process.argv.includes('--capture-diagnostic'),runId=value('--run-id','night-source-diagnostic-'+date.replace(/-/g,'')+'-'+Date.now());
 const out=value('--output','');
 if(diagnostic&&!out)throw Error('diagnostic_requires_isolated_output');
 const file=value('--snapshot',path.join(process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime','data','opening-report-0830','opening-report-0830-market-snapshot-'+date.replace(/-/g,'')+'.json'));
 const snapshot=diagnostic?null:JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 const e=diagnostic?await m.capture({date,runId,cutoff:recovery.cutoff(date),directory:path.dirname(path.resolve(out)),diagnostic:true}):snapshot.night_futures;
 const issues=m.verify(e,{date,runId:diagnostic?runId:snapshot.run_id,cutoff:recovery.cutoff(date),diagnostic});
 const r={contract:m.CONTRACT,checked_at:new Date().toISOString(),diagnostic,production_complete:false,ok:issues.length===0,status:diagnostic?'diagnostic':issues.length?'failed':'source_verified',issues,night_futures:e,summary:m.summary(e)};
 if(out){fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(r,null,2));}
 console.log(JSON.stringify(r,null,2));if(issues.length)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
