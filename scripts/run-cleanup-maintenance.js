"use strict";
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const context=require('./cleanup-maintenance-context');
const arg=name=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
const save=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');};
let roundDeadline;
function command(file,args,log,env={}) {
  return new Promise(resolve=>{
    const remaining=Math.min(20*60*1000,roundDeadline-Date.now());
    if(!(remaining>0)){resolve({exitCode:1,error:'cleanup_round_deadline_exceeded'});return;}
    const fd=fs.openSync(log,'w');let settled=false,timedOut=false,timer;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);fs.closeSync(fd);resolve({...value,timedOut});};
    let child;
    try{child=spawn(file,args,{cwd:context.ROOT,env:{...process.env,...env},windowsHide:true,stdio:['ignore',fd,fd]});}
    catch(error){finish({exitCode:1,error:error.message});return;}
    timer=setTimeout(()=>{timedOut=true;child.kill();},remaining);
    child.once('error',error=>finish({exitCode:1,error:error.message}));
    child.once('close',(code,signal)=>finish({exitCode:timedOut?1:(code??1),signal}));
  });
}
function protectedFiles(){
  const files=[path.join(context.RUNTIME,'cache/intraday/fugle-daytrade-ws-candles.json'),path.join(context.RUNTIME,'logs/production-health.jsonl')];
  const dir=path.join(context.RUNTIME,'data/scan-receipts');
  for(const e of (fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}):[])) if(e.isFile() && (/latest/i.test(e.name)||!/(?:20\d{2}[-]?\d{2}[-]?\d{2})/.test(e.name)) && !/^(?:daytrade-priority-cache-stale-rejected|cleanup-maintenance)/.test(e.name)) files.push(path.join(dir,e.name));
  return files.filter(f=>fs.existsSync(f)).map(file=>({file,sha256:context.hash(file)}));
}
async function main(){
  if(!process.argv.includes('--apply'))throw Error('explicit_apply_required');
  let authorizationFile=arg('authorization');
  if(process.argv.includes('--scheduled')){
    const cp=require('child_process');
    const gate=cp.spawnSync(process.execPath,['scripts/verify-release-root-authority.js','--require-production-root'],{cwd:context.ROOT,encoding:'utf8',windowsHide:true,timeout:60000});
    if(gate.status!==0)throw Error('release_root_drift');
    const calendar=await require('./twse-trading-day').isTwseTradingDay(new Date(),{stateDir:path.join(context.RUNTIME,'state'),ignoreOverrides:true});
    if(calendar.error||calendar.source==='weekend_fallback')throw Error('calendar_unverified');
    if(!calendar.isTradingDay){console.log(JSON.stringify({status:'SKIPPED',complete:false,reason:'non_applicable_day'}));return;}
    const issuedAt=new Date().toISOString(),runId='cleanup-'+context.date().replaceAll('-','')+'-'+require('crypto').randomUUID();
    const origin=require('../lib/strategy-natural-evidence').collect({strategy:'cleanup',scan:{runId,tradeDate:context.date(),startedAt:issuedAt},formalComplete:false,originOnly:true,recovery:false,root:context.ROOT,runtime:context.RUNTIME});
    if(origin.naturalTriggerVerified!==true)throw Error('scheduled_trigger_unverified_before_cleanup');
    authorizationFile=path.join(context.RUNTIME,'status','cleanup-contexts',runId+'.json');
    save(authorizationFile,{contract:'cleanup-scheduled-context-v1',scope:context.scopedPolicy.scope,authorizedBy:'release-policy',authorizationText:'Approved deployed single-start policy; this is execution context, not user approval',date:context.date(),runId,keepDays:15,preserveWorkdaySchedule:true,sourceRoot:context.SOURCE_ROOT,executionRoot:context.ROOT,runtimeRoot:context.RUNTIME,issuedAt,expiresAt:new Date(Date.now()+20*60*1000).toISOString()});
  }
  const auth=context.authorization(authorizationFile);
  roundDeadline=Math.min(Date.parse(auth.expiresAt),Date.now()+20*60*1000);
  if(!Number.isFinite(roundDeadline))throw Error('cleanup_round_deadline_missing');
  if(fs.existsSync(auth.journalFile))throw Error('cleanup_maintenance_run_already_exists_use_read_only_verifier');
  const protectionBefore=protectedFiles();
  const lock=path.join(context.RUNTIME,'locks/cleanup-maintenance.lock');fs.mkdirSync(path.dirname(lock),{recursive:true});const lockFd=fs.openSync(lock,'wx');
  const j={contract:'cleanup-maintenance-execution-v1',runId:auth.runId,authorizationSha256:auth.sha256,deadlineAt:new Date(roundDeadline).toISOString(),executionMode:auth.executionMode||"authorized_maintenance",completionScope:auth.scope,deferredItems:context.scopedPolicy && auth.scope===context.scopedPolicy.scope?context.scopedPolicy.deferredItems:[],startedAt:new Date().toISOString(),steps:[],protection:{before:protectionBefore}};
  const logDir=path.join(context.RUNTIME,'logs',auth.runId);
  const saveTotal=receipt=>{const archive=path.join(context.RUNTIME,'status/cleanup-totals',auth.runId+'.json');fs.mkdirSync(path.dirname(archive),{recursive:true});fs.writeFileSync(archive,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});save(totalFile,receipt);};
  const totalFile=path.join(context.RUNTIME,'status',`cleanup-total-${auth.date.replaceAll('-','')}.json`);fs.mkdirSync(logDir,{recursive:true});save(auth.journalFile,j);
  let executionError;
  try {
    const preflight=await command(process.execPath,['scripts/supabase-incident-guard.js','check','--class=guard','--action=authorized-cleanup-maintenance'],path.join(logDir,'incident.log'));
    if(preflight.exitCode)throw Error('supabase_incident_blocked');
    const root=await command(process.execPath,['scripts/verify-release-root-authority.js','--require-production-root'],path.join(logDir,'authority.log'));
    if(root.exitCode)throw Error('release_root_drift');
    const {isTwseTradingDay}=require('./twse-trading-day');
    let referenceTradeDate;
    for(let days=0;days<15;days++){
      const d=new Date(Date.parse(auth.date+'T04:00:00Z')-days*86400000);
      const c=await isTwseTradingDay(d,{stateDir:path.join(context.RUNTIME,'state'),ignoreOverrides:true});
      if(c.error||c.source==='weekend_fallback')throw Error('maintenance_reference_calendar_unavailable');
      if(c.isTradingDay){referenceTradeDate=c.date;break;}
    }
    if(!referenceTradeDate)throw Error('maintenance_reference_trade_date_missing');
    j.referenceTradeDate=referenceTradeDate;save(auth.journalFile,j);
    const plan=[['retired','cleanup-api-only-retired-artifacts.js',['--root','C:\\fuman-terminal','--runtime-root',context.RUNTIME,'--json',`--maintenance-authorization=${auth.file}`]],['history','cleanup-supabase-vercel-history.js',['--apply','--json','--maintenance-authorization='+auth.file]],['intraday','cleanup-daytrade-intraday-retention.js',['--apply','--max-batches=60','--json']],['runtime','cleanup-runtime-retention.js',['--apply','--json',"--maintenance-authorization="+auth.file]],['priority','cleanup-daytrade-stale-priority-cache.js',['--apply','--json',`--reference-trade-date=${referenceTradeDate}`]],['observability','cleanup-source-observability-retention.js',['--apply','--json']],['extended','cleanup-extended-retention.js',['--apply',`--maintenance-authorization=${auth.file}`]],['cost','monitor-vercel-cost-health.js',[]],['janitor','verify-global-cost-janitor-scorecard.js',[]]];
    for(const [name,script,args] of plan.filter(([name])=>context.requiredSteps?context.requiredSteps(auth).includes(name):true)){
      context.authorization(auth.file);
      if(Date.now()>=roundDeadline)throw Error('cleanup_round_deadline_exceeded');
      const row={name,script,startedAt:new Date().toISOString(),logFile:path.join(logDir,`${name}.log`),receipts:[]};j.steps.push(row);save(auth.journalFile,j);
      Object.assign(row,await command(process.execPath,['--use-system-ca',`scripts/${script}`,...args],row.logFile,{FUMAN_CLEANUP_CONTEXT_FILE:auth.file,FUMAN_HISTORY_CLEANUP_ENABLE_VERCEL_CLI:'1',FUMAN_PRODUCTION_MIRROR_ROOT:'C:\\fuman-terminal'}));
      row.finishedAt=new Date().toISOString();
      row.receipts=(context.receipts()[name]||[]).filter(f=>fs.existsSync(f)).map(file=>({file,sha256:context.hash(file)}));save(auth.journalFile,j);
      // Do not initiate another stage after an unsuccessful or uncertain operation.
      // Record the failure before finally closes this run and releases its lock.
      const log=fs.readFileSync(row.logFile,'utf8');
      const incident=/HTTP[ _:]?52[0-9]|cannot check out|retry_after|owner_action_required|TimeoutError|AbortError|timed?\s*out|ECONNRESET|ECONNREFUSED|fetch failed/i.test(log);
      if(row.exitCode!==0 || incident){
        j.firstFailure={step:name,exitCode:row.exitCode,reason:incident?'supabase_incident_stop':'cleanup_stage_failed',logFile:row.logFile};
        save(auth.journalFile,j);
        throw Error(`${j.firstFailure.reason}:${name}`);
      }
    }
  } catch(error) {
    executionError=error;j.firstFailure=j.firstFailure||{reason:error.message};
  } finally {
    j.finishedAt=new Date().toISOString();j.protection.changed=j.protection.before.filter(x=>!fs.existsSync(x.file)||context.hash(x.file)!==x.sha256);j.protection.ok=j.protection.changed.length===0;save(auth.journalFile,j);fs.closeSync(lockFd);fs.unlinkSync(lock);
  }
  try {
  if(executionError)throw executionError;
  context.verifyJournal(auth);
  if(context.scopedPolicy && auth.scope===context.scopedPolicy.scope){
    j.items=j.steps.flatMap(step=>step.receipts.flatMap(e=>{const payload=JSON.parse(fs.readFileSync(e.file,'utf8'));return payload.cleanupItems||[];}));
    context.verifyScopedItems(j);
  }
  if(j.executionMode==='scheduled_workday'){
    j.naturalOrigin=require('../lib/strategy-natural-evidence').collect({strategy:'cleanup',scan:{runId:auth.runId,tradeDate:auth.date,startedAt:auth.issuedAt},formalComplete:true,recovery:false,root:context.ROOT,runtime:context.RUNTIME});
    if(j.naturalOrigin.naturalSlotComplete!==true)throw Error('cleanup_natural_completion_unverified');
  }
  const receipt={contract:'cleanup-total-v1',runId:auth.runId,tradeDate:auth.date,executionMode:j.executionMode,completionScope:auth.scope,deferredItems:j.deferredItems,complete:true,fullSuiteComplete:false,status:'complete',exitCode:0,first_blocker:null,failed_checks:[],journalFile:auth.journalFile,contextFile:auth.file,contextSha256:auth.sha256,checkedAt:new Date().toISOString()};
  save(auth.journalFile,j);receipt.journalSha256=context.hash(auth.journalFile);saveTotal(receipt);
  }catch(error){j.firstFailure=j.firstFailure||{reason:error.message};save(auth.journalFile,j);saveTotal({contract:'cleanup-total-v1',runId:auth.runId,tradeDate:auth.date,executionMode:j.executionMode,completionScope:auth.scope,deferredItems:j.deferredItems,status:'failed',complete:false,fullSuiteComplete:false,exitCode:1,first_blocker:error.message,failed_checks:[error.message],journalFile:auth.journalFile,checkedAt:new Date().toISOString()});throw error;}
  console.log(JSON.stringify({ok:true,runId:auth.runId,journalFile:auth.journalFile,next:'Root Monitor CleanupMaintenance read-only acceptance'},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
