'use strict';
const assert=require('node:assert/strict'),{readMinuteSide:read}=require('../lib/mother-pool-minute-side-source');
const event='2026-09-17T01:00:30Z',received='2026-09-17T01:00:31Z',micros=Date.parse(event)*1000;
const common={stock_id:'2330',trade_date:'2026-09-17',volume_unit:'LOTS',is_synthetic:false,received_at:received};
const input={symbol:'2330',tradeDate:'2026-09-17',canonicalRunId:'fugle_daytrade_source:20260917:canonical',asOf:'2026-09-17T01:01:00Z',
 trades:[{...common,contract:'fugle_native_trade_journal_v1',source:'Fugle.websocket.trades',trade:{time:micros,serial:1,size:10,volume:10}}],
 side:[{...common,is_trial:false,aggregation:'DAY_CUMULATIVE',provider_source:'Fugle.aggregates.total',event_at:event,
 event_time_microseconds:micros,identity:'fixture-boundary',total:{tradeVolume:10,tradeVolumeAtBid:2,tradeVolumeAtAsk:7}}]};
const r=read(input);assert.equal(r.rows.length,1);assert.equal(r.rows[0].outside_1m,7);assert.equal(r.rows[0].inside_1m,2);
assert.equal(read({...input,asOf:'2026-09-18T01:01:00Z'}).status,'DATA_GAP');
assert.equal(read({...input,symbol:2330}).status,'DATA_GAP');
assert.equal(r.rows[0].unknown_1m,1);assert.equal(r.complete,false);assert.equal(r.publish_allowed,false);
for(const mutate of [x=>x.trades[0].source='unknown',x=>x.trades[0].trade_date='2026-09-16',
 x=>x.side[0].is_trial=true,x=>x.trades[0].received_at='2026-09-17T01:02:00Z',
 x=>x.side[0].total.tradeVolume=11,x=>x.canonicalRunId='wrong']){
 const v=structuredClone(input);mutate(v);assert.equal(read(v).rows.length,0);
}
console.log('PASS Mother Pool native minute source: exact boundaries, unknown retained, provenance/date/trial/as-of/missing boundary rejected');
