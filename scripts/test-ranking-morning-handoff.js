'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(require.resolve('../lib/terminal-strategy-morning-handoff'),'utf8');
const context={module:{exports:{}},process:{env:{}},require:name=>name==='../scripts/twse-trading-day'?{
 isTwseTradingDay:async d=>({isTradingDay:true,date:new Date(d.getTime()+28800000).toISOString().slice(0,10)}),
 dateKey:x=>x,taipeiDateParts:d=>new Date(d.getTime()+28800000).toISOString().slice(0,10)
}:require(name)};
vm.createContext(context);vm.runInContext(code,context);
const source={source_date:'2026-09-17',run_id:'intraday-turnover:2026-09-17:test',canonical_run_id:'fugle_daytrade_source:20260917:canonical',strategy_version:'daytrade_intraday_turnover_verifier_v1',complete:true,checked_at:'2026-09-17T05:29:00Z'};
const inspect=s=>context.module.exports.resolveStrategyHandoff({strategyId:'ranking',sourceReceipt:s,executionDate:'2026-09-18',now:new Date('2026-09-18T06:00:00+08:00'),stateDir:'isolated'});
(async()=>{let checks=0;let r=await inspect(source);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.source_canonical_run_id,source.canonical_run_id);checks++;
 r=await inspect({...source,canonical_run_id:'ranking:20260917:canonical'});assert(r.failed_checks.includes('SOURCE_CANONICAL_MISMATCH'));checks++;
 r=await inspect({...source,checked_at:'2026-09-18T07:00:00+08:00'});assert(r.failed_checks.includes('SOURCE_TIMESTAMP_IN_FUTURE'));checks++;
 console.log(JSON.stringify({checks,scope:'isolated_handoff_with_calendar_adapter',production_complete:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
