'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8'),a=source.indexOf('  let initialSourcePublication = null;'),b=source.indexOf('  // Persist real natural-candle',a);
assert(a>0&&b>a);
(async()=>{let calls=0;const failure=Error('unconfirmed write');const ctx={result:{},writeStatusAndScorecard:async()=>{calls++;throw failure;}};await assert.rejects(vm.runInNewContext('(async()=>{'+source.slice(a,b)+'try{await publishInitialSource();}catch{} await publishInitialSource();})()',ctx),e=>e===failure);assert.equal(calls,1);console.log('PASS actual Writer source barrier rethrows same failure and never replays publication');})().catch(e=>{console.error(e);process.exitCode=1;});
