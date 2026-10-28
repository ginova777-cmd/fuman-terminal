"use strict";
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const norm = x => String(x || '').replace(/\\/g, '/').toLowerCase();
const dateKey = x => String(x || '').replace(/\D/g, '').slice(0, 8);
const taipei = x => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x));
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const canonical = p => { try { return norm(fs.realpathSync(p)); } catch { return norm(p); } };
const completeMode = cmd => { const modes=[...String(cmd||'').matchAll(/(?:^|\s)-Mode\s+["']?([a-z]+)/ig)]; return modes.length===1 && modes[0][1].toLowerCase()==='complete'; };
const fileArgument = x => { const m = String(x || '').match(/(?:^|\s)-File\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i); return canonical(m && (m[1] || m[2] || m[3])); };

// Only a time-trigger event joined to this runner process can attest natural origin.
// A mode string, task last-result, clock time, or a previous receipt is insufficient.
function assess(input) {
  const {strategy, scan, formalComplete, recovery, observation:o, release, originOnly=false} = input;
  const result = {recoveryReplay:recovery === true,naturalSlotComplete:false,naturalEvidenceStatus:'TRIGGER_IDENTITY_UNVERIFIED'};
  if (recovery) return {...result,naturalEvidenceStatus:'RECOVERY_NOT_NATURAL'};
  if ((!formalComplete && !originOnly) || (originOnly && strategy!=='cleanup')) return {...result,naturalEvidenceStatus:'FORMAL_COMPLETION_FAILED'};
  if (!o?.ok || !release?.ok || !scan?.runId || !['strategy4','strategy5','institution','cleanup'].includes(strategy)) return result;
  const start = Date.parse(o.runnerStartedAt), scanStart = Date.parse(scan.startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(scanStart) || scanStart < start || scanStart > start + 6*60*60*1000) return result;
  const tradeDate = dateKey(scan.tradeDate || scan.marketDate);
  if (tradeDate !== dateKey(taipei(start)) || !scan.runId.startsWith(`${strategy}-${tradeDate}-`)) return result;
  if (!Number.isInteger(o.runnerPid) || o.runnerPid <= 0 || o.parentPid !== o.runnerPid) return result;
  const task = strategy === 'cleanup' ? '\\Fuman API-Only Retired Artifact Cleanup 1535' : strategy === 'institution' ? '\\Fuman Buy Sell Complete 2110' : strategy === 'strategy4' ? '\\Fuman Strategy4 Cache 1600' : '\\Fuman Strategy5 Cache 2100';
  const script = canonical(release.scriptPath);
  if(['institution','cleanup'].includes(strategy) && (!o.runnerOwnerSid || o.runnerOwnerSid!==o.taskPrincipalSid || !o.executablePath || norm(o.executablePath)!==norm(o.actions?.[0]?.Execute).replace(/"/g,''))) return result;
  if (o.taskName !== task || !script || fileArgument(o.commandLine) !== script || /(?:^|\s)-(?:Recovery|RecoveryReplay|ReplayTradeDate|ResumeReplay|ResumePublishedRunId)\b/i.test(o.commandLine) || /-Mode\s+["']?Recovery/i.test(o.commandLine)) return result;
  let eventStart=start, eventPid=o.runnerPid, actionScript=script;
  if (strategy==='institution') {
    const p=o.scheduler;
    const parentStart=Date.parse(p?.startedAt);
    if (!p || !Number.isInteger(p.pid) || p.pid<=0 || p.pid===o.runnerPid || p.childParentPid!==p.pid ||
        !Number.isFinite(parentStart) || dateKey(taipei(parentStart))!==tradeDate || parentStart>start || start-parentStart>6*60*60*1000 ||
        p.ownerSid!==o.runnerOwnerSid || canonical(p.executablePath)!==canonical(o.executablePath) ||
        !release.schedulerScriptPath || !/^[a-f0-9]{64}$/.test(release.schedulerScriptSha256 || '') ||
        fileArgument(p.commandLine)!==canonical(release.schedulerScriptPath) ||
        !completeMode(p.commandLine) ||
        /(?:^|\s)-(?:Recovery\w*|Replay\w*|Resume\w*|ExpectedRunId)\b/i.test(p.commandLine) ||
        /(?:^|\s)-(?:Recovery\w*|Replay\w*|Resume\w*)\b/i.test(o.commandLine)) return result;
    eventStart=parentStart;eventPid=p.pid;actionScript=canonical(release.schedulerScriptPath);
  }
  if (o.actions?.length !== 1 || fileArgument(o.actions[0].Arguments) !== actionScript) return result;
  if (strategy==='institution' && !completeMode(o.actions[0].Arguments)) return result;
  const events = (o.events || []).filter(e => e.fields?.TaskName === task && Number.isInteger(e.recordId) && Math.abs(Date.parse(e.time)-eventStart) <= 20000);
  const natural = events.filter(e => e.id === 107 && e.fields.InstanceId);
  if (natural.length !== 1) return result;
  const instance = natural[0].fields.InstanceId;
  if (events.some(e => e.id === 110 && e.fields.InstanceId === instance)) return result;
  const actions = events.filter(e => e.id === 200 && e.fields.TaskInstanceId === instance);
  if (actions.length !== 1) return result;
  const action = actions[0];
  const pidBound = Number(action.fields.EnginePID) === eventPid || events.some(e => e.id === 129 && Number(e.fields.ProcessID) === eventPid && norm(e.activityId) === norm(instance));
  if (!pidBound || norm(action.fields.ActionName).replace(/"/g,'') !== norm(o.actions[0].Execute).replace(/"/g,'')) return result;
  const clock = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(natural[0].time));
  const minutes = Number(clock.slice(0,2))*60 + Number(clock.slice(3));
  const slot = strategy === 'cleanup' ? 17*60+10 : strategy === 'strategy4' ? 16*60 : strategy === 'institution' ? 21*60+10 : 21*60;
  if (minutes < slot || minutes > slot+2) return result;
  return {...result,naturalSlotComplete:!originOnly,naturalTriggerVerified:true,naturalEvidenceStatus:'NATURAL_TRIGGER_VERIFIED',naturalTaskInstanceId:instance};
}

function collect({strategy,scan,formalComplete,recovery,root,runtime,originOnly=false}) {
  const basic = assess({strategy,scan,formalComplete,recovery,originOnly});
  if (recovery || (!formalComplete && !originOnly)) return basic;
  try {
    const runnerPid = Number(process.env.FUMAN_STRATEGY_RUNNER_PID);
    if (!Number.isInteger(runnerPid) || runnerPid <= 0) return basic;
    const runnerFile = strategy === 'cleanup' ? 'run-api-only-retired-cleanup.ps1' : strategy === 'institution' ? 'run-institution.ps1' : strategy === 'strategy4' ? 'run-strategy4.ps1' : 'run-strategy5-complete.ps1';
    const scriptPath = path.join(root,runnerFile);
    const contract = JSON.parse(fs.readFileSync('C:/fuman-release-owner/fuman-terminal/data/contracts/release_root_authority_v1.json','utf8'));
    const git = args => {
      const r = spawnSync('git',['-c',`safe.directory=${root}`,'-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:15000});
      if (r.status !== 0) throw Error('release_git_unreadable');
      return r.stdout.trim();
    };
    const sha = git(['rev-parse','HEAD']);
    const release = {ok:fs.realpathSync(root) === fs.realpathSync(contract.productionRoot) && sha === contract.approvedProductionSha && git(['status','--porcelain']) === '',sha,scriptPath,scriptSha256:hash(fs.readFileSync(scriptPath))};
    if (strategy==='institution') { release.schedulerScriptPath=path.join(root,'run-buy-sell-complete.ps1'); release.schedulerScriptSha256=hash(fs.readFileSync(release.schedulerScriptPath)); }
    if (!release.ok) return {...basic,naturalEvidenceStatus:'NATURAL_RELEASE_IDENTITY_UNVERIFIED'};
    const r = spawnSync('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-File',path.join(root,'scripts/collect-strategy-trigger.ps1'),'-Strategy',strategy,'-RunnerProcessId',String(runnerPid),'-VerifierProcessId',String(process.pid)],{encoding:'utf8',windowsHide:true,timeout:30000});
    if (r.status !== 0) return basic;
    const observation = JSON.parse(r.stdout.replace(/^\uFEFF/,''));
    const assessment = assess({strategy,scan,formalComplete,recovery,observation,release,originOnly});
    const evidence = {phase:originOnly?'trigger_only':'completion',contract:'strategy-natural-trigger-v1',strategy,runId:scan.runId,tradeDate:scan.tradeDate || scan.marketDate,checkedAt:new Date().toISOString(),release,observation,assessment};
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
