'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),os=require('node:os');
const text=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8').replaceAll('\r\n','\n');
const start=text.indexOf('  result.payload.module_write_sets = {};'),end=text.indexOf('  writeModuleProducerReceipts',start);assert(start>0&&end>start);
(async()=>{
 let checks=0;
 for(const minute of [359,360,480,539])for(const historyAvailable of [false,true]){
  const f=require('./test-mother-identity-source').fixture(),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'a01-entry-'));let writes=0;
  f.lease.rpcEvidence.heartbeat_at=new Date(Date.parse(f.asOf)+1000).toISOString();const observedAfterLease=new Date(Date.parse(f.asOf)+2000).toISOString();
  const result={payload:{writer_run_id:f.identity.writer_run_id,generation_id:f.identity.generation_id}};
   const intradayMap=new Map();
 if(historyAvailable)intradayMap.preopenRawEvidence={contract:'daytrade_preopen_raw_rpc_evidence_v1',observation_trade_date:f.identity.trade_date,source_rpc:'get_fugle_daytrade_intraday_1m_latest_n',requested_symbols:f.symbols,observed_at:f.asOf,
 rows:f.symbols.flatMap(symbol=>Array.from({length:20},(_,i)=>({symbol,trade_date:'2026-09-17',candle_time:`2026-09-17T13:${10+i}:00+08:00`,open:100,high:101,low:99,close:100,source:'fugle_daytrade_fast_sync:websocket_candles',synthetic:false,volume_strategy_usable:true,payload:{originalSource:'fugle-ws-candles',originalChannel:'candles',candleOrigin:'websocket_candle',sourceCandleSeenAt:`2026-09-17T13:${11+i}:00+08:00`}})))};
 const context={intradayMap,dailyVolumeMap:require('./test-mother-previous-ohlc').fixture().dailyVolumeMap,activeSymbols:Object.assign(require('./test-mother-daytrade-ratio').fixture().activeSymbols,{sourceEvidence:require('./test-mother-eligibility-source').fixture().evidence}),officialDaytradeSource:require('./test-mother-daytrade-ratio').fixture().officialSource,result,sideMinutes:minute,sideAsOf:f.asOf,sideSnapshot:require('./test-mother-ma20').snapshot(f.identity,f.symbols,f.asOf),marketCalendarEvidence:f.calendar,writerLease:f.lease,
   taipeiDate:()=>f.identity.trade_date,nowIso:()=>observedAfterLease,readFugleWebSocketCandles:()=>assert.fail('preopen must not read intraday candles'),fs,path,
   FUGLE_WS_STATUS_FILE:'websocket-status',runtimePath:(...args)=>path.join(runtime,...args),readJson:file=>file==='websocket-status'?require('./test-mother-websocket-source').fixture().status:null,DRY_RUN:false,SUPABASE_URL:'http://isolated.invalid',headers:()=>({}),requireSupabaseKey:()=> 'isolated',SUPABASE_WRITE_TIMEOUT_MS:1000,AbortSignal,
   fetch:async(url,options)=>{writes++;const body=JSON.parse(options.body),doc=JSON.parse(body.p_document),plan=JSON.parse(body.p_plan);if(doc.module_id==='A01'){assert(plan.rows.every(r=>r.status==='READY'));assert.equal(plan.created_at,observedAfterLease);}assert(['A01','A02','A04','A05','A06','A15','A08','A09'].includes(doc.module_id));if(doc.module_id==='A04'){assert.equal(plan.rows.length,f.symbols.length);assert(plan.rows.every(row=>row.status==='DATA_GAP'&&row.price_evidence===null&&row.data_gap_reason.includes('HISTORICAL_REFERENCE_AND_LIMIT_PRICE_SOURCE_MISSING')&&row.formal_candidate_allowed===false));}return {ok:true,json:async()=>({...doc,committed:true,committed_at:observedAfterLease,written_symbols:plan.requested_symbols})};},
   require:name=>name==='../lib/daytrade-mother-pool-snapshot'?{inspectSnapshot:()=>({ok:true})}:require(name)};
  await vm.runInNewContext('(async()=>{'+text.slice(start,end)+'})()',context);
  assert.deepEqual(JSON.parse(JSON.stringify(result.payload.module_persistence_errors)),minute>=360&&!historyAvailable?[{modules:['A08','A09'],error:'PREOPEN_RAW_EVIDENCE_REQUIRED'}]:[]);
  assert.equal(writes,minute>=360?(historyAvailable?8:6):0);assert.deepEqual(Object.keys(result.payload.module_write_sets),minute>=360?['A01','A02','A04','A05','A06','A15',...(historyAvailable?['A08','A09']:[])]:[]);checks+=3;
 }
 console.log(JSON.stringify({status:'passed',checks,scope:'isolated_actual_Writer_preopen_entry_with_RPC_adapter',production_complete:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
