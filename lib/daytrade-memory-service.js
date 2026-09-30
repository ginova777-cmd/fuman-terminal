'use strict';
const {cloneBaseline}=require('./daytrade-baseline-transfer');
const {createMemoryFeed}=require('./daytrade-memory-feed');
const {createSnapshotStore}=require('./daytrade-volatile-snapshot');
const {createSnapshotServer}=require('./daytrade-snapshot-transport');
const {createDetectionRuntime}=require('./daytrade-memory-runtime');
// Host this service in the detection process, separate from the socket reader.
// Warmup and event IPC deliver inputs; the hot path performs no persistence.
function createMemoryService({endpoint,mergeQuote,normalizeQuotes,evaluate,buildIndicators,now=Date.now,setTimer,clearTimer,requireFeedLease=false}){
 let feed=createMemoryFeed({mergeQuote,now});
 const store=createSnapshotStore({now});
 const epoch=require('crypto').randomUUID();let marketSequence=0;
 const server=createSnapshotServer({endpoint,store,marketStore:{read({tradeDate}){
  if(!baseline||blockedReason||lastFeedAt===null||now()-lastFeedAt>5000)throw Error('VOLATILE_MARKET_NOT_AVAILABLE');
  if(tradeDate!==baseline.tradeDate)throw Error('VOLATILE_MARKET_DATE_MISMATCH');
  const data=feed.snapshot();
  return {contract:'daytrade-volatile-market-v1',storage:'volatile_memory',trade_date:tradeDate,canonical_run_id:baseline.identity.canonical_run_id,producer_epoch:epoch,sequence:marketSequence,observed_at:new Date(lastFeedAt).toISOString(),universe:data.universe,count:data.universe.length,quotes:data.rows,quote_count:data.rows.length};
 }}});
 let baseline=null,listening=false,blockedReason=null,lastFeedAt=null,candleStore=null,transportStatus=null;
 const runtime=createDetectionRuntime({now,setTimer,clearTimer,store,evaluate,getInputs(){
  if(!baseline)throw Error('WARMUP_BASELINE_NOT_AVAILABLE');
  if(blockedReason)throw Error(blockedReason);
  if(requireFeedLease&&(lastFeedAt===null||now()-lastFeedAt>5000))throw Error('COLLECTOR_FEED_STALE');
  const snapshot=feed.snapshot();
  if(snapshot.tradeDate!==baseline.tradeDate)throw Error('WARMUP_FEED_DATE_MISMATCH');
  const quoteMap=normalizeQuotes(snapshot.rows,baseline.tradeDate);
  return {...baseline,quoteMap,transportStatus,supplementalMaps:{...baseline.supplementalMaps,...(candleStore?{intradayMap:candleStore.read()}: {})}};
 }});
 function warmup(input){
  if(!input||!(input.dailyVolumeMap instanceof Map)||!Array.isArray(input.activeSymbols)||!input.activeSymbols.length||typeof input.readMemoryJson!=='function')throw Error('WARMUP_INPUT_INVALID');
  if(input.identity?.trade_date!==input.tradeDate||input.calendar?.tradeDate!==input.tradeDate||input.calendar?.isTradingDay!==true)throw Error('WARMUP_IDENTITY_INVALID');
  const symbols=input.activeSymbols.map(row=>row.symbol);
  // Never invent baselines or shrink the universe to symbols with quotes.
  feed.configure({tradeDate:input.tradeDate,symbols});
  const {readMemoryJson,...data}=input;
  baseline={...cloneBaseline(data),readMemoryJson};blockedReason=null;lastFeedAt=null;store.invalidate();
  candleStore=buildIndicators?require('./daytrade-memory-candles').createMemoryCandles({tradeDate:input.tradeDate,symbols,buildIndicators,now}):null;
  if(candleStore&&input.history)candleStore.seedHistory(input.history);
 }
 return {
  warmup,
  updateTransport(status){transportStatus=structuredClone(status);},
  ingestCandles(rows){if(!candleStore)throw Error('MEMORY_CANDLE_STORE_NOT_READY');candleStore.ingest(rows);},
  ingest(rows){if(!Array.isArray(rows))throw Error('EVENT_BATCH_INVALID');for(const row of rows)feed.ingest(row);},
  replaceState(rows){
   if(!baseline||!Array.isArray(rows))throw Error('WARMUP_BASELINE_NOT_AVAILABLE');
   const next=createMemoryFeed({mergeQuote,now});
   next.configure({tradeDate:baseline.tradeDate,symbols:baseline.activeSymbols.map(row=>row.symbol)});
   for(const row of rows)next.ingest(row);
   feed=next;lastFeedAt=now();blockedReason=null;marketSequence++;
  },
  invalidate(reason='DETECTION_INPUT_INVALID'){blockedReason=reason;store.invalidate();},
  touchFeed(tradeDate){if(!baseline||baseline.tradeDate!==tradeDate)throw Error('FEED_HEARTBEAT_DATE_MISMATCH');lastFeedAt=now();},
  async start(){if(listening)return;await server.listen();listening=true;runtime.start();},
  async stop(){runtime.stop();if(listening){await server.close();listening=false;}},
  status(){return {runtime:runtime.status(),feed:feed.status(),warmup_date:baseline?.tradeDate||null,listening};},
 };
}
module.exports={createMemoryService};
