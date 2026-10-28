'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),assert=require('node:assert/strict');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'s5-watchdog-market-order-'));
fs.mkdirSync(path.join(tmp,'scripts'));
fs.copyFileSync(path.join(__dirname,'../run-strategy5-watchdog.ps1'),path.join(tmp,'run-strategy5-watchdog.ps1'));
fs.writeFileSync(path.join(tmp,'legacy-entrypoint-guard.ps1'),`param([string]$Label)\n'called' | Set-Content (Join-Path $PSScriptRoot 'legacy-called.txt')\nthrow 'LEGACY_EXPECTED_TEST_STOP'\n`);
for(const [name,code,exit,legacy] of [['closed',10,0,false],['unverified',2,2,false],['open',0,1,true]]){
 const marker=path.join(tmp,'legacy-called.txt');if(fs.existsSync(marker))fs.unlinkSync(marker);
 fs.writeFileSync(path.join(tmp,'scripts/invoke-market-status-guard.ps1'),`param([string]$Stage,[string]$ExecutionMode)\nif($Stage -ne 'strategy5-watchdog' -or $ExecutionMode -ne 'recovery'){exit 91}\nexit ${code}\n`);
 const r=cp.spawnSync('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-File',path.join(tmp,'run-strategy5-watchdog.ps1')],{encoding:'utf8',timeout:15000});
 assert.equal(r.status,exit,`${name}: ${r.stderr}`);assert.equal(fs.existsSync(marker),legacy,name);
 if(legacy)assert.match(r.stderr,/LEGACY_EXPECTED_TEST_STOP/);
}
console.log('PASS actual watchdog: closed/unverified exit before legacy gate; open retains prior routing (isolated boundaries).');
