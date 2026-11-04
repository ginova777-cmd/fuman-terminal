"use strict";
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RUNTIME = 'C:\\fuman-runtime';
const SOURCE_ROOT = 'C:\\fuman-release-owner\\fuman-terminal';
const ROOT = 'C:\\fuman-release-owner\\prod81';
const steps = ['retired','history','intraday','runtime','priority','observability','extended','cost','janitor'];
const scopedPolicy=require('../data/contracts/cleanup_single_start_v1.json');
const requiredSteps=auth=>auth.scope===scopedPolicy.scope?steps.filter(s=>s!=='intraday'):steps;
const date = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function authorization(file, {readOnly=false}={}) {
  const value = JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  const scheduled=value.contract==='cleanup-scheduled-context-v1' && value.scope===scopedPolicy.scope && value.authorizedBy==='release-policy';
  if ((!scheduled && value.contract !== 'cleanup-maintenance-authorization-v1') || !['five-stage-cleanup',scopedPolicy.scope].includes(value.scope) || (!scheduled && value.authorizedBy !== 'user') || value.date !== date() || !value.authorizationText || !/^[a-z0-9-]{8,90}$/.test(value.runId) || value.keepDays !== 15 || value.preserveWorkdaySchedule !== true || value.sourceRoot !== SOURCE_ROOT || value.executionRoot !== ROOT || value.runtimeRoot !== RUNTIME || !(Date.parse(value.issuedAt) <= Date.now() && (readOnly || Date.now() < Date.parse(value.expiresAt))) || date() !== new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value.issuedAt))) throw Error('cleanup_maintenance_authorization_invalid_or_expired');
  return {...value, executionMode:scheduled?'scheduled_workday':'authorized_maintenance', file:path.resolve(file), sha256:hash(file), journalFile:path.join(RUNTIME,'status',`cleanup-maintenance-${value.runId}.json`)};
}
function receipts() {
  const d=date().replaceAll('-',''), s=path.join(RUNTIME,'status');
  return {retired:[path.join(s,'api-only-retired-cleanup-status.json')],history:[path.join(s,'supabase-vercel-history-cleanup-status.json')],intraday:[path.join(s,`daytrade-intraday-retention-${d}.json`)],runtime:[path.join(s,`runtime-retention-${d}.json`),path.join(s,`cleanup-local-assets-${d}.json`)],priority:[path.join(s,`daytrade-stale-priority-cache-cleanup-${d}.json`)],observability:[path.join(s,`source-observability-retention-${d}.json`)],extended:[path.join(s,`cleanup-extended-${d}.json`),path.join(s,`duplicate-index-cleanup-${d}.json`)],cost:[path.join(RUNTIME,'state','vercel-cost-health-status.json')],janitor:[path.join(s,'global-cost-janitor-scorecard.json')]};
}
function assertRetiredReference(payload,auth) {
  if(payload.maintenanceRunId!==auth.runId || payload.maintenanceAuthorizationSha256!==auth.sha256 || Date.parse(payload.retentionReferenceTime)!==Date.parse(auth.issuedAt)) throw Error('cleanup_retention_reference_mismatch');
}
function verifyJournal(auth) {
  const j=JSON.parse(fs.readFileSync(auth.journalFile,'utf8'));
  if(!Number.isFinite(Date.parse(j.startedAt))||!Number.isFinite(Date.parse(j.finishedAt))||Date.parse(j.finishedAt)<Date.parse(j.startedAt))throw Error('cleanup_execution_time_invalid');
  if(j.contract!=='cleanup-maintenance-execution-v1'||j.runId!==auth.runId||j.authorizationSha256!==auth.sha256||!j.finishedAt||Date.parse(j.startedAt)<Date.parse(auth.issuedAt)||Date.parse(j.finishedAt)>Date.now()||j.protection?.ok!==true) throw Error('cleanup_maintenance_execution_invalid');
  if(j.localRetention){const c=j.capacity;if(!c||JSON.stringify(c)!==JSON.stringify(require('./cleanup-local-capacity').assess(c.before,c.after,require('../data/contracts/cleanup_local_assets_v1.json').capacity.minimumFreeBytes))||c.belowWatermark)throw Error('cleanup_capacity_readback_failed');}
  const expectedSteps=requiredSteps(auth);
  if(auth.scope===scopedPolicy.scope && (j.completionScope!==scopedPolicy.scope||JSON.stringify(j.deferredItems)!==JSON.stringify(scopedPolicy.deferredItems)))throw Error('cleanup_scope_drift');
  if(auth.scope===scopedPolicy.scope){
    if(j.executionMode!==auth.executionMode)throw Error('cleanup_execution_mode_drift');
    const outer=Date.parse(j.outerStartedAt),deadline=Date.parse(j.deadlineAt);
    if(!Number.isFinite(outer)||!Number.isFinite(deadline)||outer>Date.parse(j.startedAt)||deadline>outer+17*60*1000||Date.parse(j.finishedAt)>outer+18*60*1000)throw Error('cleanup_execution_budget_invalid');
  }
  if(j.firstFailure || j.steps.length!==expectedSteps.length || j.steps.some((r,i)=>r.name!==expectedSteps[i]))throw Error('cleanup_maintenance_step_set_invalid');
  for(const step of expectedSteps) {
    const row=j.steps.find(x=>x.name===step);
    if(!row||row.exitCode!==0||!row.finishedAt||row.receipts.length!==receipts()[step].length) throw Error(`cleanup_maintenance_step_failed:${step}`);
    if(auth.scope===scopedPolicy.scope){
      if(row.treeStopped!==true||row.timedOut!==false||row.processEvidence!==path.join(RUNTIME,'logs',auth.runId,step+'.log.process.json')||!row.processEvidenceSha256||hash(row.processEvidence)!==row.processEvidenceSha256)throw Error('cleanup_process_evidence_invalid:'+step);
      const stop=JSON.parse(fs.readFileSync(row.processEvidence,'utf8').replace(/^\uFEFF/,''));
      if(stop.treeStopped!==true||stop.timedOut!==false||stop.activeProcesses!==0||stop.exitCode!==0)throw Error('cleanup_process_not_complete:'+step);
    }
    for(const [index,sourceFile] of receipts()[step].entries()) {
      const evidence=row.receipts.find(x=>x.sourceFile===sourceFile||x.file===sourceFile);
      const file=evidence?.file;
      if(!file)throw Error('cleanup_stage_receipt_missing');
      if(auth.scope===scopedPolicy.scope&&evidence.sourceFile!==sourceFile)throw Error('cleanup_stage_archive_required');
      if(evidence.sourceFile&&file!==path.join(RUNTIME,'status/cleanup-stage-receipts',auth.runId,step,index+'.json'))throw Error('cleanup_stage_archive_path');
      const payload=JSON.parse(fs.readFileSync(file,'utf8'));
      if(step==='retired'||step==='history')assertRetiredReference(payload,auth);
      const checked=Date.parse(payload.checkedAt||payload.finishedAt);
      if(!Number.isFinite(checked)||!Number.isFinite(Date.parse(row.startedAt))||!Number.isFinite(Date.parse(row.finishedAt))||Date.parse(row.finishedAt)<Date.parse(row.startedAt)||!evidence||hash(file)!==evidence.sha256||payload.ok!==true||checked<Date.parse(row.startedAt)||checked>Date.parse(row.finishedAt)||(!['cost','janitor'].includes(step)&&!(payload.applied===true||payload.dryRun===false))) throw Error(`cleanup_maintenance_receipt_invalid:${step}`);
    }
  }
  return j;
}
function verifyScopedItems(j){
 const expected=scopedPolicy.requiredItems;
 const items=j.items||[];
 if(items.length!==expected.length||new Set(items.map(i=>i.id)).size!==expected.length||items.some(i=>!expected.includes(i.id)))throw Error('cleanup_item_set_incomplete');
 for(const i of items){
  if(i.runId!==j.runId||i.status!=='complete'||i.inventoryComplete!==true||i.readbackVerified!==true||i.protectedReadbackVerified!==true||!Number.isSafeInteger(i.deleted)||i.deleted<0||i.remaining!==0||!Array.isArray(i.protectedSet)||!Array.isArray(i.evidence)||!i.evidence.length)throw Error('cleanup_item_evidence_incomplete:'+i.id);
  for(const e of i.evidence)if(!e.file||!e.sha256||hash(e.file)!==e.sha256)throw Error('cleanup_item_evidence_changed:'+i.id);
  if(['C09','C10','C11','C12','C13','C14','C20','C21','C22','C23'].includes(i.id)&&!i.evidence.every(e=>{const p=JSON.parse(fs.readFileSync(e.file,'utf8'));return Array.isArray(p.recoveryArchives)&&p.recoveryArchives.length>0;}))throw Error('cleanup_recovery_archive_missing:'+i.id);
  require('./cleanup-item-observation').verify(i);
 }
 return items;
}
module.exports={verifyScopedItems,scopedPolicy,requiredSteps,RUNTIME,ROOT,SOURCE_ROOT,date,hash,authorization,receipts,steps,verifyJournal,assertRetiredReference};
