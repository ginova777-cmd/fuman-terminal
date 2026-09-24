'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
const runtime=process.env.FUMAN_RUNTIME||'C:/fuman-runtime';
const tradeDate=process.env.TRADE_DATE||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date());
const canonical=process.env.MOTHER_POOL_CANONICAL||`fugle_daytrade_source:${tradeDate.replaceAll('-','')}:canonical`;
const dir=path.join(runtime,'data','scan-receipts','modules');
const attempt=randomUUID();fs.mkdirSync(dir,{recursive:true});
const read=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return null;}};
const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json')).map(x=>({file:path.join(dir,x),value:read(path.join(dir,x))}));
const results=[];
for(const moduleId of Object.keys(registry.modules)){
 if(moduleId==='B18'){
  const entry=files.filter(x=>x.value?.type==='mother_pool_closeout_inputs_v1'&&x.value.trade_date===tradeDate&&x.value.canonical_run_id===canonical).sort((a,b)=>Date.parse(b.value.created_at)-Date.parse(a.value.created_at))[0]?.value;
  if(!entry){results.push({module_id:moduleId,status:'pending',complete:false,reason:'CLOSEOUT_ARTIFACT_REQUIRED'});continue;}
  const out=path.join(dir,`b18-verified-${tradeDate}-${attempt}.json`);
  const p=spawnSync(process.execPath,[path.join(__dirname,'verify-mother-pool-closeout.js'),'--closeout='+entry.closeout,'--round1='+entry.round1,'--round2='+entry.round2,'--natural-verification='+entry.natural_verification,'--out='+out],{encoding:'utf8',windowsHide:true,timeout:30000});
  const receipt=read(out),complete=p.status===0&&receipt?.complete===true&&receipt?.exit_code===0;
  results.push({module_id:moduleId,status:complete?'complete':'blocked',complete,out,exit_code:p.status,reason:receipt?.first_blocker||p.stderr||null});continue;
 }

 const list=files.filter(({value:v})=>v?.module_id===moduleId&&v.contract===registry.modules[moduleId]&&v.trade_date===tradeDate&&v.canonical_run_id===canonical&&v.db_readback&&v.anon_readback&&!v.rounds_verified).sort((a,b)=>Date.parse(b.value.observed_at)-Date.parse(a.value.observed_at));
 const selected=[];
 for(const r of list){if(selected.every(x=>x.value.writer_run_id!==r.value.writer_run_id&&x.value.generation_id!==r.value.generation_id&&x.value.snapshot_generation!==r.value.snapshot_generation))selected.push(r);if(selected.length===2)break;}
 if(selected.length<2){results.push({module_id:moduleId,status:'pending',complete:false,reason:'TWO_DISTINCT_ROUNDS_REQUIRED'});continue;}
 selected.reverse();const out=path.join(dir,`${moduleId.toLowerCase()}-verified-${tradeDate}-${attempt}.json`);
 const p=spawnSync(process.execPath,[path.join(__dirname,'verify-daytrade-module-receipt.js'),`--module=${moduleId}`,`--round1=${selected[0].file}`,`--round2=${selected[1].file}`,`--out=${out}`],{encoding:'utf8',windowsHide:true,timeout:30000});
 const receipt=read(out);const complete=p.status===0&&receipt?.complete===true&&receipt?.status==='complete'&&receipt?.exit_code===0;
 results.push({module_id:moduleId,status:complete?'complete':'blocked',complete,out,exit_code:p.status,stdout:p.stdout||'',stderr:p.stderr||'',reason:receipt?.first_blocker||p.error?.message||null});
}
const index=path.join(dir,`module-verification-attempt-${tradeDate}-${attempt}.json`);
fs.writeFileSync(index,JSON.stringify({trade_date:tradeDate,canonical_run_id:canonical,results},null,2),{flag:'wx'});
const out=path.join(runtime,'data','scan-receipts',`mother-pool-a01-b24-total-${tradeDate}-${attempt}.json`);
const total=spawnSync(process.execPath,[path.join(__dirname,'verify-daytrade-mother-pool-a01-b24-total.js'),`--runtime=${runtime}`,`--trade-date=${tradeDate}`,`--canonical=${canonical}`,`--module-results=${index}`,`--out=${out}`],{encoding:'utf8',windowsHide:true,timeout:60000});
const receipt=read(out);const complete=require('../lib/mother-pool-total-acceptance').accepted(results,total,receipt,Object.keys(registry.modules));
const blocked=results.some(x=>x.status==='blocked')||total.error||(!receipt);
const status=complete?'complete':blocked?'blocked':'pending';
console.log(JSON.stringify({execution_status:total.error?'failed':'finished',acceptance_status:status,status,complete,ok:complete,trade_date:tradeDate,canonical_run_id:canonical,results,total:{out,exit_code:total.status,stdout:total.stdout||'',stderr:total.stderr||''},first_blocker:complete?null:receipt?.first_blocker||'TOTAL_VERIFIER_FAILED',exit_code:complete?0:blocked?1:2},null,2));
process.exitCode=complete?0:blocked?1:2;
