const assert=require('assert'),path=require('path'),{rootPolicy}=require('../lib/schedule-query-evidence.cjs');
const c={sourceRoot:'C:/source',productionRoot:'C:/prod81',runtimeRoot:'C:/runtime',approvedProductionSha:'x'},g={ok:true,productionClean:true,productionHead:'x'};
const p=rootPolicy(c,g,x=>path.win32.normalize(x));
const cases=[
 ['-File "C:/prod81/run.ps1"',true],
 ['-NoProfile -WindowStyle Hidden -File "C:/prod81/run.ps1"',true],
 ['-File C:/evil/run.ps1 -EvidenceRoot C:/prod81/evidence',false],
 ['-File C:/prod81/../evil/run.ps1',false],
 ['-File C:/prod81-evil/run.ps1',false],
 ['-Command "C:/prod81/run.ps1"',false],
 ['-EncodedCommand C:/prod81/run.ps1',false],
 ['-File "C:/prod81/run.ps1',false],
 ['-File C:/prod81/run.ps1 -File C:/evil/run.ps1',false],
 ['-File relative.ps1 -Root C:/prod81/evidence',false],
 ['-File "C:\\PROD81\\folder\\run.ps1"',true]
];
for(const [arguments,expected] of cases)assert.equal(p.actionUsesRoot({execute:'C:/Program Files/PowerShell/7/pwsh.exe',arguments}),expected,arguments);
assert(p.actionUsesRoot({execute:'C:/Program Files/nodejs/node.exe',arguments:'--use-system-ca C:/prod81/run.js'}));
assert(!p.actionUsesRoot({execute:'C:/Program Files/nodejs/node.exe',arguments:'-e C:/prod81/run.js'}));
assert(!p.actionUsesRoot({execute:'cmd.exe',arguments:'/c C:/prod81/run.ps1'}));
const redirected=rootPolicy(c,g,x=>x.includes('link')?'C:/evil/run.ps1':path.win32.normalize(x));
assert(!redirected.actionUsesRoot({execute:'C:/Program Files/PowerShell/7/pwsh.exe',arguments:'-File C:/prod81/link/run.ps1'}));
const missing=rootPolicy(c,g,x=>{if(x.endsWith('.ps1'))throw Error('ENOENT');return x;});
assert(!missing.actionUsesRoot({execute:'C:/Program Files/PowerShell/7/pwsh.exe',arguments:'-File C:/prod81/missing.ps1'}));
for(const execute of ['pwsh.exe','node.exe','C:/unapproved/pwsh.exe','C:/unapproved/node.exe','C:/Program Files/PowerShell/7-evil/pwsh.exe','C:/Program Files/PowerShell/7/../../evil/pwsh.exe'])
 assert(!p.actionUsesRoot({execute,arguments:'-File C:/prod81/run.ps1'}),execute);
assert(p.actionUsesRoot({execute:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',arguments:'-File C:/prod81/run.ps1'}));
assert(p.actionUsesRoot({execute:'c:/PROGRAM FILES/PowerShell/7/pwsh.exe',arguments:'-File C:/prod81/run.ps1'}));
const exeRedirect=rootPolicy(c,g,x=>x.endsWith('pwsh.exe')?'C:/unapproved/pwsh.exe':path.win32.normalize(x));
assert(!exeRedirect.actionUsesRoot({execute:'C:/Program Files/PowerShell/7/pwsh.exe',arguments:'-File C:/prod81/run.ps1'}));
const exeMissing=rootPolicy(c,g,x=>{if(x.endsWith('.exe'))throw Error('ENOENT');return path.win32.normalize(x);});
assert(!exeMissing.actionUsesRoot({execute:'C:/Program Files/nodejs/node.exe',arguments:'C:/prod81/run.js'}));
assert(p.actionUsesRoot({execute:'"C:/Program Files/PowerShell/7/pwsh.exe"',arguments:'-File C:/prod81/run.ps1'}));
assert(!p.actionUsesRoot({execute:'"C:/Program Files/PowerShell/7/pwsh.exe" -Command evil',arguments:'-File C:/prod81/run.ps1'}));
console.log(JSON.stringify({ok:true,tests:28,scope:'isolated_path_and_resolver_fixtures'}));
