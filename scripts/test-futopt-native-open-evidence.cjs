'use strict';
const assert=require('node:assert/strict'),{inspect}=require('../lib/futopt-native-open-evidence.cjs');
const opts={futureSymbol:'DFFJ6',tradeDate:'2026-10-02',capturedAt:'2026-10-02T08:55:30+08:00'},t=Date.parse('2026-10-02T08:45:00.123+08:00')*1000;
const raw={symbol:'DFFJ6',date:opts.tradeDate,type:'FUTURE',exchange:'TAIFEX',openPrice:100,openTime:t,lastPrice:103};
let r=inspect(raw,opts);assert.equal(r.status,'CONFIRMED');assert.equal(r.price,100);assert.equal(r.event_at,'2026-10-02T00:45:00.123Z');assert.equal(r.exact_0845_minute,true);assert.equal(r.historical_availability_proven,false);
for(const patch of [{openTime:null},{openPrice:'100'},{symbol:'DFFK6'},{date:'2026-10-01'},{type:'FUTURE_AH'},{openTime:t+3600e6},{openTime:t-600e6},{isSynthetic:true}]){r=inspect({...raw,...patch},opts);assert.equal(r.status,'UNCONFIRMED');assert.equal(r.price,null);assert.equal(r.event_at,null);}
r=inspect({...raw,openTime:t+120e6},opts);assert.equal(r.status,'CONFIRMED');assert.equal(r.exact_0845_minute,false);
r=inspect({lastPrice:100,lastUpdated:t},opts);assert.equal(r.status,'UNCONFIRMED');
console.log('PASS: native open price/time, exact contract/date, regular session, delayed open, future rejection and no snapshot-price fallback.');
