'use strict';
const assert=require('node:assert/strict');
const producer=require('../lib/mother-pool-ma20-producer'),{verify}=require('../lib/verify-mother-pool-ma20');
function snapshot(identity,symbols,asOf){return {contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',...identity,generation:identity.snapshot_generation,status:'complete',complete:true,exit_code:0,first_blocker:null,snapshot_type:'test_isolated',effective_at:asOf,symbols,symbol_count:symbols.length,removed_symbols:[],symbol_membership:symbols.map(symbol=>({symbol,mother_pool_run_id:identity.mother_pool_run_id,mother_pool_snapshot_sequence:identity.snapshot_sequence,membership_status:'ACTIVE',membership_effective_at:asOf}))};}
const collect=f=>producer.collect({...f,snapshot:snapshot(f.identity,f.symbols,f.asOf)});
function fixture(){
 const date='2026-09-18',identity={trade_date:date,canonical_run_id:'fugle_daytrade_source:20260918:canonical',mother_pool_run_id:'s1',snapshot_generation:'s1',snapshot_sequence:1},symbols=['1101','2330'];
 const candles=symbols.flatMap(symbol=>Array.from({length:20},(_,i)=>({symbol,tradeDate:date,market:'TSE',source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',synthetic:false,volumeStrategyUsable:true,candleTime:`${date}T09:${String(i).padStart(2,'0')}:00+08:00`,candleSeenAt:`${date}T09:${String(i+1).padStart(2,'0')}:00+08:00`,open:100,high:130,low:99,close:100+i,volume:100})));
 return {identity,symbols,candles,asOf:date+'T09:20:01+08:00'};
}
function round(f,p){return {...f.identity,observed_at:f.asOf,writer_write_set:{plan:{requested_symbols:p.requested_symbols,source_evidence:p.source_evidence}}};}
if(require.main===module){let checks=0;const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
 test('20 natural completed bars and actual denominator',()=>{const f=fixture();for(const p of collect(f))assert(verify(p.module_id,p.rows,round(f,p)));assert.equal(collect(f)[0].rows[0].ma20,109.5);});
 for(const [name,mutate] of [['missing minute',f=>f.candles.splice(4,1)],['synthetic bar',f=>f.candles[4].synthetic=true],['future availability',f=>f.candles[4].candleSeenAt='2026-09-18T10:00:00+08:00'],['stale window',f=>f.asOf='2026-09-18T09:23:00+08:00']])test(name+' rejected',()=>{const f=fixture();mutate(f);const p=collect(f)[0];assert(!verify('A08',p.rows,round(f,p)));});
 test('duplicate minute rejected',()=>{const f=fixture();f.candles.push(f.candles[0]);assert.throws(()=>collect(f));});
 for(const [name,mutate] of [['wrong average',p=>p.rows[0].ma20=1],['look ahead',p=>p.rows[0].natural_bars[0].available_at='2026-09-18T10:00:00Z'],['other stock',p=>p.rows[0].natural_bars[0].stock_id='9999'],['bad price',p=>p.rows[0].natural_bars[0].high=1]])test(name+' independent rejection',()=>{const f=fixture(),p=collect(f)[0];mutate(p);assert(!verify('A08',p.rows,round(f,p)));});
 test('90 percent preserves missing stock in denominator',()=>{const f=fixture();f.symbols=Array.from({length:10},(_,i)=>String(1100+i));const base=f.candles.slice(0,20);f.candles=f.symbols.slice(0,9).flatMap(symbol=>base.map(b=>({...b,symbol})));const p=collect(f)[1];assert(verify('A09',p.rows,round(f,p)));assert.equal(p.rows[0].coverage_pct,90);assert.equal(p.rows[0].checked_count,10);assert.deepEqual(p.rows[0].not_ready_symbols,['1109']);p.rows.pop();assert(!verify('A09',p.rows,round(f,p)));});
 test('below 90 percent rejected',()=>{const f=fixture();f.symbols.push('9999');const p=collect(f)[1];assert(!verify('A09',p.rows,round(f,p)));});
 test('false denominator rejected',()=>{const f=fixture(),p=collect(f)[1];p.rows[0].checked_count=1;assert(!verify('A09',p.rows,round(f,p)));});
 test('producer cannot remove stock from snapshot denominator',()=>{const f=fixture();assert.throws(()=>producer.collect({...f,snapshot:snapshot(f.identity,[...f.symbols,'9999'],f.asOf)}),/SNAPSHOT_UNIVERSE/);});
 test('verifier rejects different snapshot generation',()=>{const f=fixture(),p=collect(f)[1];p.source_evidence.snapshot.generation='other';assert(!verify('A09',p.rows,round(f,p)));});
 console.log(JSON.stringify({checks,scope:'isolated_MA20',production_complete:false}));
}
module.exports={fixture,snapshot};
