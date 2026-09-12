"use strict";
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process');const root=path.resolve(__dirname,'..');
const {assessLeaderFreshness}=require('../lib/opening-report-asia-freshness');const japan=require('../lib/opening-report-japan-realtime');const date='2026-09-14';
for(const [time,ok]of [['00:00:00',true],['00:20:00',true],['00:30:59.999',true],['00:31:00',false]]){assert.equal(japan.inWindow(Date.parse(date+'T'+time+'Z'),date),ok);assert.equal(assessLeaderFreshness({yahoo_symbol:'4062.T',source_time:date+'T'+time+'Z'},date).fresh,ok);}
assert.equal(japan.inWindow(Date.parse('2026-09-11T00:30:00Z'),date),false);
const runner=fs.readFileSync(path.join(root,'scripts/run-opening-report-0830-production.js'),'utf8');
const body=runner.match(/async function buildOverseasPreflight[\s\S]*?\n}\r?\n/)[0];
const check=vm.runInNewContext('('+body+')',{timestamp:()=>new Date().toISOString()});
const wrapper=fs.readFileSync(path.join(root,'run-opening-report-0830-production-wrapper.ps1'),'utf8');
assert.ok(wrapper.indexOf('-Label "source-freeze-0830"')<wrapper.indexOf('$runnerArgs ='));
assert.ok(wrapper.includes('$sourceFreeze.exitCode -ne 0'));assert.ok(wrapper.includes('$IsolatedBacktest -or $ReuseLineReceipt'));
const registry=require('./fuman-schedule-registry.json');assert.ok(!registry.policy.activeTasks.includes('Fuman Opening Report 0820 Preflight'));assert.ok(registry.policy.retiredTasks.includes('Fuman Opening Report 0820 Preflight'));
const old=cp.spawnSync(process.execPath,[path.join(root,'scripts/run-opening-report-0820-preflight.js')],{encoding:'utf8'});assert.equal(old.status,1);assert.ok(old.stderr.includes('RETIRED'));
const preflight=fs.readFileSync(path.join(root,'scripts/run-opening-report-0830-preflight.js'),'utf8');assert.ok(preflight.includes('taipeiTime >= "08:30" && taipeiTime < "08:31"'));assert.ok(preflight.includes('const selfTest = false'));assert.ok(preflight.includes('--wrapper-owned'));
(async()=>{const good={ok:true,date,run_id:'run-A',cutoff:date+' 08:30:59 Asia/Taipei',industries:Array(15).fill({})};assert.equal((await check(date,'run-A',good)).ok,true);for(const patch of [{run_id:'run-B'},{date:'2026-09-11'},{cutoff:date+' 08:20:59 Asia/Taipei'},{industries:[]},{ok:false}])assert.equal((await check(date,'run-A',{...good,...patch})).ok,false);assert.equal((await check(date,'run-A',null)).ok,false);console.log(JSON.stringify({ok:true,unified_0830:true,old_task_retired:true,source_run_identity:true,late_and_old_source_rejected:true}));})().catch(e=>{console.error(e);process.exitCode=1;});
