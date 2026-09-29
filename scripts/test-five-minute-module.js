'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {collect}=require('../lib/mother-pool-five-minute-producer');
const {verify}=require('../lib/verify-mother-pool-five-minute');
const {calculate}=require('./daytrade-intraday-5m-v4');
function fixture(identity,minute=45){
 const date=identity.trade_date,asOf=date+`T10:${minute}:01+08:00`,run='five-minute:'+identity.writer_run_id;
 const snapshot={...require('./fixtures/minute-side-r4-plan.json').rounds[0].snapshot,...identity,generation:identity.snapshot_generation};
 const raw=snapshot.symbols.flatMap(symbol=>Array.from({length:21},(_,i)=>{const start=Date.parse(date+'T09:00:00+08:00')+i*300000,close=100+Math.sin(i/2)*5+i/10;return {symbol,trade_date:date,run_id:run,bar_start:new Date(start).toISOString(),bar_end:new Date(start+300000).toISOString(),candle_time:new Date(start).toISOString(),open:close,high:close+1,low:close-1,close,volume:100,volume_unit:'lots',volume_available:true,bar_count:5,bar_kind:'regular_session',bar_complete:true,confirmation_eligible:true,source:'fugle_stock_intraday_candles_timeframe_5',is_synthetic:false};}));
 const history=calculate(raw,run,asOf);
 const receipt={contract:'daytrade_intraday_5m_runner_verifier_receipt_v4',strategy_version:'golden-cross-any-macd-3-9-3-v4',calculation_version:'five-minute-indicators-macd-3-9-3-v4',classification_contract:'daytrade_intraday_5m_branch_independent_strict_wait_v1',run_id:run,trade_date:date,verified_at:asOf,status:'complete',complete:true,exit_code:0,first_blocker:null,failed_checks:[],anon_http_status:200,ssl_ok:true,requested_symbols:snapshot.symbols,history_readback_rows:history.length,diagnostic_summary:{mother_pool_snapshot:require('../lib/daytrade-mother-pool-snapshot').snapshotIdentity(snapshot)}};
 return {identity,snapshot,receipt,history,asOf};
}
const identity={trade_date:'2026-09-18',canonical_run_id:'fugle_daytrade_source:20260918:canonical',writer_run_id:'b15:1',generation_id:'g1',mother_pool_run_id:'s1',snapshot_generation:'s1',snapshot_sequence:1};
const f=fixture(identity),plan=collect(f),r={...identity,observed_at:f.asOf,writer_write_set:{plan}};let checks=0;
for(const row of plan.rows){assert.equal(row.status,'READY');assert(verify(row,r));checks++;}
for(const mutate of [row=>delete row.source_history[0].calculated_at,row=>row.source_history[0].calculated_at='2026-09-18T14:00:00+08:00',row=>row.source_history[0].calculated_at='2026-09-18T08:00:00+08:00',row=>row.kd.k+=1,row=>row.rsi.rsi3+=1,row=>row.macd.dif+=1,row=>row.bonus_eligible=!row.bonus_eligible,row=>row.formal_candidate_allowed=true,row=>row.five_minute_run_id='old',row=>row.source_history[0].is_synthetic=true,row=>row.source_history[0].volume_unit='unknown',row=>row.source_history[0].trade_date='2026-09-17',row=>row.source_history[0].source='one_minute_aggregate',row=>row.source_history.push(row.source_history[0]),row=>row.source_history.at(-1).bar_end='2026-09-18T13:00:00+08:00']){const row=structuredClone(plan.rows[0]);mutate(row);assert(!verify(row,r));checks++;}
const missing=collect({...f,receipt:null,history:[]});assert(missing.rows.every(r=>r.status==='DATA_GAP'&&!r.bonus_eligible));checks++;
(async()=>{
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'b15-source-'));let reads=0;
 const get=async(view,q)=>{assert(q.includes('verified_at=lte.'));return [f.receipt];},paged=async(view,q)=>{assert(q.includes('run_id=eq.'));reads++;return f.history;};
 const read=require('../lib/mother-pool-five-minute-source').read;
 await read({...f,runtime,get,paged});await read({...f,runtime,get,paged});assert.equal(reads,1);checks++;
 await assert.rejects(()=>read({...f,runtime:fs.mkdtempSync(path.join(os.tmpdir(),'b15-bad-')),get,paged:async()=>f.history.slice(1)}),/FIXED_HISTORY_SET_MISMATCH/);checks++;
 console.log(JSON.stringify({status:'passed',checks,scope:'isolated_B15_producer_independent_math_and_cache',production_complete:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={fixture};
