'use strict';
const assert=require('node:assert/strict'),{build}=require('../lib/mother-pool-detector-candle-source');
const c={symbol:'2330',market:'TSE',tradeDate:'2026-09-17',candleTime:'2026-09-17T01:00:00Z',candleSeenAt:'2026-09-17T01:01:00Z',
 source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',synthetic:false,volumeStrategyUsable:true,
 open:100,high:101,low:99,close:100,volume:10};
const args={tradeDate:c.tradeDate,canonicalRunId:'fugle_daytrade_source:20260917:canonical',asOf:'2026-09-17T02:00:00Z'};
const r=build({...args,candles:[c]});assert.equal(r.groups.get('2330')[0].volume_raw_unit,'LOTS');
assert.equal(r.groups.get('2330')[0].available_at,c.candleSeenAt.replace('Z','.000Z'));
for(const patch of [{synthetic:true},{market:'ESB'},{volumeStrategyUsable:false},{candleSeenAt:'2026-09-17T03:00:00Z'},{candleTime:'2026-09-17T02:00:00Z'}])
 assert.equal(build({...args,candles:[{...c,...patch}]}).groups.size,0);
assert.throws(()=>build({...args,candles:[c,c]}),/DUPLICATE/);
assert.throws(()=>build({...args,canonicalRunId:'old',candles:[c]}),/IDENTITY/);
console.log('PASS Mother Pool detector source mapping: native baseline, explicit unit, as-of, duplicates, session and canonical guards');
