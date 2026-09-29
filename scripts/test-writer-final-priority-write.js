'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');
const start=src.indexOf('  let websocketCandleSync ='),end=src.indexOf('  // The fetch/rebuild can change deep-scan membership.',start);
assert(start>0&&end>start);
async function run({rest,candles,failed=false}){
 const events=[],writes=[],row=phase=>({symbol:'2330',updated_at:'2026-09-29T02:00:00Z',phase});let build=0;
 const ctx={priorityRows:[row('initial')],activeSymbols:[{symbol:'2330'}],dailyVolumeMap:new Map(),quoteMap:new Map(),supplementalMaps:{},intradayMap:new Map(),state:{},nonFatalWriteErrors:[],
  publishDaytradePrioritySymbols:async()=>events.push('publish'),tickStage:()=>{},syncWebSocketIntraday1mCandles:async()=>{events.push('candles');return {written:candles?1:0,skipped:!candles};},numberValue:Number,
  fetchIntradayStatus:async()=>new Map(),mergeWebSocketQuoteDerivedIntradayStatus:x=>x,buildPriorityPool:()=>[row(++build===1&&candles?'candles':'rest')],syncWebSocketFutoptQuotes:async()=>({written:1}),taipeiMinutes:()=>600,
  ensureOpening0901CandleEvidence:async()=>({ready:true}),syncIntradayStatusCache:async()=>({written:1}),fetchFutoptRows:async()=>[],captureFutoptPreopenBaseline:async()=>({}),buildFullMarketIntradaySignalEvidence:()=>({}),
  futureSeconds:()=>0,REST_QUOTE_FETCH_ENABLED:rest,FETCH_ENABLED:rest,fetchAllowedForPhase:true,restFallbackDueThisTick:true,fetchPriorityOnlyForPhase:true,REST_PRIORITY_BATCH_LIMIT:60,REST_FALLBACK_INTERVAL_SECONDS:60,
  selectFetchBatch:()=>({symbols:['2330']}),fetchQuoteBatch:async()=>{events.push('rest');return {rows:[row('rest')],errors:[]};},normalizeCode:x=>x,mergeWebSocketQuoteCache:()=>{},priorityPoolDbRows:x=>x,
  SLOW_TABLE_BATCH_SIZE:200,supabaseUpsert:async(resource,rows)=>{if(resource==='fugle_daytrade_priority_pool'){events.push('priority');writes.push(JSON.parse(JSON.stringify(rows)));if(failed)throw Error('WRITE_FAILED');}},
  supabaseDelete:async()=>events.push('cleanup'),require:()=>({record:()=>events.push('record')}),process:{env:{}},taipeiDate:()=> '2026-09-29',writerTickIdentity:{writer_run_id:'w',generation_id:'g'},nowIso:()=> '2026-09-29T02:00:00Z',console:{error:()=>{}}};
 const execution=vm.runInNewContext('(async()=>{'+src.slice(start,end)+';return fetchResult;})()',ctx);
 let result;if(failed)await assert.rejects(execution,e=>e.message==='PRIORITY_POOL_WRITE_UNCONFIRMED'&&e.cause.message==='WRITE_FAILED');else result=await execution;
 assert.equal(writes.length,1);assert.equal(writes[0][0].phase,rest?'rest':candles?'candles':'initial');assert(events.indexOf('candles')<events.indexOf('priority'));
 if(rest)assert(events.indexOf('rest')<events.indexOf('priority'));
 assert.equal(events.includes('cleanup'),!failed);assert.equal(events.includes('record'),!failed);
 if(!failed)assert.equal(result.errors.length,0);
}
(async()=>{for(const rest of [false,true])for(const candles of [false,true])for(const failed of [false,true])await run({rest,candles,failed});console.log('PASS 8 actual Writer flows: candles/REST retained, final priority written once, failed write never cleans up or records successful refresh. No network.');})().catch(e=>{console.error(e);process.exitCode=1;});
