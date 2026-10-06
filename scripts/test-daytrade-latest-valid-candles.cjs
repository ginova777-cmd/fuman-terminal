'use strict';
const assert=require('node:assert/strict');
const {latestValidCandles}=require('../lib/daytrade-latest-valid-candles.cjs');
const {mapNaturalCandle}=require('../lib/daytrade-fast-candle-row');
const tradeDate='2026-10-06',nowMs=Date.parse('2026-10-06T02:00:00Z');
const bar=(symbol,minute,overrides={})=>({symbol,market:'TSE',tradeDate,candleTime:`2026-10-06T01:${String(minute).padStart(2,'0')}:00Z`,candleSeenAt:'2026-10-06T01:59:59Z',open:100,high:102,low:99,close:101,volume:10,source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',restRepairRow:false,intradayOddLot:false,synthetic:false,volumeStrategyUsable:true,...overrides});
const rows=[bar('3163',57),bar('3163',59,{synthetic:true}),bar('3163',58),bar('6213',58,{high:90}),bar('6213',57),bar('2330',59,{candleTime:'2026-10-06T02:00:00Z'}),bar('2330',58),bar('9999',59),bar('1303',58,{tradeDate:'2026-10-05'}),bar('1303',57,{restRepairRow:true}),bar('1303',56,{candleSeenAt:'2026-10-06T02:01:00Z'}),bar('1303',55,{volumeStrategyUsable:false}),bar('1303',54)];
const allowedSymbols=new Set(['3163','6213','2330','1303']);
function old(input){const groups=new Map();for(const c of input){if(!allowedSymbols.has(c.symbol))continue;const r=mapNaturalCandle(c,{tradeDate,nowMs,maxSeenAgeMs:Infinity});if(r){const a=groups.get(r.symbol)||[];a.push(r);groups.set(r.symbol,a);}}return [...groups.values()].map(a=>a.sort((a,b)=>Date.parse(b.candle_time)-Date.parse(a.candle_time))[0]);}
const sort=x=>x.slice().sort((a,b)=>a.symbol.localeCompare(b.symbol));
const frozen=JSON.stringify(rows);
assert.deepEqual(sort(latestValidCandles(rows,{allowedSymbols,tradeDate,nowMs,mapNaturalCandle})),sort(old(rows)));
assert.equal(JSON.stringify(rows),frozen);
assert.deepEqual(latestValidCandles([],{allowedSymbols,tradeDate,nowMs,mapNaturalCandle}),[]);
// A realistic 50k historical set must validate only one completed bar per stock.
const bulk=Array.from({length:1000},(_,i)=>Array.from({length:50},(_,m)=>bar(String(1000+i),m))).flat();
let calls=0;const all=new Set(bulk.map(x=>x.symbol));
const latest=latestValidCandles(bulk,{allowedSymbols:all,tradeDate,nowMs,mapNaturalCandle:(...a)=>{calls++;return mapNaturalCandle(...a);}});
assert.equal(latest.length,1000);assert.equal(calls,1000);assert(latest.every(r=>r.candle_time==='2026-10-06T01:49:00.000Z'));
console.log('PASS: latest valid equivalence, invalid/future/repaired fallback, scope, immutable input, 50000 rows -> 1000 validations');
