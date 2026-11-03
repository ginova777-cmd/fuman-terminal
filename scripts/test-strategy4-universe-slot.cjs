'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const u=require('../lib/strategy4-universe-contract.cjs'),slot=require('../lib/strategy4-natural-slot.cjs');
const file=path.join(process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime','data/contracts/strategy4-fixed-universe-20261020.json');
const a=u.load(file,'2026-10-22'),rows=a.symbols.map(code=>({code})),proof=u.freeze(a,rows,'2026-10-22');
process.env.STRATEGY4_USE_MIS='0';
process.env.FUMAN_SCANNER_TARGET_TRADE_DATE='2026-10-22';
process.env.STRATEGY4_FIXED_UNIVERSE_FILE=file;
const scanner=require('./scan-strategy4-cache');
test('runner binds both runtime aliases for scorecard collector and same-run recovery',()=>{
 const runner=fs.readFileSync(path.join(__dirname,'../run-strategy4.ps1'),'utf8');
 assert(runner.includes('$env:FUMAN_RUNTIME_DIR = $runtime'));
 assert(runner.includes('$env:FUMAN_RUNTIME_ROOT = $runtime'));
 assert(runner.indexOf('$env:FUMAN_RUNTIME_ROOT = $runtime')<runner.indexOf('invoke-market-status-guard.ps1'));
});
test('real scanner universe path keeps all approved symbols despite runtime blacklist',async()=>{
 const result=await scanner.fetchUniverse(async()=>rows);
 assert.equal(result.length,1943);assert.equal(u.digest(result.map(r=>r.code)),u.SHA);
});
test('real scanner rejects source read failure, partial and missing universe without fallback',async()=>{
 await assert.rejects(scanner.fetchUniverse(async()=>{throw Error('HTTP 522');}),/authoritative_universe_unavailable/);
 await assert.rejects(scanner.fetchUniverse(async()=>rows.slice(0,1605)),/set_drift/);
 await assert.rejects(scanner.fetchUniverse(async()=>[]),/universe_empty/);
});
test('approved 1943 survives deprecated blacklist; full persisted set validates',()=>assert(u.validateEvidence(proof,a.symbols,'2026-10-22')));
for(const [n,change]of Object.entries({missing:x=>x.pop(),duplicate:x=>x[1]=x[0],replaced:x=>x[1]='0000'}))test('eligible '+n+' fails closed',()=>{const x=structuredClone(rows);change(x);assert.throws(()=>u.freeze(a,x,'2026-10-22'));});
test('1605/1605 cannot satisfy fixed contract',()=>assert.equal(u.validateEvidence(proof,a.symbols.slice(0,1605),'2026-10-22'),false));
test('wrong date and duplicate processing rejected',()=>{assert(!u.validateEvidence(proof,a.symbols,'2026-10-23'));const x=[...a.symbols];x[0]=x[1];assert(!u.validateEvidence(proof,x,'2026-10-22'));});
const s={executionMode:'natural',tradeDate:'2026-10-22',startedAt:'2026-10-22T16:00:02+08:00',naturalSlotEvidence:{taskName:'Fuman Strategy4 Cache 1600',state:'Running',enabled:true,lastRunTime:'2026-10-22T16:00:01+08:00',runnerPath:'C:/fuman-release-owner/prod81/run-strategy4.ps1'}};
test('proven 1600 natural trigger is eligible only after final verification',()=>assert(slot.eligible(s)));
for(const mode of ['recovery_replay','recovery_same_run','authorized_maintenance'])test(mode+' never claims natural slot',()=>assert(!slot.eligible({...s,executionMode:mode})));
test('missing/stale/scheduler-disabled evidence never claims natural completion',()=>{for(const e of [null,{...s.naturalSlotEvidence,state:'Ready'},{...s.naturalSlotEvidence,enabled:false},{...s.naturalSlotEvidence,lastRunTime:'2026-10-22T15:00:00+08:00'}])assert(!slot.eligible({...s,naturalSlotEvidence:e}));});
test('deployed scanner persists and final verifier checks full-set evidence',()=>{const src=fs.readFileSync(path.join(__dirname,'scan-strategy4-cache.js'),'utf8');assert(src.includes('fixedUniverse: output.fixedUniverse'));assert(src.includes('scannedCodes: output.scannedCodes'));assert(src.includes('insufficientHistoryCodes.size && !activeFixedUniverse'));const v=fs.readFileSync(path.join(__dirname,'verify-strategy4-complete.js'),'utf8');assert(v.includes('strategy4_fixed_universe_not_fully_accounted'));assert(v.includes('final.naturalSlotComplete='));});
