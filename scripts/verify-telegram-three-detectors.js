'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {verify}=require('../lib/telegram-detectors/verify-delivery-closure.cjs');
const {digest}=require('../lib/telegram-detectors/delivery-pipeline.cjs');
const {readSnapshot,upsertSnapshot}=require('../lib/supabase-snapshots');
const {anonKey}=require('../lib/server-supabase-key');
const root=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
async function main(){
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
 if(receipt.complete){const key='telegram_three_detectors_acceptance_'+receipt.run_id,published=await upsertSnapshot(key,receipt,{tradeDate:date,snapshotId:receipt.run_id});const confirmed=published.ok?(await readSnapshot(key,{maxAttempts:1,timeoutMs:8000}))?.payload:null;if(digest(confirmed)!==digest(receipt)){receipt.complete=false;receipt.status='blocked';receipt.exit_code=1;receipt.failed_checks.push('ACCEPTANCE_DB_READBACK_FAILED');receipt.first_blocker='ACCEPTANCE_DB_READBACK_FAILED';}}
 const target=path.join(root,'data/scan-receipts/telegram-three-detectors-final-'+date.replaceAll('-','')+'.json');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target+'.tmp',JSON.stringify(receipt,null,2));fs.renameSync(target+'.tmp',target);console.log(JSON.stringify(receipt,null,2));return receipt;
}
if(require.main===module)main().then(r=>{process.exitCode=r.exit_code;}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
