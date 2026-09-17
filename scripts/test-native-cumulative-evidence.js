'use strict';
const assert = require('node:assert/strict');
const {nativeVolume} = require('../lib/daytrade-intraday-turnover');
const {nativeTradeValue} = require('../lib/daytrade-trade-value-evidence');
const {buildRanking} = require('../lib/daytrade-volume-value-ranking');
const {verify} = require('./verify-daytrade-volume-value-ranking');
const now = '2026-09-17T02:00:00.000Z';
const context = {tradeDate:'2026-09-17', canonicalRunId:'fugle_daytrade_source:20260917:canonical', now};
const input = {market:'TSE',total:{time:Date.parse(now)*1000,tradeVolume:2,tradeValue:200000}};
const map = data => ({symbol:'2330',volume:nativeVolume(data,'fugle.websocket.aggregates.total.tradeVolume'),amount:nativeTradeValue(data,'fugle.websocket.aggregates.total.tradeValue')});
const ready = buildRanking([map(input)],context);
assert.equal(ready.rows[0].volume.volume_shares,2000);
assert.equal(ready.rows[0].amount.trade_value_twd,200000);
for (const time of [true,false,null,{},[],1e308,-1,'', 'invalid']) {
  const result = buildRanking([map({...input,total:{...input.total,time}})],context);
  assert.equal(result.rows[0].volume.status,'DATA_GAP');
  assert.equal(result.rows[0].amount.status,'DATA_GAP');
  assert.equal(verify(result,result,{read_role:'anon',db_readback_ok:true}).complete,true);
}
for (const data of [null,undefined,false,[], 'invalid']) {
  const result = buildRanking([map(data)],context);
  assert.equal(result.rows[0].volume.status,'DATA_GAP');
  assert.equal(result.rows[0].amount.status,'DATA_GAP');
}
assert.throws(()=>buildRanking([{...map(input),symbol:2330}],context),/SYMBOL/);
console.log('PASS native cumulative volume/value: raw timestamp overflow and invalid types isolate as gaps; no batch crash or guessed units');
