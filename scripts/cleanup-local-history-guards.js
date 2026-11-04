'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {expired}=require('./cleanup-local-calendar');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const key=p=>path.resolve(p).replaceAll('\\','/').toLowerCase();
const contains=(root,p)=>key(p).startsWith(key(root)+'/');
const categories=new Set(['engineering_test','engineering_backup','telegram_history','telegram_plan','mother_pool_history','closed_execution']);
function protectedPath(p){return /(?:^|[\\/])(?:credential[^\\/]*|secrets?|\.git|\.env|checkpoint[^\\/]*|signatures?|phase2|leases?|locks?|outbox|pending|notification-guard|warmup[^\\/]*|five-session[^\\/]*|20132)(?:[\\/]|$)|(?:checkpoint|signature|20132)|(?:^|[\\/])(?:latest|current|sent-notifications)(?:[.\\/]|$)/i.test(p);}
function readProof(file,sha){if(!file||!path.isAbsolute(file)||! /^[a-f0-9]{64}$/i.test(sha||''))throw Error('closure_proof_missing');const b=fs.readFileSync(file);if(digest(b)!==sha)throw Error('closure_proof_hash');return JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''));}
function validate(entry,e,ctx,members){
 if(!categories.has(entry.category))return;
 const rule=ctx.policy.categories[entry.category];
 if(!rule.allowedRoots?.some(r=>contains(r,entry.path)))throw Error('category_root_not_allowed');
 if([entry.path,...members].some(protectedPath))throw Error('protected_checkpoint_or_current_state');
 const proof=readProof(e.closureFile,e.closureSha256);
 if(contains(entry.path,e.closureFile)||key(entry.path)===key(e.closureFile))throw Error('closure_must_be_retained');
 if(proof.contract!=='cleanup-local-closure-v1'||proof.status!=='closed'||proof.complete!==true||proof.path!==entry.path||proof.treeSha256!==e.treeSha256||!proof.runId||!proof.owner||!expired(proof.closedAt,ctx.now))throw Error('closure_not_proven');
 if(e.referenceAuditComplete!==true||!Array.isArray(e.referenceSources)||!e.referenceSources.length||!Array.isArray(e.references)||e.references.length||!Array.isArray(e.holds)||e.holds.length||e.consumerSafetyVerified!==true)throw Error('consumer_reference_protection_unproven');
 const reviewed=Date.parse(e.referenceReviewedAt);if(!Number.isFinite(reviewed)||reviewed>ctx.now||ctx.now-reviewed>86400000)throw Error('reference_review_not_current');
 for(const source of e.referenceSources){const b=fs.readFileSync(source.path);if(digest(b)!==source.sha256)throw Error('reference_source_changed');}
 if(entry.category==='engineering_test'&&(!['isolated_runtime','simulated_database','duplicate_output','trace'].includes(e.artifactKind)||proof.testPassed!==true))throw Error('closed_test_pass_missing');
 if(entry.category==='mother_pool_history'&&(!e.sourceContract||!e.canonicalRunId||e.historyClassification!=='retired_history'||e.warmupReferenced!==false||e.strategyReferenced!==false))throw Error('mother_pool_history_unproven');
 if(['telegram_history','telegram_plan','mother_pool_history'].includes(entry.category)){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(e.tradeDate||'')||!expired(e.tradeDate+'T23:59:59.999+08:00',ctx.now))throw Error('payload_trade_date_not_expired');
  if(entry.category.startsWith('telegram_')){
   const relative=rule.allowedRoots.map(r=>path.relative(r,entry.path).replaceAll('\\','/')).find(r=>!r.startsWith('../')&&!path.isAbsolute(r));
   const pattern=entry.category==='telegram_history'?/^\d{4}-\d{2}-\d{2}\/telegram-natural-[^/]+\.json$/:/^\d{4}-\d{2}-\d{2}\/plan-evidence(?:\/[^/]+\.json)?$/;
   if(!relative||!pattern.test(relative)||relative.slice(0,10)!==e.tradeDate)throw Error('telegram_path_date_mismatch');
  }
  if(!members.length)throw Error('history_payload_empty');
  for(const file of members){const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));const payload=entry.category==='telegram_history'?(value.result||value):value;const date=payload.tradeDate||payload.trade_date||payload.date; if(entry.category==='telegram_history'&&value.result&&(!value.sourceProof||value.sourceProof.contract!=='three_detectors_natural_source_verifier_v1'||value.sourceProof.trade_date!==date||value.sourceProof.run_id!==payload.run_id||value.sourceProof.source_run_id!==payload.source_run_id))throw Error('telegram_source_proof_identity_mismatch');if(date!==e.tradeDate||!e.sourceContract||payload.contract!==e.sourceContract)throw Error('history_payload_identity_mismatch');}
 }
 if(entry.category==='closed_execution'&&(!e.terminatedAt||!expired(e.terminatedAt,ctx.now)||!e.ownerPid))throw Error('execution_termination_unproven');
}
module.exports={validate,protectedPath,categories};
