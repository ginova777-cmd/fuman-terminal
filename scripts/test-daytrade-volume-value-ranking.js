'use strict';
const assert=require('node:assert/strict');
const {buildRanking}=require('../lib/daytrade-volume-value-ranking');
const {verify}=require('./verify-daytrade-volume-value-ranking');
const date='2026-09-17',now='2026-09-17T02:00:00Z';
const context={tradeDate:date,canonicalRunId:'fugle_daytrade_source:20260917:canonical',now};
const volume={value:2,unit:'lots',source:'fugle.websocket.aggregates.total.tradeVolume',is_synthetic:false,event_at:now};
const amount={value:200000,unit:'TWD',source:'fugle.websocket.aggregates.total.tradeValue',event_at:now,is_synthetic:false,calculation:'provider_reported_cumulative'};
const rows=[{symbol:'2330',volume,amount},{symbol:'2303',volume:{...volume,value:2000,unit:'shares'},amount},{symbol:'2317',volume:{...volume,unit:'unknown'},amount:{...amount,value:null}}];
const rank=buildRanking(rows,context),proof={read_role:'anon',db_readback_ok:true};
for(const missing of [null,[],false,'missing']){
 const isolated=buildRanking([{symbol:'2330',volume:missing,amount:missing},rows[0]&&{...rows[0],symbol:'2303'}],context);
 assert.equal(isolated.rows[0].volume.status,'DATA_GAP');assert.equal(isolated.rows[0].amount.status,'DATA_GAP');
 assert.equal(isolated.rows[1].volume.status,'ready');assert.equal(verify(isolated,isolated,proof).complete,true);
}
assert.deepEqual(rank.volume_ranking.map(r=>r.symbol),['2303','2330']);
assert.equal(rank.rows[2].volume.volume_shares,null);
assert.equal(verify(rank,rank,proof).complete,true);
assert.equal(verify(rank,rank).complete,false);
for(const corrupt of [r=>r.rows[0].volume.volume_shares=2,r=>r.volume_ranking.reverse(),r=>r.rows[0].amount.event_at='2026-09-16T02:00:00Z',r=>r.canonical_run_id='old',r=>r.publish_allowed=true]) {
  const r=structuredClone(rank);corrupt(r);assert.equal(verify(r,r,proof).complete,false);
}
const other=structuredClone(rank);other.run_id+='other';assert.equal(verify(other,rank,proof).complete,false);
for(const corrupt of [r=>delete r.run_id,r=>r.run_id='wrong',r=>r.scope='top40',r=>r.volume_unit='lots',r=>r.value_unit='USD',r=>r.rows[0].volume.volume_lots=2000,r=>r.rows[0].volume.reasons=['stale'],r=>r.rows[2].volume.volume_lots=0]) {
 const bad=structuredClone(rank);corrupt(bad);assert.equal(verify(bad,bad,proof).complete,false);
}
assert.throws(()=>buildRanking([...rows,rows[0]],context),/DUPLICATE/);
assert.throws(()=>buildRanking(rows,{...context,now:'2026-09-18T02:00:00Z'}),/IDENTITY/);
assert.throws(()=>buildRanking([null],context),/INPUT/);
for(const replacement of [null,[],{symbol:'bad'}]){
 const bad=structuredClone(rank);bad.rows[0]=replacement;assert.equal(verify(bad,bad,proof).complete,false);
}
const wrongDay=structuredClone(rank);wrongDay.calculated_at='2026-09-18T02:00:00Z';assert.ok(verify(wrongDay,wrongDay,proof).failed_checks.includes('CALCULATION_DATE_INVALID'));
const hidden=structuredClone(rank);hidden.rows[0].volume.status='DATA_GAP';hidden.rows[0].volume.reasons=['fake gap'];hidden.rows[0].volume.volume_shares=null;
assert.equal(verify(hidden,hidden,proof).complete,false);
const unknown=buildRanking([{symbol:'2330',volume:{...volume,source:'unproven'},amount}],context);
assert.equal(unknown.rows[0].volume.status,'DATA_GAP');
console.log('PASS B02 isolated ranking: shares/lots, ties, gaps, tampering, same-batch and anon evidence requirements');
