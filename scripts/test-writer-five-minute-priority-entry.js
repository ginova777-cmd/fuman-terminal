'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const text=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');
const start=text.indexOf('async function prioritizeIntradayFiveMinuteStrong(rows) {'),end=text.indexOf('\nfunction ensureDailyStockMasterComplete',start);assert(start>=0&&end>start);
const identity={trade_date:'2026-09-18',canonical_run_id:'fugle_daytrade_source:20260918:canonical',mother_pool_run_id:'s1',snapshot_generation:'s1',snapshot_sequence:1,writer_run_id:'test:1',generation_id:'g1'};
async function run(change){
 const f=require('./test-five-minute-priority').fixture(identity),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'a10-consumer-'));
 if(change)change(f);
 const reads=[],pool=f.snapshot.symbols.map(symbol=>({symbol,formal_candidate:false,payload:{formal_pool_eligible:false}}));pool.extra='preserved';
 class Clock extends Date{static now(){return Date.parse(f.asOf);}}
 const context={Date:Clock,taipeiDate:()=>identity.trade_date,nowIso:()=>f.asOf,runtimePath:()=>runtime,console,
  supabaseGet:async(view,q)=>{reads.push(view);assert.equal(view,'v_fugle_intraday_5m_verification_readback');assert(q.includes('verified_at=lte.'));return[f.receipt];},
  supabaseGetPaged:async(view,q)=>{reads.push(view);assert.equal(view,'v_fugle_intraday_5m_history_readback');assert(q.includes('run_id=eq.'));return f.history;},
  require:name=>name==='../lib/daytrade-mother-pool-snapshot'?{readMotherPoolSnapshot:()=>require(name).inspectSnapshot(f.snapshot,identity.trade_date)}:require(name)};
 const fn=vm.runInNewContext('('+text.slice(start,end).trim()+')',context);
 const out=await fn(pool);assert.equal(pool[0].symbol,'2330');assert.equal(out.extra,'preserved');assert(out.every(r=>r.formal_candidate===false&&r.payload.formal_pool_eligible===false));
 return {out,reads};
}
(async()=>{
 let checks=0;const good=await run();assert.deepEqual(good.out.map(x=>x.symbol),['2317','2330']);assert.equal(good.out.fiveMinutePriorityEvidence.a10_formula_verified,true);assert.equal(good.out.fiveMinutePriorityEvidence.source_history_rows,42);assert.deepEqual(good.reads,['v_fugle_intraday_5m_verification_readback','v_fugle_intraday_5m_history_readback']);checks++;
 for(const change of [f=>f.history.at(-1).rsi3_5m=1,f=>f.history.at(-1).is_synthetic=true,f=>f.receipt.diagnostic_summary.mother_pool_snapshot.mother_pool_run_id='other',f=>f.receipt.verified_at='2026-09-18T11:00:00+08:00']){
  const result=await run(change);assert.deepEqual(result.out.map(x=>x.symbol),['2330','2317']);assert.notEqual(result.out.fiveMinutePriorityEvidence.status,'evaluated');checks++;
 }
 console.log(JSON.stringify({checks,scope:'isolated_actual_Writer_priority_entry',production_complete:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
