'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {command:verifierCommand}=require('../lib/windows-verifier-command.cjs');
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
const read=f=>{try{if(fs.statSync(f).size>16*1024*1024){readErrors.push({file:f,reason:'RECEIPT_SIZE_LIMIT'});return null;}return require('../lib/daytrade-shared-evidence.cjs').read(f,runtime);}catch(e){readErrors.push({file:f,reason:e.message});return null;}};
const inspect=f=>{try{return require('../lib/daytrade-shared-evidence.cjs').inspect(f,runtime);}catch(e){readErrors.push({file:f,reason:e.message});return null;}};
// Scoped validation must not parse unrelated modules or historical receipts.
// The payload identity checks below still decide whether a receipt is eligible.
const dates=[tradeDate,tradeDate.replaceAll('-','')];
const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json')&&(!scoped||(requested.includes('B18')&&x.startsWith('closeout-input-'))||(dates.some(d=>x.includes(d))&&requested.some(id=>x.toLowerCase().startsWith(id.toLowerCase()+'-'))))).map(x=>({file:path.join(dir,x),value:x.startsWith('closeout-input-')?read(path.join(dir,x)):inspect(path.join(dir,x))}));
const results=[];
const children=new Set();
process.once('SIGTERM',()=>{for(const child of children)child.kill();process.exit(143);});
function runChild(args,onProcessExit=()=>{}){return new Promise(resolve=>{
 const command=verifierCommand(process.execPath,args);
 let child;try{child=require('node:child_process').execFile(command.file,command.args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024},(error,stdout,stderr)=>{
  children.delete(child);onProcessExit();resolve({pid:child.pid,status:error?(Number.isInteger(error.code)?error.code:null):0,signal:error?.signal||null,error:error&&!Number.isInteger(error.code)?error:null,stdout,stderr});
 });children.add(child);}catch(error){resolve({status:null,error,stdout:'',stderr:''});}
});}
function selectRounds(moduleId){
 const list=files.filter(({value:v})=>v?.module_id===moduleId&&v.contract===registry.modules[moduleId]&&v.trade_date===tradeDate&&v.canonical_run_id===canonical&&v.db_readback&&v.anon_readback&&!v.rounds_verified);
 return require('../lib/mother-pool-select-verifier-rounds').select(list,process.env.MOTHER_POOL_REQUIRED_WRITER_RUN_ID);
}
async function verifyOne(moduleId,onProcessExit=()=>{}){
 if(moduleId==='B18'){
  const entry=files.filter(x=>x.value?.type==='mother_pool_closeout_inputs_v1'&&x.value.trade_date===tradeDate&&x.value.canonical_run_id===canonical).sort((a,b)=>Date.parse(b.value.created_at)-Date.parse(a.value.created_at))[0]?.value;
  if(!entry){return {module_id:moduleId,status:'pending',complete:false,reason:'CLOSEOUT_ARTIFACT_REQUIRED'};}
  const out=path.join(dir,`b18-verified-${tradeDate}-${attempt}.json`);
  const command=verifierCommand(process.execPath,[path.join(__dirname,'verify-mother-pool-closeout.js'),'--closeout='+entry.closeout,'--round1='+entry.round1,'--round2='+entry.round2,'--natural-verification='+entry.natural_verification,'--out='+out]);
  const p=spawnSync(command.file,command.args,{encoding:'utf8',windowsHide:true,timeout:30000});
  const receipt=read(out),complete=p.status===0&&receipt?.complete===true&&receipt?.exit_code===0;
  return {module_id:moduleId,status:complete?'complete':'blocked',complete,out,exit_code:p.status,reason:receipt?.first_blocker||p.stderr||null};
 }

 const selected=selectRounds(moduleId);
 if(selected.length<2){return {module_id:moduleId,status:'pending',complete:false,reason:'TWO_DISTINCT_ROUNDS_REQUIRED'};}
 const out=path.join(dir,`${moduleId.toLowerCase()}-verified-${tradeDate}-${attempt}.json`);
 const started=process.hrtime.bigint();
 const p=await runChild([path.join(__dirname,'verify-daytrade-module-receipt.js'),'--summary',`--module=${moduleId}`,`--round1=${selected[0].file}`,`--round2=${selected[1].file}`,`--out=${out}`],onProcessExit);
 let receipt=null,validationError=null;
 try{
  receipt=JSON.parse(p.stdout||'{}');
  if(receipt.module_id!==moduleId||receipt.contract!==registry.modules[moduleId]||receipt.trade_date!==tradeDate||receipt.canonical_run_id!==canonical||receipt.out!==out||JSON.stringify(receipt.writer_run_ids)!==JSON.stringify(selected.map(x=>x.value.writer_run_id)))throw Error('VERIFIER_PROCESS_IDENTITY');
  require('../lib/daytrade-shared-evidence.cjs').verifyProcessBytes(out,runtime,receipt.content_sha256);
 }catch(e){validationError=e.message;readErrors.push({file:out,reason:e.message});}
 const complete=!validationError&&!p.error&&p.status===0&&receipt?.complete===true&&receipt?.status==='complete'&&receipt?.exit_code===0;
 return {module_id:moduleId,status:complete?'complete':'blocked',complete,out,exit_code:p.status,pid:p.pid,elapsed_ms:Number(process.hrtime.bigint()-started)/1e6,signal:p.signal,error:p.error?{code:p.error.code,message:p.error.message}:null,stdout:p.stdout||'',stderr:p.stderr||'',reason:validationError||receipt?.first_blocker||p.error?.message||null};
}
async function main(){
 // At most two existing independent verifier processes. Keep result order,
 // child timeout, byte validation and the caller's 45-second deadline.
 // Release a process slot after exit, before independent parent readback.
 // All validation promises still settle before any acceptance decision.
 const order=requested.map((id,index)=>({index,bytes:selectRounds(id).reduce((n,x)=>n+fs.statSync(x.file).size,0)})).sort((a,b)=>b.bytes-a.bytes||a.index-b.index);
 let cursor=0,active=0;const pending=[];
 function pump(){while(active<2&&cursor<order.length){const i=order[cursor++].index;active++;let released=false;
  const release=()=>{if(released)return;released=true;active--;pump();};
  const task=verifyOne(requested[i],release).then(value=>{results[i]=value;}).finally(release);
  pending.push(task);
 }}
 pump();
 for(let i=0;i<pending.length;i++)await pending[i];

const index=path.join(dir,`module-verification-attempt-${tradeDate}-${attempt}.json`);
fs.writeFileSync(index,JSON.stringify({trade_date:tradeDate,canonical_run_id:canonical,results},null,2),{flag:'wx'});
if(scoped){
 const passed=results.length===requested.length&&results.every(x=>x.complete===true)&&readErrors.length===0;
 console.log(JSON.stringify({scope:'selected_modules',requested,required_writer_run_id:process.env.MOTHER_POOL_REQUIRED_WRITER_RUN_ID||null,complete:false,overall_acceptance:'NOT_EVALUATED',selected_modules_passed:passed,results,read_errors:readErrors,index,exit_code:passed?0:2},null,2));
 process.exit(passed?0:2);
}
const out=path.join(runtime,'data','scan-receipts',`mother-pool-a01-b24-total-${tradeDate}-${attempt}.json`);
const totalCommand=verifierCommand(process.execPath,[path.join(__dirname,'verify-daytrade-mother-pool-a01-b24-total.js'),`--runtime=${runtime}`,`--trade-date=${tradeDate}`,`--canonical=${canonical}`,`--module-results=${index}`,`--out=${out}`]);
const total=spawnSync(totalCommand.file,totalCommand.args,{encoding:'utf8',windowsHide:true,timeout:60000});
const receipt=read(out);const complete=readErrors.length===0&&require('../lib/mother-pool-total-acceptance').accepted(results,total,receipt,Object.keys(registry.modules));
const blocked=results.some(x=>x.status==='blocked')||total.error||(!receipt);
const status=complete?'complete':blocked?'blocked':'pending';
console.log(JSON.stringify({execution_status:total.error?'failed':'finished',acceptance_status:status,status,complete,ok:complete,trade_date:tradeDate,canonical_run_id:canonical,results,total:{out,exit_code:total.status,stdout:total.stdout||'',stderr:total.stderr||''},first_blocker:complete?null:receipt?.first_blocker||'TOTAL_VERIFIER_FAILED',exit_code:complete?0:blocked?1:2},null,2));
process.exitCode=complete?0:blocked?1:2;

}
main().catch(error=>{console.error(error);process.exitCode=1;});
