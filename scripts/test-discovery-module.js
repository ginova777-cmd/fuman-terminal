'use strict';
const assert=require('node:assert/strict'),{collect}=require('../lib/mother-pool-discovery-producer'),{verify}=require('../lib/verify-mother-pool-discovery'),{hash}=require('../lib/mother-pool-module-write-set');
const fixture=require('./test-discovery-source'),{date,asOf}=fixture;
const source=structuredClone(fixture.row);source.changePercent=3;source.source_evidence.quote.price=103;
const identity={trade_date:date,canonical_run_id:'fugle_daytrade_source:20260918:canonical',writer_run_id:'w2',generation_id:'g2',mother_pool_run_id:'s2',snapshot_generation:'s2',snapshot_sequence:2};
const previous={...identity,module_id:'B02',writer_run_id:'w1',plan:{created_at:date+'T09:59:00+08:00',rows:[{symbol:'2330',volume_evidence:{...source.source_evidence.quote.payload.turnoverVolumeEvidence,value:200000,event_at:date+'T09:59:00+08:00'}}]}};
previous.plan_hash=hash(previous.plan);previous.ack={...Object.fromEntries(require('../lib/mother-pool-module-write-set').identityFields.map(k=>[k,previous[k]])),module_id:'B02',committed:true,plan_hash:previous.plan_hash,written_symbols:['2330']};
const candles=Array.from({length:20},(_,i)=>({symbol:'2330',tradeDate:date,market:'TSE',source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',synthetic:false,volumeStrategyUsable:true,candleTime:new Date(Date.parse(asOf)-(20-i)*60000).toISOString(),candleSeenAt:new Date(Date.parse(asOf)-(19-i)*60000).toISOString(),open:80+i,high:82+i,low:79+i,close:81+i,volume:100+i}));
const input={identity,symbols:['2330'],sources:[source],candles,previous,asOf},plan=collect(input),artifact={...identity,observed_at:asOf,writer_write_set:{plan}};
assert.equal(plan.rows[0].status,'READY');assert.equal(plan.rows[0].discovery_flags.bullish_gain_volume,true);assert.equal(verify(plan.rows,artifact),true);
for(const mutate of [rows=>{rows[0].ma20++;},rows=>{rows[0].volume_rank=2;},rows=>{rows[0].discovery_flags.bullish_gain_volume=false;},rows=>{rows[0].natural_bars[0].is_synthetic=true;}]){const bad=structuredClone(plan.rows);mutate(bad);assert.equal(verify(bad,artifact),false);}
assert.equal(collect({...input,previous:null}).rows[0].status,'DATA_GAP');assert.equal(collect({...input,candles:candles.slice(1)}).rows[0].status,'DATA_GAP');
assert.equal(collect({...input,symbols:['2330','1101']}).rows[1].status,'DATA_GAP');
console.log(JSON.stringify({status:'passed',checks:9,scope:'isolated',production_complete:false}));
module.exports={input};
