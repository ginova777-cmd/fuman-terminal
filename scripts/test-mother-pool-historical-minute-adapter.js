'use strict';
const assert=require('node:assert/strict'),{adapt}=require('../lib/mother-pool-historical-minute-adapter');
const bar={date:'2026-09-16T09:00:00+08:00',open:100,high:101,low:99,close:100,volume:123};
const input={symbol:'2330',tradeDate:'2026-09-17',fetchedAt:'2026-09-17T00:00:00Z',asOf:'2026-09-17T01:00:00Z',
 sessionDates:['2026-09-16'],response:{symbol:'2330',exchange:'TWSE',market:'TSE',type:'EQUITY',timeframe:'1',data:[bar]}};
const result=adapt(input);assert.equal(result.rows[0].volume_raw,123);assert.equal(result.rows[0].volume_raw_unit,'LOTS');
const tib=adapt({...input,response:{...input.response,market:'TIB'}});
assert.equal(tib.rows[0].source,'Fugle.historical.candles.1.TIB');assert.equal(tib.rows[0].volume_raw_unit,'LOTS');
assert.equal(tib.rows[0].market,'TIB');
assert.throws(()=>adapt({...input,response:{...input.response,market:'TIB',exchange:'TPEx'}}));
assert.throws(()=>adapt({...input,response:{...input.response,market:'TIB',type:undefined}}));
assert.equal(result.rows[0].available_at,input.fetchedAt);assert.equal(result.complete,false);assert.match(result.raw_sha256,/^[a-f0-9]{64}$/);
for(const patch of [{type:'INDEX'},{market:'ESB'},{timeframe:'D'},{symbol:'9999'},{exchange:'UNKNOWN'},{data:[bar,bar]}])
 assert.throws(()=>adapt({...input,response:{...input.response,...patch}}));
for(const patch of [{date:'2026-09-17T09:00:00+08:00'},{date:'2026-09-16T09:00:01+08:00'},
 {volume:null},{volume:-1},{close:200},{date:'2026-09-16T08:59:00+08:00'}])
 assert.throws(()=>adapt({...input,response:{...input.response,data:[{...bar,...patch}]}}));
for(const patch of [{fetchedAt:'2026-09-18T00:00:00Z'},{sessionDates:['2026-09-17']},
 {sessionDates:['2026-09-16','2026-09-16']},{tradeDate:null}])assert.throws(()=>adapt({...input,...patch}));
assert.deepEqual(adapt({...input,response:{...input.response,data:[]}}).rows,[]);
console.log('PASS historical minute adapter: source/type/unit, availability, date/session, duplicates, OHLCV and empty response guards');
