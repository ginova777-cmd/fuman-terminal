'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const s=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const start=s.indexOf('function computeStats('),use=s.indexOf('const motherKCoverage',start),decl=s.indexOf('const offSession =',start);
assert(decl>start&&decl<use);assert(s.slice(start,s.indexOf('function sourceGateA(',start)).match(/const offSession =/g).length===1);
const line=s.slice(decl,s.indexOf(';',decl)+1);
for(const phase of ['regular_daytrade_0935_1330','opening_detection_0900_0934','preopen_prepare_0830_0844','after_daytrade_window','closed_before_0600']){
const after0900=['regular_daytrade_0935_1330','opening_detection_0900_0934'].includes(phase);
const value=vm.runInNewContext(line+';({offSession,intraday:after0900&&!offSession})',{phase,after0900});
assert.equal(value.offSession,['closed_before_0600','after_daytrade_window'].includes(phase));assert.equal(value.intraday,after0900);
}
console.log('PASS initialization order, five phase cases, unchanged offSession formula');
