"use strict";
const {spawnSync}=require('child_process');
const checks=[['retired','cleanup-api-only-retired-artifacts.js',['--dry-run','--json','--root','C:\\fuman-terminal','--runtime-root','C:\\fuman-runtime']],['runtime','cleanup-runtime-retention.js',['--json','--no-status']],['history','cleanup-supabase-vercel-history.js',['--dry-run','--json','--no-status']]];
const results=[],issues=[];
for(const [name,script,args] of checks){
 const r=spawnSync(process.execPath,['--use-system-ca',`scripts/${script}`,...args],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:32*1024*1024,env:{...process.env,FUMAN_HISTORY_CLEANUP_ENABLE_VERCEL_CLI:'1'}});
 let p;try{p=JSON.parse(r.stdout);}catch{}
 const remaining=name==='retired'?p?.deletedCount:name==='runtime'?p?.candidates:p?.supabase?.sections?.reduce((n,s)=>n+Number(s.candidates||s.candidateRuns||0),0)+Number(p?.vercel?.candidateDeployments||0);
 const ok=r.status===0&&p?.ok===true&&remaining===0&&(name!=='history'||(p.supabase?.ok===true&&p.vercel?.ok===true&&!p.supabase.skipped&&!p.vercel.skipped));
 results.push({name,ok,remaining,payload:p,error:r.stderr||r.error?.message||null});if(!ok)issues.push(`cleanup_readback_remaining_or_failed:${name}`);
}
console.log(JSON.stringify({ok:issues.length===0,checkedAt:new Date().toISOString(),results,issues},null,2));
if(issues.length)process.exitCode=1;
