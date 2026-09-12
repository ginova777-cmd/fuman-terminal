"use strict";
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RUNTIME = 'C:\\fuman-runtime';
const ROOT = 'C:\\fuman-release-owner\\fuman-terminal';
const steps = ['retired','history','intraday','runtime','priority','observability','cost','janitor'];
const date = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function authorization(file) {
  const value = JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  if (value.contract !== 'cleanup-maintenance-authorization-v1' || value.scope !== 'five-stage-cleanup' || value.authorizedBy !== 'user' || value.date !== date() || !value.authorizationText || !/^[a-z0-9-]{8,90}$/.test(value.runId) || value.keepDays !== 15 || value.preserveWorkdaySchedule !== true || value.sourceRoot !== ROOT || value.runtimeRoot !== RUNTIME || !(Date.parse(value.issuedAt) <= Date.now() && Date.now() < Date.parse(value.expiresAt)) || date() !== new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value.issuedAt))) throw Error('cleanup_maintenance_authorization_invalid_or_expired');
  return {...value, file:path.resolve(file), sha256:hash(file), journalFile:path.join(RUNTIME,'status',`cleanup-maintenance-${value.runId}.json`)};
}
function receipts() {
  const d=date().replaceAll('-',''), s=path.join(RUNTIME,'status');
  return {retired:[path.join(s,'api-only-retired-cleanup-status.json')],history:[path.join(s,'supabase-vercel-history-cleanup-status.json')],intraday:[path.join(s,`daytrade-intraday-retention-${d}.json`)],runtime:[path.join(s,`runtime-retention-${d}.json`)],priority:[path.join(s,`daytrade-stale-priority-cache-cleanup-${d}.json`)],observability:[path.join(s,`source-observability-retention-${d}.json`)],cost:[path.join(RUNTIME,'state','vercel-cost-health-status.json')],janitor:[path.join(s,'global-cost-janitor-scorecard.json')]};
}
function verifyJournal(auth) {
  const j=JSON.parse(fs.readFileSync(auth.journalFile,'utf8'));
  if(j.contract!=='cleanup-maintenance-execution-v1'||j.runId!==auth.runId||j.authorizationSha256!==auth.sha256||!j.finishedAt||Date.parse(j.startedAt)<Date.parse(auth.issuedAt)||Date.parse(j.finishedAt)>Date.now()||j.protection?.ok!==true) throw Error('cleanup_maintenance_execution_invalid');
  for(const step of steps) {
    const row=j.steps.find(x=>x.name===step);
    if(!row||row.exitCode!==0||!row.finishedAt||row.receipts.length!==receipts()[step].length) throw Error(`cleanup_maintenance_step_failed:${step}`);
    for(const file of receipts()[step]) {
      const evidence=row.receipts.find(x=>x.file===file), payload=JSON.parse(fs.readFileSync(file,'utf8'));
      const checked=Date.parse(payload.checkedAt||payload.finishedAt);
      if(!evidence||hash(file)!==evidence.sha256||payload.ok!==true||checked<Date.parse(row.startedAt)||checked>Date.parse(row.finishedAt)||(!['cost','janitor'].includes(step)&&!(payload.applied===true||payload.dryRun===false))) throw Error(`cleanup_maintenance_receipt_invalid:${step}`);
    }
  }
  return j;
}
module.exports={RUNTIME,ROOT,date,hash,authorization,receipts,steps,verifyJournal};
