'use strict';
const assert = require('node:assert/strict');
const { normalizeFugleCandles } = require('../lib/fugle-websocket-quotes');
const bar = {date:'2026-10-02T09:09:00.000+08:00',open:100,high:102,low:99,close:101,volume:12};
const wrap = data => ({event:'snapshot',channel:'candles',data});
const rows = normalizeFugleCandles(wrap({symbol:'2330',date:'2026-10-02',market:'TSE',data:[bar,{...bar,date:'2026-10-02T09:10:00.000+08:00',close:102}]}));
assert.equal(rows.length,2);
assert.deepEqual(rows.map(r=>[r.symbol,r.candleTime,r.close,r.volume,r.market]),[
 ['2330',bar.date,101,12,'TSE'],['2330','2026-10-02T09:10:00.000+08:00',102,12,'TSE']]);
assert.equal(bar.symbol,undefined,'must not mutate native input');
assert.equal(normalizeFugleCandles(wrap({symbol:'2330',date:bar.date,data:[{close:100}]})).length,0,'envelope time cannot fill missing bar time');
assert.equal(normalizeFugleCandles(wrap({symbol:'2330',data:[{...bar,symbol:'1216'}]})).length,0,'conflicting symbol must be rejected');
assert.equal(normalizeFugleCandles(wrap({symbol:'2330',data:[null,{},[],{...bar,close:0}]})).length,0);
assert.equal(normalizeFugleCandles(wrap({symbol:'2330',candles:[bar]}))[0].symbol,'2330');
assert.equal(normalizeFugleCandles(wrap([{symbol:'1216',...bar}]))[0].symbol,'1216');
assert.equal(normalizeFugleCandles({event:'data',channel:'candles',data:{symbol:'2330',...bar}})[0].close,101);
assert.equal(normalizeFugleCandles({symbol:'2330',...bar})[0].symbol,'2330');
console.log('PASS candle snapshot identity, timestamps, conflicts and live compatibility');
