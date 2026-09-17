'use strict';
const assert = require('node:assert/strict');
const { normalizeFugleCandle } = require('../lib/fugle-websocket-quotes');
const { mapNaturalCandle } = require('../lib/daytrade-fast-candle-row');
const time = new Date(Math.floor(Date.now()/60000)*60000-60000).toISOString();
const input = {symbol:'2330',date:time,open:100,high:102,low:99,close:101};
for (const volume of [undefined,null,'',' ',false,true,[],{},'bad',Infinity,-1]) {
  const row = normalizeFugleCandle({...input,volume});
  assert.equal(row.volume,null);
  assert.equal(row.volumeStrategyUsable,false);
  assert.equal(mapNaturalCandle(row,{tradeDate:row.tradeDate,nowMs:Date.now()}),null);
}
for (const volume of [0,'0',10,'10']) {
  const row = normalizeFugleCandle({...input,volume});
  const written = mapNaturalCandle(row,{tradeDate:row.tradeDate,nowMs:Date.now()});
  assert.ok(written);
  assert.equal(written.volume,Number(volume));
  assert.equal(written.volume_strategy_usable,true);
}
console.log('PASS actual Collector -> Writer volume mapping: missing invalid isolated; native zero retained');
