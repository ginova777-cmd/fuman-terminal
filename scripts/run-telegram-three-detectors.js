'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const gate=require('../lib/telegram-detectors/level-cross-gate.cjs');
const levels=require('../lib/telegram-detectors/level-source.cjs');
const {produce}=require('../lib/telegram-detectors/natural-source-runner.cjs');
const {run,digest}=require('../lib/telegram-detectors/delivery-pipeline.cjs');
const {upsertSnapshot,readSnapshot}=require('../lib/supabase-snapshots');
const {anonKey}=require('../lib/server-supabase-key');
const {telegramTargets}=require('./telegram-push');
const {guardedSend}=require('./notification-guard');
const {createSender}=require('../lib/telegram-detectors/telegram-delivery.cjs');
const root=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
const read=(p,fallback=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return fallback;}};
const write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});const tmp=p+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(v,null,2));fs.renameSync(tmp,p);};
async function execute(){
 let now=new Date().toISOString();const local=new Date(Date.now()+28800000).toISOString(),date=local.slice(0,10),minute=local.slice(11,16),dir=path.join(root,'data/telegram-detectors',date);
 if(minute==='12:31'&&fs.existsSync(path.join(dir,'day-ledger.json')))return require('./verify-telegram-three-detectors').main({publishReceipt:true});
 if(minute<'09:00'||minute>'12:30'){
  const result={contract:'telegram_three_detectors_attempt_v1',trade_date:date,checked_at:now,status:'not_due',complete:false,reason:'OUTSIDE_NOTIFICATION_WINDOW',previous_evidence_preserved:true};write(path.join(dir,'last-attempt.json'),result);return result;
 }
 const {buildMarketCalendarContract}=require('../lib/market-calendar-contract');
 const calendar=await buildMarketCalendarContract({now:new Date()});
 if(calendar.marketOpen!==true){const r={contract:'telegram_three_detectors_attempt_v1',trade_date:date,checked_at:now,status:'not_due',complete:false,reason:'MARKET_CLOSED',previous_evidence_preserved:true};write(path.join(dir,'last-attempt.json'),r);return r;}
 fs.mkdirSync(dir,{recursive:true});const lock=path.join(dir,'runner.lock');let lockFd;
 try{lockFd=fs.openSync(lock,'wx');}catch(e){if(e.code!=='EEXIST')throw e;const previousLock=read(lock);let alive=true;if(Number.isInteger(previousLock?.pid)){try{process.kill(previousLock.pid,0);}catch(err){if(err.code==='ESRCH')alive=false;}}if(alive)throw Error('RUNNER_ALREADY_ACTIVE_OR_LOCK_UNVERIFIABLE');fs.renameSync(lock,lock+'.stale-'+Date.now());lockFd=fs.openSync(lock,'wx');}
 fs.writeSync(lockFd,JSON.stringify({pid:process.pid,started_at:now}));
 try{
  const stateFile=path.join(dir,'source-latest.json');
  let previous={};if(fs.existsSync(stateFile)){try{previous=JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{throw Error('GATE_STATE_UNREADABLE');}}
  const input=produce({runtimeRoot:root,now});
  const previousDate=await levels.previousTradingDate({tradeDate:date,runtimeRoot:root});
  const saved=previous.gateState||{entries:[],finished:[]};
  if(!Array.isArray(saved.entries)||!Array.isArray(saved.finished))throw Error('GATE_STATE_INVALID');
  if(previous.gateState&&digest(saved)!==previous.gateStateHash)throw Error('GATE_STATE_HASH_MISMATCH');
  const symbols=[...input.events.map(e=>e.stock_id),...saved.entries.map(x=>x.event.stock_id)];
  const contexts=await levels.hydrate({runtimeRoot:root,tradeDate:date,previousDate,groups:input.groups,quotes:input.quotes,symbols,now});
  now=new Date().toISOString();
  const finished=new Set(saved.finished),rawEvents=input.events;
  const plan=read(path.join(root,'data/telegram-detectors',date,'premarket-plan.json'));
  const planProof=require('../lib/telegram-detectors/premarket-plan-contract.cjs').validate(plan,{tradeDate:date,now});
  input.proof.premarket_plan_verification=planProof;
  input.proof.premarket_plan_sha256=plan?digest(plan):null;
  input.proof.failed_checks.push(...planProof.failed_checks);
  input.proof.complete=input.proof.complete&&planProof.complete;
  const filtered=gate.build({events:rawEvents.filter(e=>!finished.has(gate.key(e))),previous:saved.entries,contexts,now,tradeDate:date,plan});
  input.events=filtered.events;
  const gateFailures=gate.verify(input.events,filtered.evidence);
  for(const e of filtered.evidence)for(const gap of e.levelInput.gaps||[])input.batch.data_gaps.push({symbol:e.event.stock_id,module:'level_source',reason:gap});
  input.proof.raw_events_sha256=input.proof.events_sha256;
  input.proof.events_sha256=digest(input.events);input.proof.gate_evidence=filtered.evidence;
  input.proof.failed_checks.push(...gateFailures);input.proof.complete=input.proof.complete&&!gateFailures.length;
  input.batch.notification_gate=gate.CONTRACT;
  const publicKey=anonKey({root:path.resolve(__dirname,'..'),runtimeDir:root});if(!publicKey)throw Error('ANON_READBACK_KEY_MISSING');
  const storage={store:async(key,p)=>{const r=await upsertSnapshot(key,p,{tradeDate:date,snapshotId:p.run_id,source:'telegram_three_independent_detectors_v1',timeoutMs:8000});if(!r.ok)throw Error('DB_WRITE_FAILED');},readback:async key=>(await readSnapshot(key,{key:publicKey,maxAttempts:1,timeoutMs:8000}))?.payload};
  const targetCount=new Set(telegramTargets()).size;
  const sender=createSender({targets:telegramTargets(),token:process.env.TELEGRAM_BOT_TOKEN,runtimeRoot:root,guardedSend});
  const result=await run({batch:input.batch,events:input.events,now,verifySource:async()=>input.proof,...storage,targetCount,send:async intent=>{
   const old=process.env.FUMAN_ALLOW_DAYTRADE_BURST_TELEGRAM;process.env.FUMAN_ALLOW_DAYTRADE_BURST_TELEGRAM='true';
   try{return await sender(intent);}
   finally{if(old===undefined)delete process.env.FUMAN_ALLOW_DAYTRADE_BURST_TELEGRAM;else process.env.FUMAN_ALLOW_DAYTRADE_BURST_TELEGRAM=old;}
  }});
  // Preserve failed attempts as evidence; a blocked source never becomes complete.
  const file=path.join(dir,input.batch.run_id+'.json');write(file,{result,sourceProof:input.proof});const delivered=new Set(result.deliveries.filter(d=>['delivered','suppressed','resolved'].includes(d.status)).map(d=>d.event_id));
  for(const e of input.events)if(delivered.has(gate.key(e))||['expired','source_missing'].includes(e.gate?.status))finished.add(gate.key(e));
  const gateState={entries:filtered.state.filter(x=>!finished.has(gate.key(x.event))),finished:[...finished]};
  write(path.join(dir,'source-latest.json'),{gateState,gateStateHash:digest(gateState),run_id:input.batch.run_id});
  const ledger=read(path.join(dir,'day-ledger.json'),{contract:'telegram_three_detectors_day_ledger_v1',trade_date:date,rounds:[]});
  ledger.rounds.push({run_id:result.run_id,file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),checked_at:now,minute,integration_complete:result.integration_complete,source_complete:input.proof.complete,event_count:result.event_count});write(path.join(dir,'day-ledger.json'),ledger);
  if(result.integration_complete===true){await storage.store('telegram_three_detectors_latest',result);const found=await storage.readback('telegram_three_detectors_latest');if(digest(found)!==digest(result))throw Error('LATEST_READBACK_MISMATCH');}
  write(path.join(root,'data/scan-receipts/telegram-three-detectors-runner-'+date.replaceAll('-','')+'.json'),result);
  return result;
 }finally{fs.closeSync(lockFd);fs.unlinkSync(lock);}
}
async function main(){try{return await execute();}catch(e){const date=new Date(Date.now()+28800000).toISOString().slice(0,10),result={contract:'telegram_three_detectors_attempt_v1',run_id:'telegram-failed-'+crypto.randomUUID(),trade_date:date,checked_at:new Date().toISOString(),status:'blocked',complete:false,exit_code:1,failed_checks:[e.message||'RUNNER_EXCEPTION'],first_blocker:e.message||'RUNNER_EXCEPTION',previous_good_preserved:true};write(path.join(root,'data/telegram-detectors',date,'last-attempt.json'),result);write(path.join(root,'data/scan-receipts/telegram-three-detectors-runner-'+date.replaceAll('-','')+'.json'),result);return result;}}
if(require.main===module){
 if(process.argv.includes('--premarket-plan')){try{const r=require('./produce-telegram-premarket-plan.cjs').main();process.exitCode=r.receipt.complete?0:2;}catch(e){console.error(e.message);process.exitCode=1;}}
 else if(process.argv.includes('--premarket-validation')){try{require('./run-premarket-validation.cjs').main();}catch(e){console.error(e.message);process.exitCode=1;}}
 else main().then(r=>{console.log(JSON.stringify({status:r.status,complete:r.complete,run_id:r.run_id,event_count:r.event_count,first_blocker:r.first_blocker||r.reason},null,2));process.exitCode=r.exit_code??(r.status==='not_due'||r.integration_complete===true?0:1);}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={main};
