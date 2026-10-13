'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(require.resolve('./twse-trading-day'),'utf8');
async function run(stall){
 let writes=0,requests=0;const module={exports:{}};
 const context={module,exports:module.exports,Date,Intl,Buffer,Map,AbortController,setTimeout,clearTimeout,__dirname:__dirname,
  process:{env:{FUMAN_RUNTIME_DIR:'ISOLATED'}},
  require:name=>name==='fs'?{readFileSync:()=>{throw Error('MISSING');},mkdirSync(){},writeFileSync(){writes++;}}:require(name),
  fetch:async(_,options)=>{requests++;return{ok:true,body:stall?{async *[Symbol.asyncIterator](){await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('ABORTED')),{once:true}));}}:[Buffer.from(JSON.stringify([{Date:'1150101',Name:'元旦',Description:'休市'}]))]};}};
 vm.runInNewContext(source,context);
 const t=performance.now(),result=await module.exports.isTwseTradingDay(new Date('2026-10-13T12:00:00+08:00'),{stateDir:'ISOLATED',includeEvidence:true,deadlineMs:Date.now()+(stall?30:3000)});
 assert.equal(requests,1);
 if(stall){assert.equal(writes,0);assert.equal(result.source,'weekend_fallback');assert.equal(result.error,'ABORTED');assert(performance.now()-t<2000);}
 else{assert.equal(writes,1);assert.equal(result.source,'twse');assert(result.calendar_evidence.fetched_at);}
}
(async()=>{await run(false);await run(true);console.log('PASS A04 opt-in provider deadline covers response body; timeout writes no refreshed cache');})().catch(e=>{console.error(e);process.exitCode=1;});
