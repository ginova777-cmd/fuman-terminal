'use strict';
const assert=require('node:assert/strict');const {normalizeFugleAggregate,normalizeFugleCandles}=require('../lib/fugle-websocket-quotes');
for(const iso of ['2026-10-01T15:59:59Z','2026-10-01T16:00:00Z','2026-10-02T00:55:00Z','2026-10-02T01:00:00Z','2026-10-02T05:30:00Z','2026-12-31T16:00:00Z']){
 const date=new Date(iso),micros=date.getTime()*1000;
 const expected=date.toLocaleTimeString('en-GB',{timeZone:'Asia/Taipei',hour12:false});
 const r=normalizeFugleAggregate({data:{symbol:'2330',referencePrice:100,closePrice:101,lastUpdated:micros,lastTrade:{time:micros,price:101},market:'TSE'}});
 assert.equal(r.time,expected);assert.equal(r.quoteTime,expected);assert.equal(r.exchangeTime,date.toISOString());
 const c=normalizeFugleCandles({symbol:'2330',date:iso,close:101,volume:1})[0];
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const get=t=>parts.find(x=>x.type===t).value;
 assert.equal(c.tradeDate,[get('year'),get('month'),get('day')].join('-'));assert.equal(c.candleTime,iso);
}
console.log('PASS clock/date output equivalence at midnight, preopen, open, close and year rollover; original event timestamps retained');
