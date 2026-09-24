"use strict";
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const RETIRED_TASK = 'Fuman Terminal Full Unattended Final Audit';
const RETIRED_INSTALLER = 'scripts/install-terminal-full-unattended-final-audit-task.ps1';
function verify(root, tasks) {
  const issues=[];
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  const need=(ok,code)=>{if(!ok)issues.push(code);};
  need(!fs.existsSync(path.join(root,RETIRED_INSTALLER)),'retired_installer_restored');
  const registry=JSON.parse(read('scripts/fuman-schedule-registry.json'));
  need((registry.policy.retiredTasks||registry.policy.retiredTaskNames||[]).includes(RETIRED_TASK),'retired_task_not_denied');
  need(!(registry.policy.activeTasks||[]).includes(RETIRED_TASK),'retired_task_active_in_registry');
  need(!registry.tasks.some(t=>String(t.taskName||t.displayName||'').replace(/^\\/,'')===RETIRED_TASK),'retired_task_has_schedule_row');
  const registration=read('scripts/register-terminal-unattended-tasks.ps1');
  const active=registration.match(/\$TaskNames\s*=\s*@\(([\s\S]*?)\)/)?.[1]||'';
  const retired=registration.match(/\$LegacyConflictTaskNames\s*=\s*@\(([\s\S]*?)\)/)?.[1]||'';
  need(active.includes('Fuman Terminal Autonomous Root Monitor')&&!active.includes(RETIRED_TASK),'registration_not_single_root');
  need(retired.includes(RETIRED_TASK),'recovery_does_not_remove_retired_task');
  for(const file of ['package.json','scripts/register-terminal-unattended-tasks.ps1','scripts/sync-main-deploy-source.js'])need(!read(file).includes(path.basename(RETIRED_INSTALLER)),'retired_installer_reference:'+file);
  const master=read('run-terminal-master-control.ps1');
  need(master.includes('verify-verifier-retirement.js')&&master.includes('VERIFIER_AUTHORITY_DRIFT'),'root_guard_missing');
  need(master.includes('scripts\\verify-daily-retention-maintenance.js'),'root_cleanup_verifier_missing');
  const daily=read('scripts/verify-daily-retention-maintenance.js');
  need(daily.includes('verify-verifier-retirement.js')&&daily.includes('verifier_authority_drift'),'cleanup_guard_missing');
  need(daily.includes("'scripts/cleanup-extended-retention.js','--verify'"),'extended_independent_verifier_missing');
  need(read('scripts/verify-publish-gate.js').includes('verify-verifier-retirement.js'),'publish_guard_missing');
  if(tasks!==undefined){
    need(Array.isArray(tasks),'live_task_query_failed');
    if(Array.isArray(tasks)){
      const rootTasks=tasks.filter(t=>t.name==='Fuman Terminal Autonomous Root Monitor');
      need(rootTasks.length===1&&rootTasks[0].enabled===true,'canonical_root_missing_or_disabled');
      for(const task of tasks){
        const action=String(task.action||'');
        need(task.name!==RETIRED_TASK&&!/run-terminal-unattended-final-audit\.js|run-terminal-autonomous-root\.ps1|install-terminal-full-unattended-final-audit-task\.ps1/i.test(action),'retired_scheduled_entry:'+task.name);
        if(/run-terminal-master-control\.ps1/i.test(action)){
          need(task.name==='Fuman Terminal Autonomous Root Monitor','duplicate_master_task:'+task.name);
          need(action.includes('C:\\fuman-release-owner\\fuman-terminal\\run-terminal-master-control.ps1')&&/-RequireProtectedReadback\b/i.test(action),'canonical_root_action_drift');
        }
      }
      need(/run-terminal-master-control\.ps1/i.test(rootTasks[0]?.action||''),'canonical_root_runner_drift');
    }
  }
  return {ok:issues.length===0,contract:'verifier-retirement-v1',checkedAt:new Date().toISOString(),mode:tasks===undefined?'static':'live',retiredInstaller:RETIRED_INSTALLER,retiredTask:RETIRED_TASK,issues};
}
function liveTasks(){
  const script="$ErrorActionPreference='Stop'; $rows=@(Get-ScheduledTask | ForEach-Object { [pscustomobject]@{name=$_.TaskName;enabled=[bool]$_.Settings.Enabled;action=(($_.Actions | ForEach-Object { $_.Execute+' '+$_.Arguments }) -join ' | ')} }); ConvertTo-Json -InputObject $rows -Compress";
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
  if(r.status!==0)throw Error('live_task_query_failed');
  return JSON.parse(r.stdout.replace(/^\uFEFF/,''));
}
if(require.main===module){try{const result=verify(ROOT,process.argv.includes('--require-live')?liveTasks():undefined);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}catch(error){console.error(JSON.stringify({ok:false,contract:'verifier-retirement-v1',issues:[error.message]}));process.exitCode=1;}}
module.exports={verify,RETIRED_TASK,RETIRED_INSTALLER};
