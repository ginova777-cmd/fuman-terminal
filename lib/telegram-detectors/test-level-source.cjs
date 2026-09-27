'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalize}=require('./level-source.cjs');
const date='2026-09-16',prev='2026-09-15',symbol='3450',now=date+'T09:31:00+08:00';
function input(){return {symbol,tradeDate:date,previousDate:prev,now,bars:[{stock_id:symbol,trade_date:date,timestamp:date+'T09:00:00+08:00',complete:true,is_synthetic:false,open:100}],source:{symbol,trade_date:date,signal_date:prev,fetched_at:date+'T08:50:00+08:00',price_rows:[{stock_id:symbol,date:prev,close:99,min:95}],branch_rows:[{stock_id:symbol,date:prev,securities_trader_id:'a',price:100,buy:10,sell:2},{stock_id:symbol,date:prev,securities_trader_id:'b',price:90,buy:20,sell:15}]}};}
test('rank net purchases before cost, use correct prior session and actual open',()=>{const r=normalize(input());assert.equal(r.cost,100);assert.equal(r.branch_id,'a');assert.equal(r.previous_close,99);assert.equal(r.previous_low,95);assert.equal(r.open,100);assert.deepEqual(r.gaps,[]);});
test('wrong date, symbol, corrupt quantities and late source cannot invent a cost',()=>{for(const mutate of [x=>x.source.signal_date='2026-09-14',x=>x.source.symbol='2330',x=>x.source.branch_rows[0].buy=null,x=>x.source.fetched_at=date+'T10:00:00+08:00']){const x=input();mutate(x);assert.equal(normalize(x).cost,null);assert(normalize(x).gaps.length);}});
test('opening price is not the first later minute or synthetic data',()=>{const x=input();x.bars[0].timestamp=date+'T09:01:00+08:00';assert.equal(normalize(x).open,null);});
test('actual websocket open can survive a missing 09:00 bar, but not a future quote',()=>{const x=input();x.bars=[];x.quote={code:symbol,isTrial:false,isSynthetic:false,quoteSource:'fugle-ws',exchangeTime:date+'T09:30:00+08:00',receivedAt:date+'T09:30:01+08:00',open:100};assert.equal(normalize(x).open,100);x.quote.receivedAt=date+'T10:00:00+08:00';assert.equal(normalize(x).open,null);});
test('missing symbol hydration uses exact prior date, one-day broker endpoint, and durable cache',async()=>{
 const fs=require('fs'),os=require('os'),path=require('path'),{hydrate}=require('./level-source.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'level-source-test-'));
 fs.mkdirSync(path.join(root,'secrets'));fs.writeFileSync(path.join(root,'secrets/finmind-token.txt'),'offline-fixture-token');
 const x=input(),calls=[];
 const options={runtimeRoot:root,tradeDate:date,previousDate:prev,groups:{[symbol]:x.bars},symbols:[symbol,symbol],now,fetcher:async url=>{const q=new URL(url).searchParams;calls.push(q.get('dataset'));assert.equal(q.get('start_date'),prev);assert.equal(q.get('data_id'),symbol);if(q.get('dataset')==='TaiwanStockTradingDailyReport')assert.equal(q.has('end_date'),false);return{ok:true,json:async()=>({status:200,data:q.get('dataset')==='TaiwanStockPrice'?x.source.price_rows:x.source.branch_rows})};}};
 try{let r=await hydrate(options);assert.equal(r[symbol].levelInput.cost,100);assert.equal(calls.length,2);r=await hydrate(options);assert.equal(calls.length,2);assert.equal(r[symbol].levelInput.previous_close,99);}finally{fs.rmSync(root,{recursive:true});}
});
