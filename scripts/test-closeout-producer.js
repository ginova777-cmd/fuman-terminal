'use strict';
const assert=require('node:assert/strict');
const {buildCloseout}=require('../lib/mother-pool-closeout-producer');
const date='2026-09-18',canonical='fugle_daytrade_source:20260918:canonical';
const rounds=[1,2].map(i=>({module_id:'B01',trade_date:date,canonical_run_id:canonical,writer_run_id:'w'+i,generation_id:'g'+i,mother_pool_run_id:'s'+i,snapshot_generation:'s'+i,snapshot_sequence:i,observed_at:`2026-09-18T13:2${i}:10+08:00`,natural_evidence:true,replay:false,synthetic:false,look_ahead:false,requested_symbols:['1101'],db_readback:{pages:[{rows:[{symbol:'1101',event_time:`2026-09-18T13:2${i}:00+08:00`}]}]}}));
// Adapter contract test only. The integration adapter must execute the real verifier.
const adapter={verifyRounds:async rows=>({module_id:'B01',verified_by:'verify-daytrade-module-receipt.js',rounds_verified:rows,complete:true,exit_code:0,first_blocker:null,failed_checks:[]})};
const input={identity:{trade_date:date,canonical_run_id:canonical},rounds,closeoutAt:'2026-09-18T13:30:01+08:00'};
(async()=>{
 const plan=await buildCloseout(input,adapter);assert.equal(plan.rows.length,1);assert.equal(plan.special_evidence.last_event_at,'2026-09-18T05:22:00.000Z');assert.equal(plan.special_evidence.natural_rounds.length,2);
 await assert.rejects(()=>buildCloseout({...input,closeoutAt:'2026-09-18T13:29:59+08:00'},adapter),/NOT_DUE/);
 await assert.rejects(()=>buildCloseout({...input,rounds:[rounds[0],rounds[0]]},adapter),/NOT_DISTINCT/);
 await assert.rejects(()=>buildCloseout(input,{verifyRounds:async()=>({complete:false})}),/NOT_VERIFIED/);
 await assert.rejects(()=>buildCloseout(input,{verifyRounds:async rows=>({...await adapter.verifyRounds(rows),rounds_verified:[]})}),/INPUT_MISMATCH/);
 const wrong=structuredClone(rounds);wrong[1].canonical_run_id='other';await assert.rejects(()=>buildCloseout({...input,rounds:wrong},adapter),/IDENTITY/);
 const future=structuredClone(rounds);future[1].db_readback.pages[0].rows[0].event_time='2026-09-18T13:31:00+08:00';await assert.rejects(()=>buildCloseout({...input,rounds:future},adapter),/EVENT_TIME/);
 console.log(JSON.stringify({status:'passed',scope:'isolated_adapter_contract',checks:7,production_complete:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
