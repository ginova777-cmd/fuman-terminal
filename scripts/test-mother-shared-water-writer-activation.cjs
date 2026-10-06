'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const start=source.indexOf('  const sharedWaterContext = APPLY'),end=source.indexOf('  tickStage("final_water_refresh:complete"',start);
assert(start>=0&&end>start);
async function run(enabled,apply=true,dry=false){
 let ledgerCalls=0,hookCalls=0,syncOptions;
 const context={APPLY:apply,DRY_RUN:dry,process:{env:{FUMAN_SHARED_WATER_ACCEPTANCE:enabled?'1':'0'}},runtimePath:()=> 'offline',writerTickIdentity:{writer_run_id:'w'},sharedWaterGuard:()=>true,result:{payload:{}},recoveryRelease:'a'.repeat(40),SUPABASE_URL:'https://example.test',taipeiDate:()=> '2026-10-06',URL,
 require(name){
 if(name.includes('publication-context'))return {bindPublishedContext:async()=>({expected:{writer_run_id:'w'},assertCurrent:async()=>true})};
 if(name.includes('source-readback'))return {createSourceReadback:()=>async()=>({})};
 if(name.includes('writer-hooks'))return {createHooks(){hookCalls++;return {beforeQuoteRead(){}};}};
 if(name.includes('server-supabase-key'))return {anonKey:()=> 'offline'};
 if(name.includes('quote-ledger'))return {createLedger(){ledgerCalls++;return {};}};
 if(name.includes('final-water-refresh'))return {refresh:async o=>o.run()};
 if(name.includes('sync-daytrade-websocket'))return {runFastSync:async o=>{syncOptions=o;return {};}};
 throw Error(name);
 }};
 await vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
 const active=enabled&&apply&&!dry;
 assert.equal(hookCalls,active?1:0);assert.equal(ledgerCalls,active?1:0);
 if(active){assert.equal(syncOptions.quotesOnly,true);assert.equal(syncOptions.recentCandles,true);}
 else assert.equal(syncOptions,undefined,'disabled path must keep original full sync');
}
(async()=>{await run(false);await run(true);await run(true,false);await run(true,true,true);console.log(JSON.stringify({ok:true,cases:4,mode:'actual_writer_feature_activation',production_writes:0}));})().catch(e=>{console.error(e);process.exitCode=1;});
