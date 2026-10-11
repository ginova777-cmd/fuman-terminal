'use strict';
const path=require('path').win32;
// Classify known installer shapes without treating unresolved PATH as authorized.
function legacyExecutorStatus(task,contract){
 const exe=String(task.execute||'').toLowerCase();
 const args=String(task.arguments||'');
 if(task.name==='Fuman Market Calendar Auto Update 1900-0830'&&exe==='pwsh.exe')return 'EXECUTOR_RESOLUTION_UNVERIFIED';
 if(task.name==='Fuman Vercel Cost Health Monitor 2115'&&exe==='powershell.exe')return 'EXECUTOR_RESOLUTION_UNVERIFIED';
 const target=path.join(contract.productionRoot,'scripts','verify-strategy3-v2-daily-unattended-closure.js');
 const expected=`-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "& node --use-system-ca '${target}'"`;
 if(task.name==='Fuman Strategy3 V2 Daily Closure Verify 1310'&&exe==='c:\\program files\\powershell\\7\\pwsh.exe'&&args===expected)return 'INNER_NODE_RESOLUTION_UNVERIFIED';
 return null;
}
function stripApprovedMirrorArgument(task,sourceRoot,resolve=require('fs').realpathSync){
 const original=`${task.execute||''} ${task.arguments||''} ${task.workingDirectory||''}`;
 if(task.name!=='Fuman Vercel Cost Health Monitor 2115')return original;
 const root=path.normalize(sourceRoot);
 const script=path.join(root,'run-vercel-cost-health-monitor.ps1');
 const expected=`-NoProfile -ExecutionPolicy Bypass -File "${script}" -ProjectRoot "${root}" -ProductionMirrorRoot "C:\\fuman-terminal"`;
 const exe=String(task.execute||'').toLowerCase();
 if(!['powershell.exe','c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe'].includes(exe)||task.arguments!==expected||String(task.workingDirectory||'').toLowerCase()!==root.toLowerCase())return original;
 try{if(path.normalize(resolve(script)).toLowerCase()!==path.join(path.normalize(resolve(root)),'run-vercel-cost-health-monitor.ps1').toLowerCase())return original;}catch{return original;}
 // This only excludes the documented data parameter from the legacy-path scan.
 // It does not attest to executable resolution or authorize execution.
 return `${task.execute} ${expected.replace(' -ProductionMirrorRoot "C:\\fuman-terminal"','')} ${task.workingDirectory}`;
}
module.exports={legacyExecutorStatus,stripApprovedMirrorArgument};
