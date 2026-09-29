'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const s=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
const {SOURCE_REGISTRY}=require('../lib/terminal-strategy-morning-handoff');
for(const key of ['scorecard88','watch_case','futures']) assert(Object.hasOwn(SOURCE_REGISTRY,key));
assert(!Object.hasOwn(SOURCE_REGISTRY,'strategy1'));
const a=s.indexOf('    const terminalGroups = Object.fromEntries(registeredKeys.map('),b=s.indexOf('    const terminalUnion =',a);
for(const minutes of [360,480,525]){
 const c={registeredKeys:Object.keys(SOURCE_REGISTRY),groups:{},objectPayload:x=>x||{},taipeiDate:()=> '2026-09-29',taipeiMinutes:()=>minutes};
 vm.createContext(c);vm.runInContext(s.slice(a,b)+';globalThis.result=terminalGroups;',c);
 for(const key of ['scorecard88','watch_case','futures']) assert.equal(c.result[key].status,'BLOCKED');assert.equal(c.result.futures.reason,'source_adapter_not_registered');
}
console.log('PASS A03 previous-session futures missing adapter remains blocked at 06:00,08:00,08:45');
