'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'capture-daytrade-module-readbacks.js'),'utf8');
const start=source.indexOf('async function capture(id,role){'),end=source.indexOf('(async()=>{',start);
if(start<0||end<0)throw Error('CAPTURE_ENTRY_NOT_FOUND');
(async()=>{
 for(const id of ['A01','A19','B14','B20'])for(const role of ['db','anon'])for(const planned of [false,true]){
  let calls=0;
  const context={writeSet:planned?{}:null,writeSetIndex:{modules:planned?{[id]:{}}:{}},identity:{trade_date:'2026-09-29'},serviceKey:'service',anonKey:'anon',process:{env:{}},url:'https://example.invalid',date:'2026-09-29',canonical:'c',snapshotRun:'s',seq:1,writerRun:'w',writerGeneration:'g',snapshot:'s',URL,AbortSignal,fetch:async()=>{calls++;throw Error('isolated offline');}};
  const capture=vm.runInNewContext(source.slice(start,end)+'\ncapture;',context),result=await capture(id,role);
  assert.equal(result.status,'blocked');assert.equal(calls,planned?1:0);
  if(!planned)assert.equal(result.failed_checks[0],'WRITER_WRITE_SET_MISSING');
 }
 console.log('PASS: actual capture avoids absent-plan DB/anon queries; planned modules still read');
})().catch(e=>{console.error(e);process.exitCode=1;});
