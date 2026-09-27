'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {calculate,crosses,withinWindow,levels}=require('./level-cross-indicators.cjs');
const start=Date.parse('2026-09-24T09:00:00+08:00');
function bars(n=40){return Array.from({length:n},(_,i)=>({stock_id:'2330',trade_date:'2026-09-24',timestamp:new Date(start+i*60000).toISOString(),open:100,high:100,low:100,close:100,complete:true,is_synthetic:false,timeframe:'1m'}));}
const calc=b=>calculate({bars:b,stock_id:'2330',trade_date:'2026-09-24',as_of:'2026-09-24T10:00:00+08:00'});
test('flat series has exact neutral oscillators and zero MACD with no invented crosses',()=>{const r=calc(bars()).rows.at(-1);assert.deepEqual(r.values,{rsi5:50,rsi15:50,k:50,d:50,dif:0,signal:0});assert.deepEqual(r.golden,[]);assert.deepEqual(r.death,[]);});
test('MACD signal needs 20 DIF samples after slow EMA warmup',()=>{const r=calc(bars()).rows;assert.equal(r[26].values.signal,null);assert.equal(r[27].values.signal,0);});
test('OR crosses preserve separate direction and strict transition from equality',()=>{assert.deepEqual(crosses({rsi5:50,rsi15:50,k:70,d:60,dif:null,signal:null},{rsi5:51,rsi15:50,k:59,d:60,dif:1,signal:0}),{golden:['RSI'],death:['KD']});assert.deepEqual(crosses({k:70,d:60},{k:71,d:60}),{golden:[],death:[]});});
test('gap resets indicators rather than fabricating consecutive bars',()=>{const b=bars();b.splice(20,1);const r=calc(b).rows[20];assert.equal(r.values.k,null);assert.deepEqual(r.golden,[]);assert(r.reasons.includes('GAP_RESTARTED_WARMUP'));});
test('forming, synthetic and wrong timeframe bars cannot trigger',()=>{for(const patch of [{complete:false},{is_synthetic:true},{timeframe:'5m'}]){const b=bars();Object.assign(b.at(-1),patch);const r=calc(b).rows.at(-1);assert.equal(r.valid,false);assert.deepEqual(r.golden,[]);assert.deepEqual(r.death,[]);}});
test('reject duplicate minute and different stock instead of combining data',()=>{assert.throws(()=>calc([...bars(),bars()[0]]),/DUPLICATE/);const b=bars();b[0].stock_id='2317';assert.throws(()=>calc(b),/IDENTITY/);});
test('touch bar and next 3 clock minutes count; older crosses, fourth minute and next day do not',()=>{for(let i=0;i<=3;i++)assert.equal(withinWindow(new Date(start).toISOString(),new Date(start+i*60000).toISOString()),true);for(const i of [-1,4,1440])assert.equal(withinWindow(new Date(start).toISOString(),new Date(start+i*60000).toISOString()),false);});
test('agreed P/S levels and missing source remain explicit',()=>{const r=levels({cost:100,open:200,previous_close:190,previous_low:180});assert.deepEqual(r.map(x=>x.price),[100,103,105,206,210,190,180,100,196,190]);assert.equal(levels({open:200})[0].price,null);assert.equal(levels({open:200})[3].price,206);});
