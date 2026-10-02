'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {evaluateOpeningObservation:evaluate}=require('../lib/mother-pool-opening-observation');
const base={required:true,bridgeOk:true,ackOk:true,symbols:['2330','3044'],stages:[]};
const valid=evaluate(base,['2330','3044'],['2330']);
assert.equal(valid.status,'AVAILABLE');assert.equal(valid.priority_observation_allowed,true);
assert.deepEqual(valid.watch_only_symbols,['3044']);assert.deepEqual(valid.formal_member_symbols,['2330']);
assert.equal(valid.formal_candidate_allowed,false);assert.equal(valid.publish_allowed,false);assert.equal(valid.affects_core_acceptance,false);
for(const evidence of [{...base,bridgeOk:false},{...base,ackOk:false},{...base,bridgeOk:false,ackOk:false}]){
 const result=evaluate(evidence,['2330','3044'],['2330']);assert.equal(result.status,'UNAVAILABLE');assert.equal(result.priority_observation_allowed,false);assert.deepEqual(result.observation_symbols,[]);assert.equal(result.required,false);assert.equal(result.affects_core_acceptance,false);
}
assert.equal(evaluate(base,['2330'],['2330']).status,'UNAVAILABLE');
assert.equal(evaluate({...base,required:false},[],[]).status,'NOT_DUE');
assert.equal(evaluate({...base,symbols:[]},[],[]).status,'AVAILABLE');
const source=fs.readFileSync(path.join(__dirname,'verify-daytrade-mother-pool-closed-loop.js'),'utf8');
assert.ok(source.includes('opening_report: openingObservation'));
assert.ok(!source.includes('openingAckLiveAdmissibleSymbols'));
assert.ok(!/check\(\s*"opening_report_/.test(source));
for(const gate of ['websocket_healthy','websocket_fresh','mother_pool_same_day','mother_pool_canonical'])assert.ok(source.includes('check("'+gate+'"'),gate);
assert.ok(source.includes('closed_loop_ok: failures.length === 0'));
console.log('PASS: morning observation isolated; unavailable evidence disables weight; watch-only symbols never gain membership; core gates remain wired. No network.');
