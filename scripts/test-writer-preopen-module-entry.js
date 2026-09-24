'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),os=require('node:os');
const text=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8').replaceAll('\r\n','\n');
const start=text.indexOf('  result.payload.module_write_sets = {};'),end=text.indexOf('  writeModuleProducerReceipts',start);assert(start>0&&end>start);
(async()=>{
 let checks=0;
 for(const minute of [359,360,480,539]){
  const f=require('./test-mother-identity-source').fixture(),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'a01-entry-'));let writes=0;
  const result={payload:{writer_run_id:f.identity.writer_run_id,generation_id:f.identity.generation_id}};
  const context={dailyVolumeMap:require('./test-mother-previous-ohlc').fixture().dailyVolumeMap,activeSymbols:Object.assign(require('./test-mother-daytrade-ratio').fixture().activeSymbols,{sourceEvidence:require('./test-mother-eligibility-source').fixture().evidence}),officialDaytradeSource:require('./test-mother-daytrade-ratio').fixture().officialSource,result,sideMinutes:minute,sideAsOf:f.asOf,sideSnapshot:{...f.identity,generation:f.identity.snapshot_generation,symbols:f.symbols},marketCalendarEvidence:f.calendar,writerLease:f.lease,
   taipeiDate:()=>f.identity.trade_date,nowIso:()=>f.asOf,readFugleWebSocketCandles:()=>assert.fail('preopen must not read intraday candles'),fs,path,
   FUGLE_WS_STATUS_FILE:'websocket-status',runtimePath:(...args)=>path.join(runtime,...args),readJson:file=>file==='websocket-status'?require('./test-mother-websocket-source').fixture().status:null,DRY_RUN:false,SUPABASE_URL:'http://isolated.invalid',headers:()=>({}),requireSupabaseKey:()=> 'isolated',SUPABASE_WRITE_TIMEOUT_MS:1000,AbortSignal,
   fetch:async(url,options)=>{writes++;const body=JSON.parse(options.body),doc=JSON.parse(body.p_document),plan=JSON.parse(body.p_plan);assert(['A01','A02','A04','A05','A06','A15'].includes(doc.module_id));if(doc.module_id==='A04'){assert.equal(plan.rows.length,f.symbols.length);assert(plan.rows.every(row=>row.status==='DATA_GAP'&&row.price_evidence===null&&row.data_gap_reason.includes('HISTORICAL_REFERENCE_AND_LIMIT_PRICE_SOURCE_MISSING')&&row.formal_candidate_allowed===false));}return {ok:true,json:async()=>({...doc,committed:true,committed_at:f.asOf,written_symbols:plan.requested_symbols})};},
   require:name=>name==='../lib/daytrade-mother-pool-snapshot'?{inspectSnapshot:()=>({ok:true})}:require(name)};
  await vm.runInNewContext('(async()=>{'+text.slice(start,end)+'})()',context);
  assert.equal(result.payload.module_persistence_errors.length,0,JSON.stringify(result.payload.module_persistence_errors));
  assert.equal(writes,minute>=360?6:0);assert.deepEqual(Object.keys(result.payload.module_write_sets),minute>=360?['A01','A02','A04','A05','A06','A15']:[]);checks+=3;
 }
 console.log(JSON.stringify({status:'passed',checks,scope:'isolated_actual_Writer_preopen_entry_with_RPC_adapter',production_complete:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});




