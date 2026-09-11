"use strict";
// Pure fixtures only: no outbox, runtime receipt, Supabase or Telegram writes.
const test=require('node:test'),assert=require('node:assert/strict');
const {validEvent,validSideVolumeEvent}=require('./notify-daytrade-intraday-burst-telegram');
const {inspectSnapshot,snapshotIdentity,fiveMinuteAligned}=require('../lib/daytrade-mother-pool-snapshot');
const date='2026-09-11',now=Date.parse('2026-09-11T03:00:30Z'),run='fugle_daytrade_source:20260911:canonical';
function snapshot(){return {contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',trade_date:date,canonical_run_id:run,mother_pool_run_id:run+':snapshot:1',snapshot_sequence:1,snapshot_type:'complete',effective_at:'2026-09-11T01:00:00Z',complete:true,status:'complete',exit_code:0,symbol_count:1,symbols:['2330'],symbol_membership:[{symbol:'2330',mother_pool_run_id:run+':snapshot:1',mother_pool_snapshot_sequence:1,membership_status:'ACTIVE',membership_effective_at:'2026-09-11T01:00:00Z'}]};}
function event(type='volume_burst_rolling60_x2'){return {trade_date:date,canonical_run_id:run,symbol:'2330',price:101,trigger_type:type,canonical_water_mother_pool_member:true,canonical_water_quote_fresh:true,canonical_water_intraday_1m_ready:true,mother_pool_member:true,membership_status:'ACTIVE',mother_pool_removed:false,tradable_mother_pool:true,quote_fresh:true,quote_age_seconds:30,rolling_1m_baseline_status:'ready',rolling_1m_baseline_sample_count:60,technical_indicator_status:'ready',technical_golden_cross_any:true,technical_golden_cross_signals:['kd_5_3_3'],five_minute_requested:true,five_minute_readback_found:true,five_minute_snapshot_aligned:true,five_minute_confirmation_status:'CONFIRMED_STRONG_5M',five_minute_confirmation_signals:['kd_5_3_golden_cross_5m'],latest_1m_close:101,rolling_1m_prior_high_close:100,latest_1m_volume:200,rolling_1m_baseline_volume:100,latest_1m_time:'2026-09-11T03:00:00Z'};}
test('ACTIVE snapshot identity validates',()=>assert.equal(inspectSnapshot(snapshot(),date).ok,true));
test('missing membership cannot default ACTIVE',()=>{const s=snapshot();s.symbol_membership=[];assert.equal(inspectSnapshot(s,date).ok,false)});
test('old snapshot day rejected',()=>assert.equal(inspectSnapshot(snapshot(),'2026-09-14').ok,false));
test('5m alignment requires exact snapshot identity, not only same symbol',()=>{const s=snapshot(),r={trade_date:date,verified_at:'2026-09-11T02:00:00Z',diagnostic_summary:{mother_pool_snapshot:snapshotIdentity(s)}};assert.equal(fiveMinuteAligned(r,s),true);r.diagnostic_summary.mother_pool_snapshot.snapshot_sequence=2;assert.equal(fiveMinuteAligned(r,s),false)});
test('5m missing snapshot identity rejected',()=>assert.equal(fiveMinuteAligned({trade_date:date},snapshot()),false));
test('volume exact two times passes',()=>assert.deepEqual(validEvent(event(),date,now),[]));
test('price exact one percent passes',()=>assert.deepEqual(validEvent(event('price_breakout_1pct'),date,now),[]));
test('replayed candidate cannot notify',()=>assert.ok(validEvent({...event(),replayed_missed_candle:true},date,now).includes('non_formal_event_forbidden')));
test('missing numeric field cannot satisfy threshold',()=>assert.ok(validEvent({...event(),rolling_1m_baseline_volume:null},date,now).includes('event_numeric_fields_missing_or_invalid')));
test('61 valid candle rolling60 formula',()=>{const bars=Array.from({length:61},(_,i)=>({close:i===60?101:100,volume:i===60?200:100}));const prior=bars.slice(0,60);assert.equal(prior.reduce((s,r)=>s+r.volume,0)/60,100);assert.equal(Math.max(...prior.map(r=>r.close)),100);assert.equal(bars.at(-1).volume,2*100)});
for(const [name,change,reason] of [
 ['under volume',{latest_1m_volume:199},'volume_rule_not_met'],
 ['under price',{trigger_type:'price_breakout_1pct',latest_1m_close:100.99},'price_rule_not_met'],
 ['warmup',{membership_status:'PENDING_DOWNSTREAM_WARMUP'},'PENDING_DOWNSTREAM_WARMUP'],
 ['removed',{mother_pool_removed:true},'mother_pool_snapshot_symbol_removed'],
 ['5m wrong batch',{five_minute_snapshot_aligned:false},'five_minute_batch_not_aligned_with_mother_pool_snapshot'],
 ['5m missing row',{five_minute_readback_found:false},'five_minute_readback_missing'],
 ['short baseline',{rolling_1m_baseline_sample_count:59},'rolling_1m_samples_below_60'],
 ['no cross',{technical_golden_cross_any:false,technical_golden_cross_signals:[]},'technical_golden_cross_not_met'],
 ['stale quote',{quote_age_seconds:121},'quote_not_fresh'],
 ['stale event',{latest_1m_time:'2026-09-11T02:00:00Z'},'event_too_old'],
 ['invalid candle evidence',{canonical_water_intraday_1m_ready:false},'canonical_water_intraday_1m_not_ready']
])test(name+' rejected',()=>assert.ok(validEvent({...event(),...change},date,now).includes(reason)));
test('outside strength does not require technical or 1m/5m signals',()=>{const e={...event(),notification_type:'外盤強勢',trigger_type:'outside_volume_gt_inside_x2',side_volume_unit:'lots',inside_volume:1000,outside_volume:2000,side_volume_total:3000,event_time:'2026-09-11T03:00:00Z',technical_golden_cross_any:false,canonical_water_intraday_1m_ready:false,five_minute_confirmation_status:'DATA_GAP_5M'};assert.deepEqual(validSideVolumeEvent(e,date,now),[]);e.membership_status='PENDING_DOWNSTREAM_WARMUP';assert.ok(validSideVolumeEvent(e,date,now).includes('mother_pool_membership_not_active'))});
