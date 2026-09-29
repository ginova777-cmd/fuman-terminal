'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const date=d=>new Date(d.getTime()+28800000).toISOString().slice(0,10);
const env={},box={module:{exports:{}},process:{env},require:name=>name==='../scripts/twse-trading-day'?{
 isTwseTradingDay:async d=>({isTradingDay:['2026-09-24','2026-09-29'].includes(date(d)),date:date(d)}),dateKey:x=>x,taipeiDateParts:date
}:require(name)};
vm.runInNewContext(fs.readFileSync(require.resolve('../lib/terminal-strategy-morning-handoff'),'utf8'),box);
const receipt={trade_date:'2026-09-24',run_id:'s4-prev',strategy_version:'s4-v1',complete:true,checked_at:'2026-09-24T08:00:00Z'};
const check=r=>box.module.exports.resolveStrategyHandoff({strategyId:'strategy4',sourceReceipt:r,executionDate:'2026-09-29',now:new Date('2026-09-29T06:00:00+08:00'),stateDir:'isolated'});
(async()=>{
 assert.equal((await check(receipt)).ok,true);
 assert((await check({...receipt,trade_date:'2026-09-23'})).failed_checks.includes('SOURCE_DATE_MISMATCH'));
 assert((await check({...receipt,checked_at:'2026-09-23T00:00:00Z'})).failed_checks.includes('SOURCE_TIMESTAMP_BEFORE_SOURCE_DATE'));
 assert((await check({...receipt,complete:false})).failed_checks.includes('SOURCE_NOT_READY'));
 env.TERMINAL_HANDOFF_MAX_AGE_DAYS='3';assert((await check(receipt)).failed_checks.includes('STALE_SOURCE'));
 env.TERMINAL_HANDOFF_MAX_AGE_DAYS='invalid';assert((await check(receipt)).failed_checks.includes('SOURCE_AGE_POLICY_INVALID'));
 console.log('PASS previous completed session across holiday; wrong date, pre-source timestamp, incomplete source and explicit age policy checked. Isolated calendar only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
