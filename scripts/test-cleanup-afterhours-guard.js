'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-guard-test-'));
fs.mkdirSync(path.join(dir,'scripts'));
fs.copyFileSync(path.join(root,'schedule-guard.ps1'),path.join(dir,'schedule-guard.ps1'));
fs.writeFileSync(path.join(dir,'scripts/check-market-calendar-action.js'),"console.log(process.env.CLEANUP_TEST_CALENDAR);");
const runner=path.join(dir,'probe.ps1');
fs.writeFileSync(runner,"param([switch]$Allow)\n. \"$PSScriptRoot/schedule-guard.ps1\"\nfunction Get-FumanTaipeiNow { [datetime]'2026-09-11T17:10:00' }\nfunction Get-FumanMarketHolidays { @() }\nInvoke-FumanWeekdayGuard -Label 'Cleanup regression' -AllowAfterFormalSourceWindow:$Allow\nWrite-Output 'CLEANUP_REACHED'\n");
const env={...process.env,FUMAN_FORCE_RUN:'0',FUMAN_STRATEGY5_REPLAY_VALIDATED:'0',FUMAN_INSTITUTION_REPLAY_VALIDATED:'0'};
for(const test of [{name:'after-close allowed',open:true,status:'after_formal_source_window',allow:true,reached:true},{name:'generic source still blocked',open:true,status:'after_formal_source_window',allow:false,reached:false},{name:'holiday remains skipped',open:false,status:'closed',allow:true,reached:false}]){
 const payload={marketOpen:test.open,marketStatus:test.status,scannerAction:'skip_formal_scan',sourceFreshnessRequired:false};
 const r=cp.spawnSync('pwsh.exe',['-NoProfile','-File',runner,...(test.allow?['-Allow']:[])],{encoding:'utf8',env:{...env,CLEANUP_TEST_CALENDAR:JSON.stringify(payload)},windowsHide:true});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.includes('CLEANUP_REACHED'),test.reached,test.name);console.log('PASS '+test.name);
}
console.log('Isolated fixtures retained: '+dir);
