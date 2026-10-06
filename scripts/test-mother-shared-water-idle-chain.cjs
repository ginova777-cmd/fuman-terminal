'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createCapture}=require('../lib/mother-shared-water-capture.cjs'),{freeze}=require('../lib/mother-shared-water-freeze.cjs'),{createVerifier}=require('../lib/mother-shared-water-evidence.cjs');
const {evaluate}=require('../lib/strategy3-shared-water-adapter.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const at=s=>'2026-10-06T04:59:'+s+'Z',trade='2026-10-06T04:55:00Z';
async function run(mode){
 const longIdle=mode.startsWith('long-idle');
 const seed=s=>longIdle?'2026-10-06T04:55:'+s+'Z':at(s);
 const c=createCapture({connectionId:'c'});for(const channel of ['trades','aggregates'])c.request(channel,'1216');
 c.observe({event:'authenticated'},seed('49'));c.observe({event:'subscribed',data:[{channel:'trades',symbol:'1216',id:'t'},{channel:'aggregates',symbol:'1216',id:'a'}]},seed('50'));
 c.observe({event:'data',channel:'aggregates',id:'a',data:{symbol:'1216',date:'2026-10-06',lastUpdated:Date.parse(seed('54'))*1000,lastTrade:{time:Date.parse(trade)*1000,price:70}}},seed('55'));
 if(longIdle&&mode!=='long-idle-gap'&&mode!=='long-idle-stale-heartbeat')for(let t=Date.parse(seed('55'))+30000;t<Date.parse(at('57.500'));t+=30000)c.observe({event:'heartbeat',data:{time:'native-heartbeat'}},new Date(t).toISOString());
 const identity={trade_date:'2026-10-06',canonical_run_id:'canonical',mother_pool_run_id:'mother',writer_run_id:'writer',generation:'generation',snapshot_sequence:1,producer_version:'fixture',verification_run_id:'idle-fixture'};let clocks=0;
 const bundle=await freeze({identity,prioritySymbols:['1216'],snapshotBytes:Buffer.from(JSON.stringify({...identity,symbols:['1216']})),writeCompletedAt:at('56'),now:()=>Date.parse(at(clocks++===0?'56':clocks===2?'57':'58')),readback:async()=>({reader_role:'anon',complete:true,bytes:Buffer.from(JSON.stringify([{symbol:'1216',trade_date:identity.trade_date,price:70,last_trade_time:trade}]))}),readCapture:async options=>{
  if(options?.after&&mode!=='no-heartbeat')c.observe({event:'heartbeat',data:{time:'native-heartbeat'}},mode==='long-idle-stale-heartbeat'?seed('57.500'):at('57.500'));
  const s={...c.snapshot(options?.after?at('58'):at('56')),stored:true};
  if(options?.after&&mode==='new-trade'){c.observe({event:'data',channel:'trades',id:'t',data:{symbol:'1216',time:Date.parse(at('57'))*1000,serial:99,price:71}},at('57.800'));return {...c.snapshot(at('58')),stored:true};}
  if(options?.after&&['bad-ack','bad-chain','bad-time','missing-event'].includes(mode)){
   const item=s.native_windows[0],w=JSON.parse(item.raw_utf8);
   if(mode==='bad-ack')w.trade_ack.raw.data.id='';
   if(mode==='bad-chain')w.events[0].previous_sha256='x';
   if(mode==='bad-time')w.observed_until=at('56');
   if(mode==='missing-event')w.event_count++;
   item.raw_utf8=JSON.stringify(w);item.raw_sha256=sha(item.raw_utf8);
  }
  return s;
 }});
 const proof=createVerifier({resolve:r=>bundle.blobs.get(r),nowMs:()=>Date.parse(at('58'))});
 const result=evaluate(bundle.receipt,{nowMs:Date.parse(at('58')),expected:{...identity,contract_version:'1.1.0',scope_definition_version:'full-priority-fixed-membership-v1',requested_symbols:['1216']},verifyEvidence:proof});
 const shouldPass=mode==='normal'||mode==='long-idle';
 assert.equal(result.water_gate_pass,shouldPass,JSON.stringify(bundle.receipt.rows));
 if(shouldPass){assert.equal(bundle.receipt.no_new_trade_count,1);assert.equal(proof(bundle.receipt.rows[0],bundle.receipt).no_new_trade_verified,true);assert.equal(result.formal_entry_authorization,false);}
 if(mode==='long-idle'){
  const row=bundle.receipt.rows[0],native=JSON.parse(bundle.blobs.get(row.raw_evidence_ref));assert.equal(native.received_at,seed('55'));assert.equal(row.last_trade_at,new Date(trade).toISOString());
  const later=createVerifier({resolve:r=>bundle.blobs.get(r),nowMs:()=>Date.parse(at('58'))+31000});assert.equal(later(row,bundle.receipt).verified,false);
 }
}
(async()=>{for(const mode of ['normal','no-heartbeat','new-trade','bad-ack','bad-chain','bad-time','missing-event','long-idle','long-idle-stale-heartbeat','long-idle-gap'])await run(mode);console.log(JSON.stringify({ok:true,cases:10,mode:'native_capture_freeze_verifier_adapter_isolated',production_connected:false,natural_evidence:false}));})().catch(e=>{console.error(e);process.exitCode=1;});
