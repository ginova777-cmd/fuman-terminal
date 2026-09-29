'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'../lib/terminal-strategy-morning-handoff.js');
const dateKey=d=>typeof d==='string'?d:new Date(d).toISOString().slice(0,10);
const box={module:{exports:{}},process:{env:{}},require:name=>name==='path'?path:{
 isTwseTradingDay:async date=>({isTradingDay:true,date:dateKey(date)}),dateKey,taipeiDateParts:date=>dateKey(date),
}};
vm.runInNewContext(fs.readFileSync(file,'utf8'),box,{filename:file});
const {STRATEGIES,buildTerminalStrategyHandoffs}=box.module.exports;
const receipts=Object.fromEntries(STRATEGIES.map(s=>[s,{source_date:'2026-09-28',run_id:s+'-run',strategy_version:'test-v1',complete:true,checked_at:'2026-09-28T07:00:00Z'}]));
const args={executionDate:'2026-09-29',now:new Date('2026-09-29T00:00:00Z')};
(async()=>{
 const full=await buildTerminalStrategyHandoffs({...args,receipts});
 assert.equal(full.complete,true); assert.equal(full.first_blocker,null);
 const partial=await buildTerminalStrategyHandoffs({...args,receipts:{strategy2:receipts.strategy2}});
 assert.equal(partial.ready_strategies.length,1); assert.equal(partial.complete,false); assert.equal(partial.first_blocker,'SOURCE_NOT_READY');
 const empty=await buildTerminalStrategyHandoffs({...args,receipts:{}});assert.equal(empty.complete,false);
 const failed=await buildTerminalStrategyHandoffs({...args,receipts:{...receipts,strategy3:{...receipts.strategy3,complete:false}}});assert.equal(failed.complete,false);
 console.log('PASS actual handoff aggregation: all ready, partial, empty, incomplete source');
})().catch(e=>{console.error(e);process.exitCode=1;});
