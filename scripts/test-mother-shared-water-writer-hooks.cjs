'use strict';
const assert=require('node:assert/strict');
const {createHooks}=require('../lib/mother-shared-water-writer-hooks.cjs');
const {freezeScope}=require('../lib/mother-shared-water-priority-scope.cjs');
const identity={trade_date:'2026-10-06',writer_run_id:'w'};
const priorityScope=freezeScope(['1216'],{tradeDate:identity.trade_date,writerRunId:'w',freshSymbols:[]});
const options={runtimeRoot:'fixture-only',writerIdentity:identity,priorityScope,priorityCount:1};
(async()=>{
 let called=0;const capture=async()=>({captured_at:'2026-10-06T01:00:00Z'}),run=async value=>{called++;assert.equal(value.writeCompletedAt,'2026-10-06T01:00:01Z');assert.equal(value.initialCapture.captured_at,'2026-10-06T01:00:00Z');return {water_gate_pass:false,status:'COMMITTED'};};
 let hooks=createHooks(options,{capture,run}),context=await hooks.beforeQuoteRead();
 let r=await hooks.afterQuoteWrite({context,trade_date:identity.trade_date,quotes_written:1,written_symbols:['1216'],write_completed_at:'2026-10-06T01:00:01Z'});assert.equal(called,1);assert.equal(r.status,'COMMITTED');
 hooks=createHooks(options,{capture:async()=>{throw Error('CAPTURE_FRESH_WAIT_TIMEOUT');},run});context=await hooks.beforeQuoteRead();r=await hooks.afterQuoteWrite({context});assert.equal(r.first_blocker,'SHARED_WATER_PRE_WRITE_CAPTURE_FAILED');assert.equal(called,1);
 hooks=createHooks(options,{capture,run});context=await hooks.beforeQuoteRead();r=await hooks.afterQuoteWrite({context,trade_date:identity.trade_date,quotes_written:0});assert.equal(r.error_code,'QUOTE_WRITE_NOT_ACKNOWLEDGED');assert.equal(called,1);
 r=await hooks.afterQuoteWrite({context,trade_date:'2026-10-05',quotes_written:1,written_symbols:['1216']});assert.equal(r.water_gate_pass,false);assert.equal(called,1);
 hooks=createHooks(options,{capture,run:async()=>{throw Error('ANON_READBACK_INVALID');}});context=await hooks.beforeQuoteRead();r=await hooks.afterQuoteWrite({context,trade_date:identity.trade_date,quotes_written:1,written_symbols:['1216']});assert.equal(r.error_code,'ANON_READBACK_INVALID');assert.equal(r.formal_entry_authorization,false);
 const {run:round}=require('../lib/mother-shared-water-writer-round.cjs');
 await assert.rejects(()=>round({producerVersion:'a'.repeat(40),writeCompletedAt:'2026-10-06T01:00:01Z'}),/PRE_WRITE_CAPTURE_REQUIRED/);
 await assert.rejects(()=>round({producerVersion:'a'.repeat(40),writeCompletedAt:'2026-10-06T01:00:01Z',initialCapture:{captured_at:'2026-10-06T01:00:02Z'}}),/PRE_WRITE_CAPTURE_REQUIRED/);
 let notified=false;
 hooks=createHooks({...options,onVerificationFailure:async e=>{assert.equal(e.message,'HTTP 503');notified=true;throw Error('STOP_CURRENT_ROUND');}},{capture,run:async()=>{throw Error('HTTP 503');}});
 context=await hooks.beforeQuoteRead();await assert.rejects(()=>hooks.afterQuoteWrite({context,trade_date:identity.trade_date,quotes_written:1,written_symbols:['1216']}),/STOP_CURRENT_ROUND/);assert.equal(notified,true);
 const url='https://fixture.invalid',ack={symbol:'1216',trade_date:identity.trade_date,writer_run_id:'w',target:url+'/rest/v1/fugle_daytrade_quotes_live'};
 let retainedCalls=0;
 hooks=createHooks({...options,url},{capture,run:async value=>{retainedCalls++;assert.equal(value.writeCompletedAt,null);assert.deepEqual(value.writtenSymbols,[]);assert.deepEqual(value.quoteAcknowledgements,[ack]);return {status:'COMMITTED'};}});
 context=await hooks.beforeQuoteRead();
 const retained={context,trade_date:identity.trade_date,quotes_written:0,written_symbols:[],write_completed_at:null,quote_acknowledgements:[ack]};
 r=await hooks.afterQuoteWrite(retained);assert.equal(r.status,'COMMITTED');assert.equal(retainedCalls,1);
 for(const invalid of [[{...ack,writer_run_id:'other'}],[{...ack,trade_date:'2026-10-05'}],[{...ack,target:'https://other.invalid'}],[ack,ack],[null],null]){
  r=await hooks.afterQuoteWrite({...retained,quote_acknowledgements:invalid});assert.equal(r.error_code,'QUOTE_ACK_SCOPE_INVALID');assert.equal(retainedCalls,1);
 }
 console.log(JSON.stringify({ok:true,cases:15,mode:'isolated_write_boundary',deployed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});

