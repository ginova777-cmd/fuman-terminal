'use strict';
const assert=require('node:assert/strict'),{collect}=require('../lib/mother-pool-combination-producer'),{verify,combinations}=require('../lib/verify-mother-pool-combinations');
const {hash}=require('../lib/mother-pool-module-write-set'),registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
function fixture(overrides={},second=1){
 const date='2026-09-18',asOf=date+'T09:32:0'+second+'+08:00',symbol='1101';
 const identity={trade_date:date,canonical_run_id:'fugle_daytrade_source:20260918:canonical',writer_run_id:'b24-test',generation_id:'g',mother_pool_run_id:'s',snapshot_generation:'s',snapshot_sequence:1,...overrides};
 const bars=Array.from({length:32},(_,i)=>{const t=Date.parse(date+'T09:00:00+08:00')+i*60000,c=100+(i%2);return {stock_id:symbol,trade_date:date,timestamp:new Date(t).toISOString(),open:c,high:c+1,low:c-1,close:c,volume_raw:i===31?400:100,volume_raw_unit:'LOTS',complete:true,is_synthetic:false,available_at:new Date(t+60000).toISOString(),source:'Fugle.websocket.candles.TSE_OTC'};});
 const detectorInput={stock_id:symbol,trade_date:date,current:bars,history:[],as_of:asOf};
 const volume=require('../lib/telegram-detectors/volume-detector.cjs').detect(detectorInput).rows.at(-1),price=require('../lib/telegram-detectors/price-detector.cjs').detect(detectorInput).rows.at(-1);
 const plans=require('../lib/mother-pool-anomaly-module-producer').collect({identity,symbols:[symbol],asOf,evidence:{...identity,details:[{symbol,current:bars,history:[],volume,price,failed_checks:[]}]}});
 const raw=bars.map(b=>({symbol,tradeDate:date,market:'TSE',source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',synthetic:false,volumeStrategyUsable:true,candleTime:b.timestamp,candleSeenAt:b.available_at,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume_raw}));
 plans.push(...require('../lib/mother-pool-candle-module-producer').collect({identity,symbols:[symbol],candles:raw,asOf}).filter(p=>['B22','B23'].includes(p.module_id)));
 const ve={value:100,unit:'lots',source:'fugle.websocket.aggregates.total.tradeVolume',event_at:date+'T09:32:00+08:00',is_synthetic:false},ae={value:10000000,unit:'TWD',source:'fugle.websocket.aggregates.total.tradeValue',event_at:ve.event_at,is_synthetic:false,calculation:'provider_reported_cumulative'};
 const volumeValue=require('../lib/daytrade-volume-value-ranking').buildRanking([{symbol,volume:ve,amount:ae}],{tradeDate:date,canonicalRunId:identity.canonical_run_id,now:asOf});
 plans.push(require('../lib/mother-pool-liquidity-module-producer').collect({identity,symbols:[symbol],volumeValue,turnover:{...identity,rows:[]},asOf}).find(p=>p.module_id==='B21'));
 const parents={};for(const p of plans){const plan={created_at:asOf,requested_symbols:[symbol],rows:p.rows,data_gap_symbols:[],source_evidence:p.source_evidence};const plan_hash=hash(plan);parents[p.module_id]={...identity,contract:'mother_pool_module_write_set_v1',module_id:p.module_id,module_contract:registry.modules[p.module_id],plan,plan_hash,ack:{...identity,module_id:p.module_id,plan_hash,committed:true,committed_at:asOf,written_symbols:[symbol]}};}
 const source={...identity,symbol,source_hash:'isolated-source-hash',source_contract:'mother_pool_native_minute_side_source_v1',minute_start:date+'T09:31:00+08:00',side_volume_timestamp:date+'T09:31:59+08:00',is_synthetic:false,inside_1m:100,outside_1m:200,unknown_1m:0,total_1m:300,volume_unit:'LOTS',aggregation:'ONE_MINUTE',baseline_method:'ROLLING_20M_MEDIAN',outside_baseline_sample_count:20,inside_baseline_sample_count:20,outside_baseline_value:1,inside_baseline_value:1,raw_outside_ratio:2,outside_strength:2,raw_inside_ratio:0.5,inside_strength:0.5,outside_dynamic_ratio:2,inside_dynamic_ratio:0.5,outside_side_state:'RATIO_VALID',inside_side_state:'RATIO_VALID'};
 const side={...identity,contract:'minute_side_write_plan_v1',status:'written',observed_at:asOf,requested_symbols:[symbol],written_symbols:[symbol],round_written_symbols:[symbol],data_gap_symbols:[],source_rows:[source],round_rows:[{symbol,minute_start:source.minute_start,source_hash:source.source_hash,first_blocker:null}]};
 return {identity,symbols:[symbol],parents,side,asOf};
}
if(require.main===module){
 const input=fixture(),plan=collect(input),r={...input.identity,observed_at:input.asOf,writer_write_set:{plan}};
 assert.equal(plan.rows[0].status,'READY',JSON.stringify(plan.rows[0].data_gaps));assert(verify(plan.rows,r));let checks=2;
 for(const change of [x=>x.events.pop(),x=>x.events[0].event_timestamp='2026-09-17T09:32:00+08:00',x=>x.events[0].type='FORGED',x=>x.combinations.pop(),x=>x.combinations[0].event_sequence[1].time_difference_seconds=999,x=>x.combinations[0].formal_candidate_allowed=true,x=>x.event_count++,x=>x.data_gaps.push({reason:'gap'})]){const rows=structuredClone(plan.rows);change(rows[0]);assert(!verify(rows,r));checks++;}
 assert.deepEqual(combinations([{...plan.rows[0].events[0]}]),[]);checks++;
 console.log(JSON.stringify({status:'passed',checks,scope:'isolated_B24_independent_event_and_combination_recalculation',production_complete:false}));
}
module.exports={fixture};
