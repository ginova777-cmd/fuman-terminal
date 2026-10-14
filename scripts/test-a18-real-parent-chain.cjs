'use strict';
// Reuse existing A16 fixture construction and real business verifiers. All data
// and simulated DB acknowledgements are TEST_ONLY, never natural acceptance.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),lab=path.join(root,'ops','labs','a18-parent-'+Date.now());fs.mkdirSync(lab,{recursive:true});
const oldTemp=process.env.TEMP,oldTmp=process.env.TMP,oldRuntime=process.env.FUMAN_RUNTIME_DIR;
process.env.TEMP=lab;process.env.TMP=lab;
const fixtureFile=path.join(__dirname,'test-mother-pool-a16-module.js');
const fixture=vm.runInThisContext('(function(require){'+fs.readFileSync(fixtureFile,'utf8')+'\nreturn {runtime,identity,fullPlan};})',{filename:fixtureFile})(createRequire(fixtureFile));
process.env.FUMAN_RUNTIME_DIR=fixture.runtime;
const identity=fixture.identity,date=identity.trade_date,asOf=date+'T00:59:30Z',symbols=['2330'];
const registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
const {persistModuleRound}=require('../lib/persist-mother-pool-module-round');
const {createVerifier}=require('../lib/verify-mother-pool-module-round');
const quality=require('../lib/mother-pool-preopen-quality');
const results=[];
async function round(input){
 const ws=await persistModuleRound(input,{savePlan:async()=>{},saveEvidence:async()=>{},persist:async body=>{
  const doc=JSON.parse(body.p_document);return {...identity,module_id:input.module_id,committed:true,committed_at:asOf,plan_hash:doc.plan_hash,written_symbols:input.requested_symbols};
 }});
 const rows=input.rows.map(r=>({...identity,...structuredClone(r)}));
 const surface=()=>({query_identity:identity,missing:[],extra:[],pages:[{query_identity:identity,http_status:200,page_index:0,page_size:500,offset:0,content_range:'0-0/1',rows:structuredClone(rows)}]});
 const r={...identity,module_id:input.module_id,contract:registry.modules[input.module_id],run_id:'TEST_ONLY-'+input.module_id,observed_at:input.created_at,captured_at:asOf,status:'verified',source_contract_ok:true,db_readback_ok:true,anon_readback_ok:true,failed_checks:[],natural_evidence:true,synthetic:false,replay:false,look_ahead:false,requested:1,written:1,readback:1,unique_symbols:1,writer_write_set:ws,db_readback:surface(),anon_readback:surface()};
 assert.equal(createVerifier(input.module_id).validRound(r),true,input.module_id+' real business verifier');
 fs.writeFileSync(path.join(lab,input.module_id+'.json'),JSON.stringify(r,null,2));return r;
}
(async()=>{
 const checks=[];for(let i=1;i<=20;i++){const d=new Date(Date.parse(date)-i*86400000);checks.push({date:d.toISOString().slice(0,10),source:'cache',isTradingDay:![0,6].includes(d.getUTCDay())});}
 const dailyVolumeMap=new Map([['2330',{daily_ohlcv_read_at:date+'T06:00:00+08:00',daily_volume_evidence:{symbol:'2330',trade_date:date,source:'strategy4_daily_ohlcv_view',calendar:{trade_date:date,status:'SESSION_DATES_VERIFIED',checks},rows:[{symbol:'2330',trade_date:'2026-09-28',open:100,high:110,low:90,close:105,volume_lots:1000}]}}]]);
 const p15=require('../lib/mother-pool-previous-ohlc').collect({identity,symbols,dailyVolumeMap,asOf,lockDirectory:path.join(lab,'a15-lock')});
 const raw=['08:45','08:50','08:55','08:59'].map((slot,i)=>({symbol:'2330',trade_date:date,observed_at:date+'T'+slot+':00+08:00',trial_price:100+i,is_trial:true,payload:{trial_event_at:date+'T'+slot+':00+08:00',source:'fugle_daytrade_source_writer:preopen_websocket',writer_contract:'preopen_snapshot_history_v2',trial_event_time_source:'provider_trial_event'}}));
 const p17=require('../lib/mother-pool-trial-trajectory').collect({identity,symbols,asOf,history:{rows:raw,readback:{status:'READ',source:'fugle_preopen_snapshot_history',trade_date:date,observed_at:asOf}}});
 const parents={};for(const input of [p15,fixture.fullPlan,p17]){const r=await round(input);parents[input.module_id]=r.writer_write_set;results.push({case:input.module_id+'_BUSINESS_ROUND',pass:true});}
 const input=quality.collect({identity,symbols,parents,asOf});assert.equal(input.rows[0].status,'READY');await round(input);results.push({case:'A18_COMPLETE_REAL_PARENT_CHAIN',pass:true});
 for(const id of ['A15','A16','A17'])for(const fault of ['missing','generation','ack','hash']){
  const changed=structuredClone(parents);
  if(fault==='missing')delete changed[id];if(fault==='generation')changed[id].generation_id='wrong';if(fault==='ack')changed[id].ack.committed=false;if(fault==='hash')changed[id].plan_hash='0'.repeat(64);
  assert.equal(quality.collect({identity,symbols,parents:changed,asOf}).rows[0].status,'DATA_GAP');results.push({case:id+'_'+fault,pass:true});
 }
 fs.writeFileSync(path.join(lab,'receipt.json'),JSON.stringify({status:'A18_REAL_PARENT_CHAIN_ISOLATED_PASS',candidate_scope:'working tree',fixture_only:true,natural_acceptance:false,formal_execution:false,writer_process_e2e:false,results},null,2));
 console.log(JSON.stringify({status:'A18_REAL_PARENT_CHAIN_ISOLATED_PASS',checks:results.length,lab}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
 for(const [k,v] of [['TEMP',oldTemp],['TMP',oldTmp],['FUMAN_RUNTIME_DIR',oldRuntime]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
