'use strict';
const assert=require('node:assert/strict');
const {adaptDaily}=require('./premarket-daily-source.cjs');
const {buildBEvidence,scoreB}=require('./premarket-short-ranking.cjs');
const price_rows=Array.from({length:35},(_,i)=>({stock_id:'3450',date:new Date(Date.UTC(2026,7,1+i)).toISOString().slice(0,10),open:100,max:100,min:100,close:100,Trading_Volume:i===34?500:100}));
const baseDate=price_rows.at(-1).date,tradeDate='2026-09-07',asOf=tradeDate+'T08:59:00+08:00';
const source={symbol:'3450',signal_date:baseDate,trade_date:tradeDate,fetched_at:tradeDate+'T08:00:00+08:00',price_rows,institutional_rows:['Foreign_Investor','Investment_Trust','Dealer_self'].map(name=>({stock_id:'3450',date:baseDate,name,buy:0,sell:1})),branch_rows:[{stock_id:'3450',date:baseDate,securities_trader_id:'a',price:100,buy:10,sell:2}]};
const args={source,symbol:'3450',baseDate,tradeDate,asOf},r=adaptDaily(args);
assert.equal(r.complete,true);assert.equal(r.calendar_continuity_verified,false);
assert.equal(r.short_rank_input.current.kd.k,50);assert.equal(r.short_rank_input.current.rsi.short,50);assert.equal(r.short_rank_input.current.macd.histogram,0);
assert.equal(r.volume_ratio_excluding_today,5);assert.equal(scoreB(buildBEvidence(r.short_rank_input)).score,3);
for(const mutate of [x=>x.source.price_rows.push(x.source.price_rows[0]),x=>x.source.price_rows[0].max=0,x=>x.source.price_rows=x.source.price_rows.slice(-10),x=>x.source.fetched_at='2026-09-08T00:00:00Z',x=>x.source.symbol='2368']){
 const x=structuredClone(args);mutate(x);assert.equal(adaptDaily(x).complete,false);
}
const future=structuredClone(args);future.source.price_rows.push({...price_rows[0],date:'2026-09-08',close:1});assert.deepEqual(adaptDaily(future),r);
const missing=structuredClone(args);missing.source.institutional_rows=[];assert.equal(adaptDaily(missing).complete,false);
console.log('PASS daily source: explicit params/seeds, no future rows, no volume self-average, invalid/warmup/missing rejected; calendar proof remains separate');
