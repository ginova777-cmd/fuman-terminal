'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
(async()=>{
 const start=source.indexOf('  // Persist real natural-candle module rows');
 const end=source.indexOf('  writeModuleProducerReceipts(result, taipeiDate());',start);
 assert(start>=0&&end>start);
 let publications=0;
 const result={payload:{}};
 const context={result,moduleWorkIds:()=>[],sideMinutes:600,require:name=>{assert.equal(name,'./module-persistence-circuit.cjs');return require(name);},publishInitialSource:async()=>{publications++;}};
 // Execute the real phase. Any collector, disk, or DB operation would fail:
 // none of those dependencies are supplied to this paused-path fixture.
 await vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
 assert.equal(publications,1);assert.deepEqual(Object.keys(result.payload.module_write_sets),[]);
 const captureStart=source.indexOf('  if(moduleWorkIds().length){',end);
 const captureEnd=source.indexOf('  tickStage("status_scorecard:complete");',captureStart);
 await vm.runInNewContext('(async()=>{'+source.slice(captureStart,captureEnd)+'})()',context);
 assert.equal(publications,1);assert.equal(result.payload.module_readback_capture.status,'PAUSED');
 assert.equal(result.payload.module_verifier_runner.complete,false);
 console.log('PASS: actual paused Writer module phases perform no module input reads, RPCs, capture subprocesses or verifier subprocesses; core publication remains single');
})().catch(e=>{console.error(e);process.exitCode=1;});
