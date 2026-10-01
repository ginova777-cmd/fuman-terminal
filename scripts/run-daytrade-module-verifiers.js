'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
const moduleArg=process.argv.find(x=>x.startsWith('--modules='));
const requested=moduleArg?moduleArg.slice('--modules='.length).split(','):Object.keys(registry.modules);
if(!requested.length||new Set(requested).size!==requested.length||requested.some(id=>!Object.hasOwn(registry.modules,id)))throw Error('INVALID_MODULE_SELECTION');
const scoped=Boolean(moduleArg);
const runtime=process.env.FUMAN_RUNTIME||'C:/fuman-runtime';
const tradeDate=process.env.TRADE_DATE||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date());
const canonical=process.env.MOTHER_POOL_CANONICAL||`fugle_daytrade_source:${tradeDate.replaceAll('-','')}:canonical`;
const dir=path.join(runtime,'data','scan-receipts','modules');
const attempt=randomUUID();fs.mkdirSync(dir,{recursive:true});
const readErrors=[];
const read=f=>{try{if(fs.statSync(f).size>16*1024*1024){readErrors.push({file:f,reason:'RECEIPT_SIZE_LIMIT'});return null;}return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return null;}};
// Scoped validation must not parse unrelated modules or historical receipts.
// The payload identity checks below still decide whether a receipt is eligible.
const dates=[tradeDate,tradeDate.replaceAll('-','')];
const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json')&&(!scoped||(requested.includes('B18')&&x.startsWith('closeout-input-'))||(dates.some(d=>x.includes(d))&&requested.some(id=>x.toLowerCase().startsWith(id.toLowerCase()+'-'))))).map(x=>({file:path.join(dir,x),value:read(path.join(dir,x))}));
const results=[];
for(const moduleId of requested){
 if(moduleId==='B18'){
  const entry=files.filter(x=>x.value?.type==='mother_pool_closeout_inputs_v1'&&x.value.trade_date===tradeDate&&x.value.canonical_run_id===canonical).sort((a,b)=>Date.parse(b.value.created_at)-Date.parse(a.value.created_at))[0]?.value;
  if(!entry){results.push({module_id:moduleId,status:'pending',complete:false,reason:'CLOSEOUT_ARTIFACT_REQUIRED'});continue;}
  const out=path.join(dir,`b18-verified-${tradeDate}-${attempt}.json`);
  const p=spawnSync(process.execPath,[path.join(__dirname,'verify-mother-pool-closeout.js'),'--closeout='+entry.closeout,'--round1='+entry.round1,'--round2='+entry.round2,'--natural-verification='+entry.natural_verification,'--out='+out],{encoding:'utf8',windowsHide:true,timeout:30000});
  const receipt=read(out),complete=p.status===0&&receipt?.complete===true&&receipt?.exit_code===0;
  results.push({module_id:moduleId,status:complete?'complete':'blocked',complete,out,exit_code:p.status,reason:receipt?.first_blocker||p.stderr||null});continue;
 }

 const list=files.filter(({value:v})=>v?.module_id===moduleId&&v.contract===registry.modules[moduleId]&&v.trade_date===tradeDate&&v.canonical_run_id===canonical&&v.db_readback&&v.anon_readback&&!v.rounds_verified).sort((a,b)=>Date.parse(b.value.observed_at)-Date.parse(a.value.observed_at));
 const selected=require('../lib/mother-pool-select-verifier-rounds').select(list,process.env.MOTHER_POOL_REQUIRED_WRITER_RUN_ID);
 if(selected.length<2){results.push({module_id:moduleId,status:'pending',complete:false,reason:'TWO_DISTINCT_ROUNDS_REQUIRED'});continue;}
 const out=path.join(dir,`${moduleId.toLowerCase()}-verified-${tradeDate}-${attempt}.json`);
 const p=spawnSync(process.execPath,[path.join(__dirname,'verify-daytrade-module-receipt.js'),'--summary',`--module=${moduleId}`,`--round1=${selected[0].file}`,`--round2=${selected[1].file}`,`--out=${out}`],{encoding:'utf8',windowsHide:true,timeout:30000});
 const receipt=read(out);const complete=p.status===0&&receipt?.complete===true&&receipt?.status==='complete'&&receipt?.exit_code===0;
 results.push({module_id:moduleId,status:complete?'complete':'blocked',complete,out,exit_code:p.status,stdout:p.stdout||'',stderr:p.stderr||'',reason:receipt?.first_blocker||p.error?.message||null});
}
const index=path.join(dir,`module-verification-attempt-${tradeDate}-${attempt}.json`);
fs.writeFileSync(index,JSON.stringify({trade_date:tradeDate,canonical_run_id:canonical,results},null,2),{flag:'wx'});
if(scoped){
 const passed=results.length===requested.length&&results.every(x=>x.complete===true)&&readErrors.length===0;
 console.log(JSON.stringify({scope:'selected_modules',requested,complete:false,overall_acceptance:'NOT_EVALUATED',selected_modules_passed:passed,results,read_errors:readErrors,index,exit_code:passed?0:2},null,2));
 process.exit(passed?0:2);
}
const out=path.join(runtime,'data','scan-receipts',`mother-pool-a01-b24-total-${tradeDate}-${attempt}.json`);
const total=spawnSync(process.execPath,[path.join(__dirname,'verify-daytrade-mother-pool-a01-b24-total.js'),`--runtime=${runtime}`,`--trade-date=${tradeDate}`,`--canonical=${canonical}`,`--module-results=${index}`,`--out=${out}`],{encoding:'utf8',windowsHide:true,timeout:60000});
const receipt=read(out);const complete=readErrors.length===0&&require('../lib/mother-pool-total-acceptance').accepted(results,total,receipt,Object.keys(registry.modules));
const blocked=results.some(x=>x.status==='blocked')||total.error||(!receipt);
const status=complete?'complete':blocked?'blocked':'pending';
console.log(JSON.stringify({execution_status:total.error?'failed':'finished',acceptance_status:status,status,complete,ok:complete,trade_date:tradeDate,canonical_run_id:canonical,results,total:{out,exit_code:total.status,stdout:total.stdout||'',stderr:total.stderr||''},first_blocker:complete?null:receipt?.first_blocker||'TOTAL_VERIFIER_FAILED',exit_code:complete?0:blocked?1:2},null,2));
process.exitCode=complete?0:blocked?1:2;
