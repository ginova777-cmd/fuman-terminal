'use strict';
const assert=require('assert'),path=require('path').win32;
const {stripApprovedMirrorArgument:strip,legacyExecutorStatus:status}=require('../lib/schedule-legacy-compatibility.cjs');
const root='C:\\fuman-release-owner\\fuman-terminal',contract={productionRoot:'C:\\fuman-release-owner\\prod81'};
const row={name:'Fuman Vercel Cost Health Monitor 2115',execute:'powershell.exe',workingDirectory:root,arguments:`-NoProfile -ExecutionPolicy Bypass -File "${root}\\run-vercel-cost-health-monitor.ps1" -ProjectRoot "${root}" -ProductionMirrorRoot "C:\\fuman-terminal"`};
let count=0;function test(fn){fn();count++;}
test(()=>assert(!strip(row,root,x=>x).includes('-ProductionMirrorRoot')));
for(const patch of [{name:'other'},{execute:'C:\\evil\\powershell.exe'},{workingDirectory:'C:\\evil'},{arguments:row.arguments+' -Extra x'},{arguments:row.arguments.replace('C:\\fuman-terminal','C:\\fuman-terminal\\evil')},{arguments:row.arguments.replace('run-vercel','evil-vercel')}])test(()=>assert(strip({...row,...patch},root,x=>x).includes('-ProductionMirrorRoot')));
test(()=>assert(strip(row,root,x=>x.endsWith('.ps1')?'C:\\evil.ps1':x).includes('-ProductionMirrorRoot')));
test(()=>assert(strip(row,root,()=>{throw Error('missing')}).includes('-ProductionMirrorRoot')));
test(()=>assert.equal(status(row,contract),'EXECUTOR_RESOLUTION_UNVERIFIED'));
test(()=>assert.equal(status({name:'Fuman Market Calendar Auto Update 1900-0830',execute:'pwsh.exe'},contract),'EXECUTOR_RESOLUTION_UNVERIFIED'));
const s3={name:'Fuman Strategy3 V2 Daily Closure Verify 1310',execute:'C:\\Program Files\\PowerShell\\7\\pwsh.exe',arguments:`-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "& node --use-system-ca '${path.join(contract.productionRoot,'scripts','verify-strategy3-v2-daily-unattended-closure.js')}'"`};
test(()=>assert.equal(status(s3,contract),'INNER_NODE_RESOLUTION_UNVERIFIED'));
for(const patch of [{name:'other'},{execute:'C:\\evil\\pwsh.exe'},{arguments:s3.arguments+'; evil'},{arguments:s3.arguments.replace('& node','& evil')},{arguments:s3.arguments.replace('prod81','evil')}])test(()=>assert.equal(status({...s3,...patch},contract),null));
console.log(JSON.stringify({ok:true,tests:count,scope:'isolated_no_execution_no_path_authorization'}));
