'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {readSharedPreopenEvidence:read}=require('../lib/preopen-local-evidence.cjs');
const source=fs.readFileSync(require.resolve('./run-daytrade-near-one-source.js'),'utf8');
const take=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
(async()=>{
 let calls=[];
 const row={symbol:'3163',valid:true,trial_price:650};
 const base={symbols:['3163'],readLocal:()=>{calls.push('local');return [row];},isUsable:r=>r.valid===true};
 assert.deepEqual(await read({...base,readRemote:async()=>{throw Error('must not query');}}),[row]);
 assert.deepEqual(calls,['local']);
 calls=[];
 const combined=await read({...base,symbols:['3163','2330','2330'],readRemote:async symbols=>{
   calls.push(symbols);return [{symbol:'2330',valid:true},{symbol:'9999',valid:true}];}});
 assert.deepEqual(calls,['local',['2330']]);assert.deepEqual(combined.map(r=>r.symbol),['3163','2330']);
 const replaced=await read({...base,readLocal:()=>[{symbol:'3163',valid:false}],readRemote:async()=>[{symbol:'3163',valid:true}]});
 assert.equal(replaced.length,1);assert.equal(replaced[0].valid,true);
 let batches=0;
 const symbols=Array.from({length:402},(_,i)=>String(1000+i));symbols.push('3163');
 await assert.rejects(read({...base,symbols,readRemote:async group=>{batches++;if(batches===2)throw Error('522');return group.map(symbol=>({symbol}));}}),e=>{
   assert.equal(e.message,'PREOPEN_DB_READ_FAILED');assert.deepEqual(e.preopenLocalEvidence,[row]);
   assert.equal(e.preopenReadEvidence.db_write_allowed,false);assert.equal(e.preopenReadEvidence.failed_batch_offset,200);return true;
 });assert.equal(batches,2,'stop after first failed batch');

 // Execute the producer's actual slot validator and read entry, without main.
 const now=Date.parse('2026-10-02T00:55:30Z');
 class Clock extends Date {static now(){return now;}}
 let requested=[];
 const natural={symbol:'3163',is_trial:true,trial_price:650,reference_price:640,best_bid_price:650,best_ask_price:651,
   payload:{source:'fugle-daytrade-ws:trial-cache',trialEventAt:'2026-10-02T00:55:10Z'}};
 let local=[natural];
 const sandbox={Date:Clock,Intl,Number,String,Boolean,require:()=>({readSharedPreopenEvidence:read}),
   normalizeIso:(value,fallback)=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():fallback,
   taipeiDate:value=>new Date(Date.parse(value)+28800000).toISOString().slice(0,10),
   numberValue:value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null,
   readLocalPreopenRows:()=>local,supabaseGetPaged:async(resource,query)=>{requested.push(query);return [];}};
 vm.createContext(sandbox);
 vm.runInContext(take('function trialFromSnapshot(', 'function readLocalPreopenRows(')+take('async function readPreopenRows(', 'function latestBySymbol('),sandbox);
 assert.equal((await sandbox.readPreopenRows(['3163'],'2026-10-02','0855')).length,1);assert.equal(requested.length,0);
 for(const event of ['2026-10-01T00:55:10Z','2026-10-02T00:54:10Z','2026-10-02T00:55:59Z']){
   local=[{...natural,payload:{...natural.payload,trialEventAt:event}}];
   const diagnostics=await sandbox.readPreopenRows(['3163'],'2026-10-02','0855');
   assert.equal(diagnostics.length,1,'retain rejected evidence for diagnosis');
   assert.equal(sandbox.trialFromSnapshot(diagnostics[0],'2026-10-02','0855').trial_price,null);
 }
 assert.equal(requested.length,3,'wrong date, slot and future event all require other evidence');

 // Execute actual runOnce: a failed read cannot reach either upsert.
 let writes=0;
 const runner={argValue:(k,d)=>d,taipeiDate:()=> '2026-10-02',captureSlot:()=> '0855',CAPTURE_SLOTS:['0855'],APPLY:true,
  readTickerMap:async()=>({rows:[{symbol:'3163',fut_contract:'CAFJ6'}]}),
  readFugleFutoptWebSocketQuotes:()=>({quotes:new Map()}),supabaseGetPaged:async()=>[],normalizeFutureSymbol:String,
  selectQuote:()=>({fut_price:650}),readPreopenRows:async()=>{throw Error('PREOPEN_DB_READ_FAILED');},
  supabaseUpsert:async()=>{writes++;},console};
 vm.createContext(runner);vm.runInContext(take('async function runOnce()', 'async function main()'),runner);
 await assert.rejects(runner.runOnce(),/PREOPEN_DB_READ_FAILED/);assert.equal(writes,0);
 console.log('PASS: local-first, missing-only reads, bounded failure, exact slot/date/future checks, no DB writes after failure.');
})().catch(e=>{console.error(e);process.exitCode=1;});
