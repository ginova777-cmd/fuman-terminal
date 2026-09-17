'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {verify}=require('../lib/telegram-detectors/verify-delivery-closure.cjs');
const {digest}=require('../lib/telegram-detectors/delivery-pipeline.cjs');
const {readSnapshot,upsertSnapshot}=require('../lib/supabase-snapshots');
const {anonKey}=require('../lib/server-supabase-key');
const root=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
async function main({publishReceipt=false}={}){
 const date=new Date(Date.now()+28800000).toISOString().slice(0,10),dir=path.join(root,'data/telegram-detectors',date),ledger=read(path.join(dir,'day-ledger.json')),failed=[];
 const db=(await readSnapshot('telegram_three_detectors_latest',{key:anonKey({root:path.resolve(__dirname,'..'),runtimeDir:root}),maxAttempts:1,timeoutMs:8000}))?.payload;
 const latest=ledger?.rounds?.at(-1),evidence=latest?read(latest.file):null;let surfaces=null;
 if(evidence?.sourceProof?.complete===true){try{surfaces=await require('./capture-telegram-three-surfaces').capture({runId:latest.run_id,tradeDate:date,eventCount:evidence.result.event_count,eventsHash:evidence.result.events_sha256,output:path.join(dir,'ui-'+latest.run_id)});}catch{failed.push('PRODUCTION_RENDERED_SURFACES_NOT_VERIFIED');}}
 let receipt;
 if(!evidence){receipt={contract:'telegram_three_detectors_final_receipt_v1',trade_date:date,status:'blocked',complete:false,exit_code:1,failed_checks:['NATURAL_RUN_RECEIPT_MISSING'],first_blocker:'NATURAL_RUN_RECEIPT_MISSING'};}
 else{
  const pinned=(await readSnapshot('telegram_three_detectors_'+latest.run_id,{key:anonKey({root:path.resolve(__dirname,'..'),runtimeDir:root}),maxAttempts:1,timeoutMs:8000}))?.payload;
  receipt=verify({record:evidence.result,sourceProof:evidence.sourceProof,db:pinned,surfaces,expectedDate:date,expectedRunId:latest.run_id});
  // Every recorded natural round belongs to this day; old receipts cannot satisfy it.
  for(const round of ledger.rounds){let valid=false;try{valid=crypto.createHash('sha256').update(fs.readFileSync(round.file)).digest('hex')===round.sha256;}catch{}
   if(!valid)failed.push('DAY_ROUND_HASH_MISMATCH:'+round.run_id);
  }
  receipt.observed_rounds=ledger.rounds.length;receipt.incomplete_rounds=ledger.rounds.filter(r=>!r.integration_complete||!r.source_complete).length;
  receipt.failed_checks.push(...failed);receipt.complete=receipt.failed_checks.length===0;receipt.status=receipt.complete?'complete':'blocked';receipt.exit_code=receipt.complete?0:1;receipt.first_blocker=receipt.failed_checks[0]||null;receipt.scope='formal_three_detectors_current_round';receipt.full_day_verified=false;
 }
 if(receipt.complete&&publishReceipt){const key='telegram_three_detectors_acceptance_'+receipt.run_id,published=await upsertSnapshot(key,receipt,{tradeDate:date,snapshotId:receipt.run_id});const confirmed=published.ok?(await readSnapshot(key,{maxAttempts:1,timeoutMs:8000}))?.payload:null;if(digest(confirmed)!==digest(receipt)){receipt.complete=false;receipt.status='blocked';receipt.exit_code=1;receipt.failed_checks.push('ACCEPTANCE_DB_READBACK_FAILED');receipt.first_blocker='ACCEPTANCE_DB_READBACK_FAILED';}}
 const target=path.join(root,'data/scan-receipts/telegram-three-detectors-final-'+date.replaceAll('-','')+'.json');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target+'.tmp',JSON.stringify(receipt,null,2));fs.renameSync(target+'.tmp',target);console.log(JSON.stringify(receipt,null,2));return receipt;
}
function verifyCodeContract(){
 const assert=require('assert/strict'),{spawnSync}=require('child_process'),repo=path.resolve(__dirname,'..');
 const text=f=>fs.readFileSync(path.join(repo,f),'utf8');
 const c=JSON.parse(text('data/contracts/telegram_three_independent_detectors_v1.json'));
 assert.equal(c.contract,'telegram_three_independent_detectors_v1');
 assert.equal(c.runner,'scripts/run-telegram-three-detectors.js');assert.equal(c.verifier,'scripts/verify-telegram-three-detectors.js');
 assert.equal(c.five_minute_role,'bonus_only');assert.equal(c.replay_publish_allowed,false);
 assert.deepEqual(c.formal_complete_requires,['natural_source_independent_check','database_anonymous_readback','per_target_telegram_message_acknowledgement','desktop_mobile_scorecard_rendered_same_batch']);
 assert.equal(c.current_round_complete_is_not_full_day_complete,true);
 const pkg=JSON.parse(text('package.json'));assert.equal(pkg.scripts['verify:daytrade-burst-telegram'],'node --use-system-ca scripts/verify-telegram-three-detectors.js');
 assert(text('run-daytrade-intraday-burst-telegram.ps1').includes('run-telegram-three-detectors.js'));
 assert(text('run-terminal-master-control.ps1').includes('verify-telegram-three-detectors.js'));
 for(const [file,target] of [['scripts/verify-daytrade-intraday-burst-telegram.js','verify-telegram-three-detectors'],['scripts/notify-daytrade-intraday-burst-telegram.js','run-telegram-three-detectors']]){
  const shim=text(file);assert(shim.length<600&&shim.includes("require('./"+target+"')"),'Legacy entry must only dispatch');
 }
 for(const file of ['index.html','mobile.html','88.html'])assert(text(file).includes('terminal-telegram-detectors.js'));
 const tests=['scripts/test-provider-side-journal.cjs',...['volume','price','outside','provider-minute-side','telegram-event-adapter','telegram-delivery','delivery-pipeline','natural-source-runner'].map(n=>'lib/telegram-detectors/test-'+n+'.cjs')];
 for(const file of tests){const r=spawnSync(process.execPath,[file],{cwd:repo,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(file+': '+(r.stderr||r.stdout));}
 const result={scope:'code_contract_only',ok:true,tests:tests.length,formal_acceptance_evaluated:false,receipt_written:false};console.log(JSON.stringify(result));return result;
}
if(require.main===module){if(process.argv.includes('--contract')){try{verifyCodeContract();}catch(e){console.error(e.message);process.exitCode=1;}}else main({publishReceipt:process.argv.includes('--publish-receipt')}).then(r=>{process.exitCode=r.exit_code;}).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={main};
