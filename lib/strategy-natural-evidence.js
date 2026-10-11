"use strict";
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const norm = x => String(x || '').replace(/\\/g, '/').toLowerCase();
const dateKey = x => String(x || '').replace(/\D/g, '').slice(0, 8);
const taipei = x => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x));
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const fileArgument = x => { const m = String(x || '').match(/(?:^|\s)-File\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i); return norm(m && (m[1] || m[2] || m[3])); };

// Only a time-trigger event joined to this runner process can attest natural origin.
// A mode string, task last-result, clock time, or a previous receipt is insufficient.
function assess(input) {
  const {strategy, scan, formalComplete, recovery, observation:o, release} = input;
  const result = {recoveryReplay:recovery === true,naturalSlotComplete:false,naturalEvidenceStatus:'TRIGGER_IDENTITY_UNVERIFIED'};
  if (recovery) return {...result,naturalEvidenceStatus:'RECOVERY_NOT_NATURAL'};
  if (!formalComplete) return {...result,naturalEvidenceStatus:'FORMAL_COMPLETION_FAILED'};
  if (!o?.ok || !release?.ok || !scan?.runId || !['strategy4','strategy5','institution'].includes(strategy)) return result;
  const start = Date.parse(o.runnerStartedAt), scanStart = Date.parse(scan.startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(scanStart) || scanStart < start || scanStart > start + 6*60*60*1000) return result;
  const tradeDate = dateKey(scan.tradeDate || scan.marketDate);
  if (tradeDate !== dateKey(taipei(start)) || !scan.runId.startsWith(`${strategy}-${tradeDate}-`)) return result;
  if (!Number.isInteger(o.runnerPid) || o.runnerPid <= 0 || o.parentPid !== o.runnerPid) return result;
  const task = strategy === 'institution' ? '\\Fuman 買賣超 Cache 2100' : strategy === 'strategy4' ? '\\Fuman Strategy4 Cache 1600' : '\\Fuman Strategy5 Cache 2100';
  const script = norm(release.scriptPath);
  if(strategy==='institution' && (!o.runnerOwnerSid || o.runnerOwnerSid!==o.taskPrincipalSid || !o.executablePath || norm(o.executablePath)!==norm(o.actions?.[0]?.Execute).replace(/"/g,''))) return result;
  if (o.taskName !== task || !script || fileArgument(o.commandLine) !== script || /(?:^|\s)-(?:Recovery|RecoveryReplay|ReplayTradeDate|ResumeReplay|ResumePublishedRunId)\b/i.test(o.commandLine) || /-Mode\s+["']?Recovery/i.test(o.commandLine)) return result;
  if (o.actions?.length !== 1 || fileArgument(o.actions[0].Arguments) !== script) return result;
  const events = (o.events || []).filter(e => e.fields?.TaskName === task && Number.isInteger(e.recordId) && Math.abs(Date.parse(e.time)-start) <= 20000);
  const natural = events.filter(e => e.id === 107 && e.fields.InstanceId);
  if (natural.length !== 1) return result;
  const instance = natural[0].fields.InstanceId;
  if (events.some(e => e.id === 110 && e.fields.InstanceId === instance)) return result;
  const actions = events.filter(e => e.id === 200 && e.fields.TaskInstanceId === instance);
  if (actions.length !== 1) return result;
  const action = actions[0];
  const pidBound = Number(action.fields.EnginePID) === o.runnerPid || events.some(e => e.id === 129 && Number(e.fields.ProcessID) === o.runnerPid && norm(e.activityId) === norm(instance));
  if (!pidBound || norm(action.fields.ActionName).replace(/"/g,'') !== norm(o.actions[0].Execute).replace(/"/g,'')) return result;
  const clock = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(natural[0].time));
  const minutes = Number(clock.slice(0,2))*60 + Number(clock.slice(3));
  const slot = strategy === 'strategy4' ? 16*60 : 21*60;
  if (minutes < slot || minutes > slot+2) return result;
  return {...result,naturalSlotComplete:true,naturalEvidenceStatus:'NATURAL_TRIGGER_VERIFIED',naturalTaskInstanceId:instance};
}

function collect({strategy,scan,formalComplete,recovery,root,runtime}) {
  const basic = assess({strategy,scan,formalComplete,recovery});
  if (recovery || !formalComplete) return basic;
  try {
    const runnerPid = Number(process.env.FUMAN_STRATEGY_RUNNER_PID);
    if (!Number.isInteger(runnerPid) || runnerPid <= 0) return basic;
    const runnerFile = strategy === 'institution' ? 'run-institution.ps1' : strategy === 'strategy4' ? 'run-strategy4.ps1' : 'run-strategy5-complete.ps1';
    const scriptPath = path.join(root,runnerFile);
    const contract = JSON.parse(fs.readFileSync('C:/fuman-release-owner/fuman-terminal/data/contracts/release_root_authority_v1.json','utf8'));
    const git = args => {
      const r = spawnSync('git',['-c',`safe.directory=${root}`,'-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:15000});
      if (r.status !== 0) throw Error('release_git_unreadable');
      return r.stdout.trim();
    };
    const sha = git(['rev-parse','HEAD']);
    const release = {ok:fs.realpathSync(root) === fs.realpathSync(contract.productionRoot) && sha === contract.approvedProductionSha && git(['status','--porcelain']) === '',sha,scriptPath,scriptSha256:hash(fs.readFileSync(scriptPath))};
    if (!release.ok) return {...basic,naturalEvidenceStatus:'NATURAL_RELEASE_IDENTITY_UNVERIFIED'};
    const r = spawnSync('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-File',path.join(root,'scripts/collect-strategy-trigger.ps1'),'-Strategy',strategy,'-RunnerProcessId',String(runnerPid),'-VerifierProcessId',String(process.pid)],{encoding:'utf8',windowsHide:true,timeout:30000});
    if (r.status !== 0) return basic;
    const observation = JSON.parse(r.stdout.replace(/^\uFEFF/,''));
    const assessment = assess({strategy,scan,formalComplete,recovery,observation,release});
    const evidence = {contract:'strategy-natural-trigger-v1',strategy,runId:scan.runId,tradeDate:scan.tradeDate || scan.marketDate,checkedAt:new Date().toISOString(),release,observation,assessment};
    const text = JSON.stringify(evidence,null,2)+'\n';
    const dir = path.join(runtime,'data/scan-receipts/natural-origin',strategy);
    fs.mkdirSync(dir,{recursive:true});
    const file = path.join(dir,`${crypto.randomUUID()}.json`);
    fs.writeFileSync(file,text,{flag:'wx'});
    return {...assessment,naturalEvidencePath:file,naturalEvidenceSha256:hash(text)};
  } catch {
    return basic;
  }
}
module.exports = {assess,collect};
