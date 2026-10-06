'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.resolve(__dirname,'../lib/strategy3-canonical-water-reader.js'),realRequire=require('node:module').createRequire(file);
async function run(mode){
 let proofCalls=0,poolCalls=0;
 const good={grade:'A',status:'ready',formal_entry_allowed:true,formal_entry_speed_verdict:'YES',scanner_can_run_opening:true,formal_source_alignment_ok:true,priority_fresh_quote_coverage_120s:1,quote_age_seconds:1,websocket_formal_ready:true,websocket_connected:true,websocket_authenticated:true,websocket_rest_disabled:true,websocket_streaming_channels:['trades','aggregates','candles'],failed_checks:[],trade_date:'2026-10-06',canonical_run_id:'fugle_daytrade_source:20261006:canonical'};
 const consumer={expectedFromSource(){return {trade_date:good.trade_date,canonical_run_id:good.canonical_run_id,mother_pool_run_id:'m',generation:'m',snapshot_sequence:1};},async readVerified(){proofCalls++;if(mode==='throw')throw Error('do not leak credentials');return {water_gate_pass:mode==='pass',membership_verified:mode==='pass',first_blocker:'EXPIRED'};}};
 const context={require(name){if(name==='fs')return {...fs,statSync:()=>({size:2}),readFileSync:()=>Buffer.from('{}')};if(name==='./mother-shared-water-consumer.cjs')return consumer;return realRequire(name);},module:{exports:{}},__dirname:path.dirname(file),process:{...process,env:{...process.env,FUMAN_STRATEGY3_SHARED_WATER:'1'}},console,URL,URLSearchParams,AbortSignal,setTimeout,fetch,Buffer,good,
 async mockRows(key,target){return target==='source_status'?[{source_name:'fugle_daytrade_source',status:'ok',payload:{}}]:[{}];},async mockPool(){poolCalls++;throw Error('TEST_REACHED_POOL');}};
 vm.runInNewContext(fs.readFileSync(file,'utf8')+`\nanonKey=()=> 'offline'; summarizeGate=()=>good; readRows=mockRows; readAllRows=mockPool; module.exports.integrationRead=readCanonicalDaytradeWater;`,context);
 const result=await context.module.exports.integrationRead({tradeDate:good.trade_date,strategy3Consumer:true});
 assert.equal(proofCalls,1);assert.equal(result.ok,false);
 if(mode==='throw')assert(result.failedChecks.includes('canonical_water_shared_evidence_unavailable'));
 else if(mode==='reject')assert(result.failedChecks.includes('canonical_water_shared_evidence_rejected'));
 assert.equal(poolCalls,0,'no downstream pool scan on unavailable or rejected evidence');
 assert(!JSON.stringify(result).includes('do not leak credentials'));
}
(async()=>{await run('throw');await run('reject');console.log(JSON.stringify({ok:true,cases:2,mode:'actual_reader_opt_in_fail_closed',network_requests:0,deployed:false}));})().catch(e=>{console.error(e);process.exitCode=1;});
