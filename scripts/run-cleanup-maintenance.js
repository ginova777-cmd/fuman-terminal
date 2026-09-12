"use strict";
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const context=require('./cleanup-maintenance-context');
const arg=name=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
const save=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');};
function command(file,args,log,env={}) {return new Promise(resolve=>{const fd=fs.openSync(log,'w');const child=spawn(file,args,{cwd:context.ROOT,env:{...process.env,...env},windowsHide:true,stdio:['ignore',fd,fd]});const timeout=setTimeout(()=>child.kill(),20*60*1000);child.on('error',error=>{clearTimeout(timeout);fs.closeSync(fd);resolve({exitCode:1,error:error.message});});child.on('exit',(code,signal)=>{clearTimeout(timeout);fs.closeSync(fd);resolve({exitCode:code??1,signal});});});}
function protectedFiles(){
  const files=[path.join(context.RUNTIME,'cache/intraday/fugle-daytrade-ws-candles.json'),path.join(context.RUNTIME,'logs/production-health.jsonl')];
  const dir=path.join(context.RUNTIME,'data/scan-receipts');
  for(const e of fs.readdirSync(dir,{withFileTypes:true})) if(e.isFile() && (/latest/i.test(e.name)||!/(?:20\d{2}[-]?\d{2}[-]?\d{2})/.test(e.name)) && !/^(?:daytrade-priority-cache-stale-rejected|cleanup-maintenance)/.test(e.name)) files.push(path.join(dir,e.name));
  return files.filter(f=>fs.existsSync(f)).map(file=>({file,sha256:context.hash(file)}));
}
async function main(){
  if(!process.argv.includes('--apply'))throw Error('explicit_apply_required');
  const auth=context.authorization(arg('authorization'));
  if(fs.existsSync(auth.journalFile))throw Error('cleanup_maintenance_run_already_exists_use_read_only_verifier');
  const lock=path.join(context.RUNTIME,'locks/cleanup-maintenance.lock');fs.mkdirSync(path.dirname(lock),{recursive:true});const lockFd=fs.openSync(lock,'wx');
  const j={contract:'cleanup-maintenance-execution-v1',runId:auth.runId,authorizationSha256:auth.sha256,startedAt:new Date().toISOString(),steps:[],protection:{before:protectedFiles()}};
  const logDir=path.join(context.RUNTIME,'logs',auth.runId);fs.mkdirSync(logDir,{recursive:true});save(auth.journalFile,j);
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
    const plan=[['retired','cleanup-api-only-retired-artifacts.js',['--root','C:\\fuman-terminal','--runtime-root',context.RUNTIME,'--json']],['history','cleanup-supabase-vercel-history.js',['--apply','--json']],['intraday','cleanup-daytrade-intraday-retention.js',['--apply','--max-batches=60','--json']],['runtime','cleanup-runtime-retention.js',['--apply','--json']],['priority','cleanup-daytrade-stale-priority-cache.js',['--apply','--json',`--reference-trade-date=${referenceTradeDate}`]],['observability','cleanup-source-observability-retention.js',['--apply','--json']],['cost','monitor-vercel-cost-health.js',[]],['janitor','verify-global-cost-janitor-scorecard.js',[]]];
    for(const [name,script,args] of plan){
      context.authorization(auth.file);
      const row={name,script,startedAt:new Date().toISOString(),logFile:path.join(logDir,`${name}.log`),receipts:[]};j.steps.push(row);save(auth.journalFile,j);
      Object.assign(row,await command(process.execPath,['--use-system-ca',`scripts/${script}`,...args],row.logFile,{FUMAN_HISTORY_CLEANUP_ENABLE_VERCEL_CLI:'1',FUMAN_PRODUCTION_MIRROR_ROOT:'C:\\fuman-terminal'}));
      row.finishedAt=new Date().toISOString();
      row.receipts=context.receipts()[name].filter(f=>fs.existsSync(f)).map(file=>({file,sha256:context.hash(file)}));save(auth.journalFile,j);
      // Independent stages continue after a bounded stage failure; the canonical verifier still rejects it.
      const log=fs.readFileSync(row.logFile,'utf8');if(/HTTP 522|cannot check out|retry_after|owner_action_required/i.test(log))throw Error('supabase_incident_stop');
    }
  } finally {
    j.finishedAt=new Date().toISOString();j.protection.changed=j.protection.before.filter(x=>!fs.existsSync(x.file)||context.hash(x.file)!==x.sha256);j.protection.ok=j.protection.changed.length===0;save(auth.journalFile,j);fs.closeSync(lockFd);fs.unlinkSync(lock);
  }
  context.verifyJournal(auth);
  console.log(JSON.stringify({ok:true,runId:auth.runId,journalFile:auth.journalFile,next:'Root Monitor CleanupMaintenance read-only acceptance'},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
