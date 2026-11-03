'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const selection=require('../lib/strategy5-technical-selection');
const contract=require('../lib/institution-indicator-contract.cjs');
const date='2000-01-20';
const bars=[90,92,91,93,92,94,93,95,94,96,95,97,96,98,97,99,98,100,99,101,100,112].map((close,i)=>({date:new Date(Date.UTC(2000,0,-1+i)).toISOString().slice(0,10),high:close+2,low:close-2,open:close-1,close}));
const row={code:'2330',name:'fixture',market:'TWSE',close:112,score:80,matches:[{id:'volume_turnover_breakout',score:80}]};
const result=selection.evaluate([row],{'2330':{daily:bars,hourly60:[]}},date);
assert.equal(result.selectionCoverage.indicatorContract,'technical-kd5-3-rsi5-15-v2');
assert(contract.checkTrend(result.selected[0].technicalTrend));
assert.equal(result.selected[0].technicalTrend.daily.rsiEvidence.timeframe,'1d');
for(const old of ['technical-kd5-3-rsi5-15-v1','technical-kd5-3-rsi3-6-v1'])assert(!contract.checkCoverage({indicatorContract:old}));
assert.equal(selection.evaluate([row],{'2330':{daily:bars.slice(-16),hourly60:[]}},date).selectionCoverage.dataCoverage,0);
const live=fs.readFileSync(path.join(root,'scripts/verify-strategy5-live-readback.js'),'utf8');
assert(live.includes('Strategy5 RSI v2 contract required'));
assert(fs.readFileSync(path.join(root,'scripts/verify-strategy5-complete.js'),'utf8').includes('strategy5_rsi_v2_contract_not_verified'));
// Execute the real outer runner with isolated external-boundary fixtures only.
// No network, scheduled tasks, production code or runtime writes.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'strategy5-rsi2-market-'));
fs.mkdirSync(path.join(temp,'scripts'));fs.mkdirSync(path.join(temp,'runtime/logs'),{recursive:true});
fs.mkdirSync(path.join(temp,'runtime/data/scan-receipts'),{recursive:true});
fs.copyFileSync(path.join(root,'run-strategy5-complete.ps1'),path.join(temp,'run-strategy5-complete.ps1'));
fs.writeFileSync(path.join(temp,'schedule-guard.ps1'),"throw 'legacy guard must not be loaded'\n");
// Dot-sourcing currently only defines legacy functions; do not supply any bypass.
fs.writeFileSync(path.join(temp,'schedule-guard.ps1'),'# empty fixture; legacy functions unavailable\n');
const attempt=path.join(temp,'runtime/data/scan-receipts/strategy5-complete-attempt.json');
const canonical=path.join(temp,'runtime/data/scan-receipts/strategy5-complete.json');
fs.writeFileSync(canonical,'{"complete":true,"runId":"prior-run"}');
for(const mode of ['weekend','holiday','typhoon','unknown','malformed']){
 const skip={status:'SKIPPED',scanExecuted:false,stage:'strategy5',marketReceipt:'fixture-calendar',runId:'market-'+mode,skipReason:mode};
 const text=mode==='malformed'?'not-json':JSON.stringify(skip);
 fs.writeFileSync(path.join(temp,'scripts/invoke-market-status-guard.ps1'),`param($Stage,$TradeDate,$ExecutionMode)\nWrite-Output '${text}'\nexit ${mode==='unknown'?2:10}\n`);
 const child=cp.spawnSync('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-File',path.join(temp,'run-strategy5-complete.ps1')],{encoding:'utf8',env:{...process.env,FUMAN_RUNTIME_DIR:path.join(temp,'runtime')},timeout:30000,windowsHide:true});
 const report=JSON.parse(fs.readFileSync(attempt,'utf8').replace(/^\uFEFF/,''));
 if(['unknown','malformed'].includes(mode)){assert.notEqual(child.status,0);assert.equal(report.complete,false);assert.notEqual(report.status,'SKIPPED');}
 else {assert.equal(child.status,0,child.stdout+child.stderr);assert.equal(report.status,'SKIPPED');assert.equal(report.exitCode,0);assert.equal(report.runId,'market-'+mode);assert.equal(report.complete,false);assert.equal(report.evaluationComplete,true);}
 assert.equal(report.scanExecuted,false);assert.equal(fs.readFileSync(canonical,'utf8'),'{"complete":true,"runId":"prior-run"}');
}
assert(fs.readdirSync(path.join(temp,'runtime/data/scan-receipts/history/strategy5-complete-attempts')).length>=9);
console.log('PASS RSI v2 identity, 17 bars, old-contract rejection; real runner weekend/holiday/typhoon skip, unknown/malformed fail-closed, canonical preservation, immutable attempt history. Fixtures: '+temp);
