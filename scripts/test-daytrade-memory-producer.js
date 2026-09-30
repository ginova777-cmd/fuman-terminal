'use strict';
const assert=require('node:assert/strict');
const {createMemoryCandles}=require('../lib/daytrade-memory-candles');
const {createSnapshotStore}=require('../lib/daytrade-volatile-snapshot');
const {createSnapshotServer,readSnapshot}=require('../lib/daytrade-snapshot-transport');
const {createDetectionRuntime}=require('../lib/daytrade-memory-runtime');
const {mergeFugleQuoteState,normalizeFugleTrade}=require('../lib/fugle-websocket-quotes');
const {createMemoryFeed}=require('../lib/daytrade-memory-feed');
const detector=require('./run-daytrade-source-writer');
async function main(){
 const {encodeBaseline,decodeBaseline}=require('../lib/daytrade-baseline-transfer');
 const universe=[{symbol:'2330'}];universe.sourceEvidence={stock_tickers:[{symbol:'2330',official_present:true}],observed_at:'isolated'};
 const baselineMap=new Map([['2330',{avg_volume5:100}]]);baselineMap.source='isolated-history';
 const transferred=decodeBaseline(structuredClone(encodeBaseline({universe,baselineMap})));assert.deepEqual(transferred.universe,universe);assert.equal(transferred.baselineMap.source,baselineMap.source);
 const clock=Date.parse('2026-09-30T01:36:00Z');
 const bars=Array.from({length:36},(_,i)=>({symbol:'2330',candle_time:new Date(clock-(36-i)*60000).toISOString(),open:100+i,high:101+i,low:99+i,close:100+i,volume:i+1,synthetic:false}));
 const candles=createMemoryCandles({tradeDate:'2026-09-30',symbols:['2330','2317'],now:()=>clock,buildIndicators:detector.buildMemoryIntradayIndicators});
 candles.ingest([...bars,...bars.map(b=>({...b,symbol:'2317'}))]);assert.equal(candles.read().get('2330').ma3,134);
 candles.ingest([{...bars.at(-1),volume:null}]);assert(!candles.read().has('2330'));assert(candles.read().has('2317'));assert.equal(candles.read().dataGaps.length,1);
 candles.ingest([bars.at(-1)]);assert(candles.read().has('2330'));assert.equal(candles.status().data_gap_count,0);
 const before=candles.status().revision;assert.throws(()=>candles.ingest([{...bars[0],close:100.5},{...bars[1],symbol:'9999'}]),/IDENTITY/);assert.equal(candles.status().revision,before);
 const feed=createMemoryFeed({mergeQuote:mergeFugleQuoteState,now:()=>clock});feed.configure({tradeDate:'2026-09-30',symbols:['2330']});
 feed.ingest(normalizeFugleTrade({symbol:'2330',price:100,volume:2,time:(clock-1000)*1000,serial:2}));feed.ingest(normalizeFugleTrade({symbol:'2330',price:90,volume:1,time:clock*1000,serial:1}));assert.equal(feed.snapshot().rows[0].close,100);
 let ms=Date.parse('2026-09-30T00:59:59Z'),timer,calls=0;
 const runtimeStore=createSnapshotStore({now:()=>ms});
 const input={tradeDate:'2026-09-30',calendar:{tradeDate:'2026-09-30',isTradingDay:true},identity:{trade_date:'2026-09-30',canonical_run_id:'isolated'},quoteMap:new Map()};
 const runtime=createDetectionRuntime({now:()=>ms,setTimer:(fn,delay)=>(timer={fn,delay},1),clearTimer:()=>{},store:runtimeStore,getInputs:()=>input,evaluate:()=>{calls++;return [{symbol:'2330'}];}});
 runtime.start();assert.equal(timer.delay,1000);ms+=1000;timer.fn();assert.equal(calls,2);assert.equal(timer.delay,1000);input.calendar.isTradingDay=false;ms+=1000;timer.fn();assert.throws(()=>runtimeStore.read({tradeDate:input.tradeDate}),/NOT_AVAILABLE/);runtime.stop();
 const now=Date.now(),date=new Date(now+28800000).toISOString().slice(0,10),endpoint='\\\\.\\pipe\\fuman-memory-producer-test-'+process.pid;
 const rows=Array.from({length:1605},(_,i)=>({symbol:String(1000+i),evidence:'量價欄位'.repeat(1100),rank:i+1}));
 const quotes=rows.filter((_,i)=>i%5!==0).map(row=>({symbol:row.symbol,trade_date:date,price:101}));
 const store=createSnapshotStore(),value={trade_date:date,canonical_run_id:'isolated',observed_at:new Date(now).toISOString(),rows,quotes},pinned=store.publish(value);let pages=0,maxBytes=0,tamper=false;
 const server=createSnapshotServer({endpoint,store:{read:store.read,readPage(options){const page=store.readPage(options);maxBytes=Math.max(maxBytes,Buffer.byteLength(JSON.stringify({ok:true,snapshot:page})));assert(page.rows.length<=50);if(++pages===1)store.publish({...value,rows:rows.map(r=>({...r,rank:-1}))});if(tamper)page.page.next_offset=null;return page;}}});
 await server.listen();try{
  const all=await readSnapshot({endpoint,tradeDate:date,snapshotId:pinned.snapshot_id});assert.deepEqual(all.rows,rows);assert.deepEqual(all.quotes,quotes);assert(maxBytes<=512*1024);assert(pages>32);
  tamper=true;await assert.rejects(()=>readSnapshot({endpoint,tradeDate:date}),/TRUNCATED/);
 }finally{await server.close();}
 console.log(JSON.stringify({pass:true,scope:'isolated_memory_producer_actual_indicator_and_named_pipe',complete:false,production_active:false,rows:rows.length,pages:pages-1,max_page_bytes:maxBytes,checks:['actual_writer_indicator_formula','per_symbol_candle_gap_and_recovery','identity_batch_atomic','quote_serial_order','one_second_scheduler','calendar_failure_invalidates','all_fields_pinned_pagination','truncation_rejected']}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
